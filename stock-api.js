/**
 * 纯 JavaScript 实现的高性能全市场股票行情、深度盘口、F10 与 资讯公告 SDK
 * 零额外依赖，原生支持 GB18030 中文解码与 A股/港股/美股/大盘指数 智能适配
 */

/**
 * 智能规整股票代码前缀
 */
function normalizeSymbol(symbol) {
  if (!symbol) return '';
  const s = symbol.trim().toLowerCase();
  
  if (s.startsWith('sh') || s.startsWith('sz') || s.startsWith('hk') || s.startsWith('us') || s.startsWith('bj')) {
    return s;
  }

  // 大盘指数特殊代码
  if (s === '000001' || s === 'sh000001' || s === 'sh' || s === 'szzs' || s === '上证' || s === '上证指数') return 'sh000001';
  if (s === '399001' || s === 'sz399001' || s === '深证' || s === '深证成指') return 'sz399001';
  if (s === '399006' || s === 'sz399006' || s === '创业板' || s === '创业板指') return 'sz399006';
  if (s === 'hsi' || s === '恒生指数' || s === '恒生') return 'hkHSI';

  // A股
  if (s.startsWith('6') || s.startsWith('9')) return `sh${s}`;
  if (s.startsWith('0') || s.startsWith('3')) return `sz${s}`;
  if (s.startsWith('8') || s.startsWith('4') || s.startsWith('920')) return `bj${s}`;

  // 港股 (5位纯数字)
  if (/^\d{5}$/.test(s)) return `hk${s}`;

  // 美股 (纯英文)
  if (/^[a-zA-Z]+$/.test(s)) return `us${s.toUpperCase()}`;

  return s;
}

// 服务端高性能多级内存缓存与并发去重引擎
const serverCache = {
  quote: new Map(),       // TTL: 1.5s
  indices: { data: null, timestamp: 0 }, // TTL: 2s
  kline: new Map(),       // TTL: intraday 8s, other 60s
  f10: new Map(),         // TTL: 30min
  news: new Map(),        // TTL: 3min
  ai: new Map()           // TTL: 5min
};

const inFlight = new Map();

/**
 * 带超时保护的高可用网络请求
 */
function fetchWithTimeout(url, options = {}, timeoutMs = 3500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal })
    .finally(() => clearTimeout(timer));
}

/**
 * 辅助解码 Unicode 转义序列
 */
function decodeUnicode(str) {
  if (!str) return '';
  return str.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => {
    return String.fromCharCode(parseInt(hex, 16));
  });
}

/**
 * 查询单只或多只股票最新实时行情 (带服务端 1.5s 内存缓存与并发合并去重)
 */
async function getStockQuote(symbolsInput) {
  const symbols = Array.isArray(symbolsInput) ? symbolsInput : [symbolsInput];
  const normalized = symbols.map(normalizeSymbol).filter(Boolean);
  if (normalized.length === 0) return [];

  const now = Date.now();
  const missing = [];
  const resultsMap = new Map();

  for (const sym of normalized) {
    const cached = serverCache.quote.get(sym);
    if (cached && (now - cached.timestamp < 1500)) {
      resultsMap.set(sym, cached.data);
    } else {
      missing.push(sym);
    }
  }

  if (missing.length === 0) {
    return normalized.map(s => resultsMap.get(s)).filter(Boolean);
  }

  const cacheKey = `quote_${missing.sort().join(',')}`;
  if (inFlight.has(cacheKey)) {
    try {
      await inFlight.get(cacheKey);
      return normalized.map(s => serverCache.quote.get(s)?.data || resultsMap.get(s)).filter(Boolean);
    } catch (_) {}
  }

  const fetchPromise = (async () => {
    try {
      const url = `http://qt.gtimg.cn/q=${missing.join(',')}`;
      const response = await fetchWithTimeout(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, 3500);
      const arrayBuffer = await response.arrayBuffer();
      const text = new TextDecoder('gb18030').decode(arrayBuffer);

      const lines = text.split(';').map(l => l.trim()).filter(l => l.length > 10);

      for (const line of lines) {
        const eqIdx = line.indexOf('=');
        if (eqIdx === -1) continue;
        const rawCode = line.substring(line.indexOf('v_') + 2, eqIdx);
        const content = line.substring(eqIdx + 1).replace(/^"|"$/g, '');
        const parts = content.split('~');

        if (parts.length < 30) continue;

        const name = decodeUnicode(parts[1]);
        const code = parts[2];
        const currentPrice = parseFloat(parts[3]) || 0;
        const prevClose = parseFloat(parts[4]) || 0;
        const openPrice = parseFloat(parts[5]) || 0;
        const volume = parseFloat(parts[6]) || 0;
        const turnover = (parseFloat(parts[37]) || 0) * 10000;
        const high = parseFloat(parts[33]) || 0;
        const low = parseFloat(parts[34]) || 0;
        const change = parseFloat(parts[31]) || (currentPrice - prevClose);
        const changePct = parseFloat(parts[32]) || (prevClose > 0 ? ((currentPrice - prevClose) / prevClose) * 100 : 0);
        const turnoverRate = parseFloat(parts[38]) || 0;
        const peRatio = parseFloat(parts[39]) || null;
        const amplitude = parseFloat(parts[43]) || (prevClose > 0 ? ((high - low) / prevClose) * 100 : 0);
        const floatMarketCap = parseFloat(parts[44]) || null;
        const marketCap = parseFloat(parts[45]) || null;
        const pbRatio = parseFloat(parts[46]) || null;
        const limitUp = parseFloat(parts[47]) || null;
        const limitDown = parseFloat(parts[48]) || null;
        const avgPrice = parseFloat(parts[51]) || null;
        const high52w = parseFloat(parts[67]) || null;
        const low52w = parseFloat(parts[68]) || null;
        const dividendYield = parseFloat(parts[64]) || null;

        const depth = {
          buy: [
            { price: parseFloat(parts[9]) || 0, volume: parseInt(parts[10]) || 0 },
            { price: parseFloat(parts[11]) || 0, volume: parseInt(parts[12]) || 0 },
            { price: parseFloat(parts[13]) || 0, volume: parseInt(parts[14]) || 0 },
            { price: parseFloat(parts[15]) || 0, volume: parseInt(parts[16]) || 0 },
            { price: parseFloat(parts[17]) || 0, volume: parseInt(parts[18]) || 0 }
          ],
          sell: [
            { price: parseFloat(parts[27]) || 0, volume: parseInt(parts[28]) || 0 },
            { price: parseFloat(parts[25]) || 0, volume: parseInt(parts[26]) || 0 },
            { price: parseFloat(parts[23]) || 0, volume: parseInt(parts[24]) || 0 },
            { price: parseFloat(parts[21]) || 0, volume: parseInt(parts[22]) || 0 },
            { price: parseFloat(parts[19]) || 0, volume: parseInt(parts[20]) || 0 }
          ]
        };

        let market = 'A';
        if (rawCode.startsWith('hk')) market = 'HK';
        else if (rawCode.startsWith('us')) market = 'US';
        else if (rawCode.startsWith('sh000') || rawCode.startsWith('sz399') || rawCode.startsWith('int_')) market = 'INDEX';

        const item = {
          symbol: rawCode,
          code,
          name,
          market,
          current_price: currentPrice,
          currentPrice: currentPrice,
          prev_close: prevClose,
          prevClose: prevClose,
          open: openPrice,
          openPrice: openPrice,
          high,
          low,
          change,
          change_pct: changePct,
          changePct: changePct,
          volume,
          turnover,
          turnover_rate: turnoverRate,
          amplitude,
          pe_ratio: peRatio,
          peRatio: peRatio,
          pb_ratio: pbRatio,
          pbRatio: pbRatio,
          float_market_cap: floatMarketCap,
          market_cap: marketCap,
          marketCap: marketCap,
          limit_up: limitUp,
          limit_down: limitDown,
          avg_price: avgPrice,
          high_52w: high52w,
          low_52w: low52w,
          dividend_yield: dividendYield,
          depth,
          timestamp: parts[30] || new Date().toLocaleString()
        };

        serverCache.quote.set(rawCode, { data: item, timestamp: Date.now() });
        resultsMap.set(rawCode, item);
      }
    } catch (err) {
      console.error('Fetch stock quote error:', err.message);
    }
  })();

  inFlight.set(cacheKey, fetchPromise);
  try {
    await fetchPromise;
  } finally {
    inFlight.delete(cacheKey);
  }

  return normalized.map(s => serverCache.quote.get(s)?.data || resultsMap.get(s)).filter(Boolean);
}

/**
 * 获取东财标准 secid 格式 (如 1.600519, 0.000001, 100.HSI, 105.NVDA)
 */
function getEastmoneySecId(symbol) {
  if (!symbol) return '';
  const s = symbol.toLowerCase().trim();
  if (s === 'sh000001' || s === '000001' || s === 'szzs') return '1.000001';
  if (s === 'sz399001' || s === '399001') return '0.399001';
  if (s === 'sz399006' || s === '399006') return '0.399006';
  if (s === 'hkhsi' || s === 'hsi') return '100.HSI';
  if (s === 'usixic' || s === 'ndx') return '100.NDX';
  if (s === 'usinx' || s === 'spx') return '100.SPX';
  if (s === 'int_nikkei' || s === 'n225') return '100.N225';
  if (s === 'int_kospi' || s === 'ks11') return '100.KS11';
  if (s.startsWith('sh')) return `1.${s.slice(2)}`;
  if (s.startsWith('sz')) return `0.${s.slice(2)}`;
  if (s.startsWith('bj')) return `0.${s.slice(2)}`;
  if (s.startsWith('hk')) return `116.${s.slice(2)}`;
  if (s.startsWith('us')) return `105.${s.slice(2).toUpperCase()}`;
  if (s.startsWith('6') || s.startsWith('9')) return `1.${s}`;
  if (s.startsWith('0') || s.startsWith('3') || s.startsWith('8') || s.startsWith('4')) return `0.${s}`;
  if (/^\d{5}$/.test(s)) return `116.${s}`;
  if (/^[a-zA-Z]+$/.test(s)) return `105.${s.toUpperCase()}`;
  return `1.${s}`;
}

/**
 * 模糊拼音、代码与名称搜索股票 (支持腾讯 Smartbox 与 东财智能联想 双引擎，严密防空与去重)
 */
async function searchStock(keyword) {
  if (!keyword || !keyword.trim()) return [];
  const q = keyword.trim();
  const results = [];
  const seen = new Set();

  // 1. 腾讯 Smartbox 引擎
  try {
    const url = `https://smartbox.gtimg.cn/s3/?t=all&q=${encodeURIComponent(q)}`;
    const response = await fetchWithTimeout(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, 3000);
    const arrayBuffer = await response.arrayBuffer();
    const text = new TextDecoder('gb18030').decode(arrayBuffer);

    const match = text.match(/v_hint="([^"]+)"/);
    if (match && match[1] && match[1] !== 'N' && match[1] !== 'None' && match[1].trim() !== '') {
      const items = match[1].split('^').filter(Boolean);
      for (const item of items) {
        const p = item.split('~');
        if (p.length < 3) continue;
        const marketRaw = p[0]?.toLowerCase() || '';
        const code = p[1];
        if (!code || code === 'undefined' || code === 'null') continue;
        const name = decodeUnicode(p[2]);
        if (!name || name === 'undefined' || name.trim() === '') continue;
        const pinyin = p[3] || '';

        let fullCode = `${marketRaw}${code}`;
        let market = 'A';
        if (marketRaw === 'hk') market = 'HK';
        else if (marketRaw === 'us') market = 'US';
        else if (marketRaw === 'sh' && (code.startsWith('000') || code.startsWith('999'))) market = 'INDEX';
        else if (marketRaw === 'sz' && code.startsWith('399')) market = 'INDEX';

        if (!seen.has(fullCode)) {
          seen.add(fullCode);
          results.push({ symbol: fullCode, code, name, pinyin, market });
        }
      }
    }
  } catch (err) {
    console.error('Tencent search error:', err.message);
  }

  // 2. 备用：东财智能联想搜索 (补充港美股与中文模糊匹配)
  if (results.length < 3) {
    try {
      const emUrl = `https://search-api-web.eastmoney.com/search/jsonp?cb=cb&param=${encodeURIComponent(JSON.stringify({
        uid: '',
        keyword: q,
        type: ['suggest'],
        client: 'web',
        clientType: 'web',
        pageIndex: 1,
        pageSize: 10
      }))}`;
      const res = await fetchWithTimeout(emUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } }, 3000);
      const emText = await res.text();
      if (emText.includes('(')) {
        const jsonStr = emText.replace(/^cb\(/, '').replace(/\);?$/, '');
        const json = JSON.parse(jsonStr);
        const list = json.result?.suggest || [];
        for (const item of list) {
          if (item.code && item.name) {
            const sym = normalizeSymbol(item.code);
            if (!seen.has(sym)) {
              seen.add(sym);
              results.push({
                symbol: sym,
                code: item.code,
                name: item.name.replace(/<[^>]+>/g, ''),
                pinyin: item.pinyin || '',
                market: sym.startsWith('hk') ? 'HK' : (sym.startsWith('us') ? 'US' : 'A')
              });
            }
          }
        }
      }
    } catch (err) {
      console.error('Eastmoney search error:', err.message);
    }
  }

  return results;
}

/**
 * 东方财富官方高可用历史 K 线引擎 (日K 101, 周K 102, 月K 103, 5m/15m/30m/60m)
 */
async function getEastmoneyKline(symbol, period, count = 120) {
  if (period === '5day') {
    const secid = getEastmoneySecId(symbol);
    if (!secid) return [];
    try {
      const url = `https://push2his.eastmoney.com/api/qt/stock/trends2/get?secid=${secid}&fields1=f1,f2,f3,f4,f5,f6,f7,f8&fields2=f51,f52,f53,f54,f55,f56,f57,f58`;
      const res = await fetchWithTimeout(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, 3500);
      const json = await res.json();
      const trends = json.data?.trends || [];
      if (!Array.isArray(trends) || trends.length === 0) return [];
      return trends.map(line => {
        const p = line.split(',');
        return {
          time: p[0],
          open: parseFloat(p[1]) || 0,
          close: parseFloat(p[2]) || 0,
          high: parseFloat(p[3]) || 0,
          low: parseFloat(p[4]) || 0,
          volume: parseFloat(p[5]) || 0,
          turnover: parseFloat(p[6]) || 0,
          avg_price: parseFloat(p[7]) || 0
        };
      });
    } catch (_) {
      return [];
    }
  }

  const kltMap = {
    '1m': 1,
    '5m': 5,
    '15m': 15,
    '30m': 30,
    '60m': 60,
    'daily': 101,
    'day': 101,
    'weekly': 102,
    'week': 102,
    'monthly': 103,
    'month': 103
  };
  const klt = kltMap[period];
  if (!klt) return [];

  const secid = getEastmoneySecId(symbol);
  if (!secid) return [];

  try {
    const url = `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${secid}&klt=${klt}&fqt=1&lmt=${count}&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58`;
    const res = await fetchWithTimeout(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, 3500);
    const json = await res.json();
    const klines = json.data?.klines || [];
    if (!Array.isArray(klines) || klines.length === 0) return [];

    return klines.map(line => {
      const p = line.split(',');
      return {
        time: p[0],
        open: parseFloat(p[1]) || 0,
        close: parseFloat(p[2]) || 0,
        high: parseFloat(p[3]) || 0,
        low: parseFloat(p[4]) || 0,
        volume: parseFloat(p[5]) || 0,
        turnover: parseFloat(p[6]) || 0
      };
    });
  } catch (err) {
    return [];
  }
}

/**
 * 将日K线数据精准聚合为真正的周K或月K数据 (防同周期混淆算法)
 */
function aggregateBars(dailyBars, period) {
  if (!dailyBars || dailyBars.length === 0) return [];
  if (period !== 'weekly' && period !== 'monthly' && period !== 'week' && period !== 'month') return dailyBars;

  const isWeekly = period === 'weekly' || period === 'week';
  const groups = new Map();

  dailyBars.forEach(b => {
    const rawTime = (b.time || '').toString().trim();
    if (!rawTime) return;
    let key;
    if (isWeekly) {
      const cleanTime = rawTime.split(' ')[0].replace(/-/g, '/');
      const d = new Date(cleanTime);
      if (isNaN(d.getTime())) {
        key = rawTime.slice(0, 10);
      } else {
        const day = d.getDay();
        const diff = d.getDate() - day + (day === 0 ? -6 : 1);
        const mon = new Date(d);
        mon.setDate(diff);
        const y = mon.getFullYear();
        const m = String(mon.getMonth() + 1).padStart(2, '0');
        const dt = String(mon.getDate()).padStart(2, '0');
        key = `${y}-${m}-${dt}`;
      }
    } else {
      key = rawTime.slice(0, 7); // YYYY-MM
    }

    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(b);
  });

  const aggregated = [];
  groups.forEach((bars) => {
    if (bars.length === 0) return;
    const open = bars[0].open;
    const close = bars[bars.length - 1].close;
    const high = Math.max(...bars.map(x => x.high));
    const low = Math.min(...bars.map(x => x.low));
    const volume = bars.reduce((acc, x) => acc + (x.volume || 0), 0);
    const time = bars[bars.length - 1].time;
    aggregated.push({ time, open, close, high, low, volume });
  });

  return aggregated;
}

/**
 * 获取股票历史 K 线与分时数据 (腾讯 CDN + 东财权威双引擎，周K/月K独立保真)
 */
async function getStockKline(symbol, period = 'intraday', count = 120) {
  const s = symbol.toLowerCase();
  const cacheKey = `kline_${s}_${period}_${count}`;
  const now = Date.now();
  const ttl = (period === 'intraday' || period === '1m') ? 8000 : 60000;

  const cached = serverCache.kline.get(cacheKey);
  if (cached && (now - cached.timestamp < ttl)) {
    return cached.data;
  }

  if (inFlight.has(cacheKey)) {
    try {
      return await inFlight.get(cacheKey);
    } catch (_) {}
  }

  const fetchPromise = (async () => {
    // 0. 全球核心基准指数专业时序引擎 (纳斯达克/标普500/道琼斯/日经225/韩国KOSPI)
    const isUS = s.startsWith('us') || s === 'ndx' || s === 'spx' || s === 'dji';
    const isNikkei = s === 'int_nikkei' || s === 'gb_nikkei' || s === 'n225';
    const isKospi = s === 'int_kospi' || s === 'gb_ks11' || s === 'ks11';

    // 0.1 美股核心基准
    if (isUS) {
      // 优先从东财获取权威 K 线 (含日K/周K/月K)
      if (period !== 'intraday' && period !== '1m') {
        const emBars = await getEastmoneyKline(s, period, count);
        if (emBars.length > 0) return emBars;
      }

      const symMap = { 'usixic': '.IXIC', 'usndx': '.IXIC', 'ndx': '.IXIC', 'usinx': '.INX', 'usspx': '.INX', 'spx': '.INX', 'usdji': '.DJI', 'dji': '.DJI' };
      const sinaSym = symMap[s] || s.replace(/^us/, '').toUpperCase();
      
      if (period === 'daily' || period === 'weekly' || period === 'monthly' || period === 'week' || period === 'month') {
        try {
          const url = `http://stock.finance.sina.com.cn/usstock/api/json_v2.php/US_MinKService.getDailyK?symbol=${encodeURIComponent(sinaSym)}`;
          const res = await fetchWithTimeout(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, 3500);
          const raw = await res.json();
          if (Array.isArray(raw) && raw.length > 0) {
            const daily = raw.map(d => ({
              time: d.d,
              open: parseFloat(d.o),
              close: parseFloat(d.c),
              high: parseFloat(d.h),
              low: parseFloat(d.l),
              volume: parseFloat(d.v) || 0
            }));
            if (period === 'weekly' || period === 'monthly' || period === 'week' || period === 'month') {
              return aggregateBars(daily, period).slice(-count);
            }
            return daily.slice(-count);
          }
        } catch (_) {}
      } else {
        const scaleMap = { '5m': 5, '15m': 15, '30m': 30, '60m': 60, 'intraday': 5 };
        const scale = scaleMap[period] || 5;
        try {
          const url = `http://stock.finance.sina.com.cn/usstock/api/json_v2.php/US_MinKService.getMinK?symbol=${encodeURIComponent(sinaSym)}&type=${scale}`;
          const res = await fetchWithTimeout(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, 3500);
          const raw = await res.json();
          if (Array.isArray(raw) && raw.length > 0) {
            return raw.slice(-count).map(d => {
              const pr = parseFloat(d.c);
              return {
                time: d.d,
                open: parseFloat(d.o) || pr,
                close: pr,
                high: parseFloat(d.h) || pr,
                low: parseFloat(d.l) || pr,
                avg_price: pr,
                volume: parseFloat(d.v) || 0
              };
            });
          }
        } catch (_) {}
      }
    }

    // 0.2 日经225指数 (NK / int_nikkei)
    if (isNikkei) {
      if (period === 'intraday') {
        try {
          const u = 'https://push2.eastmoney.com/api/qt/stock/trends2/get?secid=100.N225&fields1=f1,f2,f3,f4,f5,f6,f7,f8&fields2=f51,f52,f53,f54,f55,f56,f57,f58';
          const res = await fetchWithTimeout(u, { headers: { 'User-Agent': 'Mozilla/5.0' } }, 3500);
          const json = await res.json();
          const raw = json.data?.trends || [];
          if (raw.length > 0) {
            return raw.map(line => {
              const parts = line.split(',');
              const pr = parseFloat(parts[2]) || 0;
              return {
                time: parts[0],
                open: parseFloat(parts[1]) || pr,
                close: pr,
                high: parseFloat(parts[3]) || pr,
                low: parseFloat(parts[4]) || pr,
                volume: parseFloat(parts[5]) || 0,
                avg_price: parseFloat(parts[7]) || pr
              };
            });
          }
        } catch (_) {}
      }

      const emBars = await getEastmoneyKline('int_nikkei', period, count);
      if (emBars.length > 0) return emBars;
    }

    // 0.3 韩国综合指数 (int_kospi / KS11)
    if (isKospi) {
      if (period === 'intraday') {
        try {
          const u = 'https://push2.eastmoney.com/api/qt/stock/trends2/get?secid=100.KS11&fields1=f1,f2,f3,f4,f5,f6,f7,f8&fields2=f51,f52,f53,f54,f55,f56,f57,f58';
          const res = await fetchWithTimeout(u, { headers: { 'User-Agent': 'Mozilla/5.0' } }, 3500);
          const json = await res.json();
          const raw = json.data?.trends || [];
          if (raw.length > 0) {
            return raw.map(line => {
              const parts = line.split(',');
              const pr = parseFloat(parts[2]) || 0;
              return {
                time: parts[0],
                open: parseFloat(parts[1]) || pr,
                close: pr,
                high: parseFloat(parts[3]) || pr,
                low: parseFloat(parts[4]) || pr,
                volume: parseFloat(parts[5]) || 0,
                avg_price: parseFloat(parts[7]) || pr
              };
            });
          }
        } catch (_) {}
      }

      const emBars = await getEastmoneyKline('int_kospi', period, count);
      if (emBars.length > 0) return emBars;
    }

    // 1. 分时数据 (腾讯高速分时引擎)
    if (period === 'intraday' || period === '1m') {
      const isIndex = s.startsWith('sh000') || s.startsWith('sz399') || s.startsWith('hk') || s.startsWith('us') || s.startsWith('int_');
      try {
        const url = `http://web.ifzq.gtimg.cn/appstock/app/minute/query?code=${s}`;
        const res = await fetchWithTimeout(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, 3500);
        const json = await res.json();
        const raw = json.data?.[s]?.data?.data || [];
        if (raw.length > 0) {
          let totalTurnover = 0;
          let totalVolume = 0;

          return raw.map(line => {
            const p = line.split(' ');
            const pr = parseFloat(p[1]) || 0;
            const vol = parseFloat(p[2]) || 0;
            const turnover = parseFloat(p[3]) || (pr * vol * 100);

            totalTurnover += turnover;
            totalVolume += vol;
            let avgPr = (totalVolume > 0 && !isIndex) ? (totalTurnover / (totalVolume * 100)) : pr;
            if (isIndex || avgPr < pr * 0.5 || avgPr > pr * 2) {
              avgPr = pr;
            }

            return {
              time: p[0],
              open: pr,
              close: pr,
              high: pr,
              low: pr,
              avg_price: +avgPr.toFixed(2),
              volume: vol
            };
          });
        }
      } catch (_) {}

      // 备用分时 (东财/新浪)
      try {
        const emBars = await getEastmoneyKline(s, '5m', 60);
        if (emBars.length > 0) return emBars;
      } catch (_) {}

      return [];
    }

    // 2. 腾讯证券高可用高速 CDN 时序引擎 (日K/周K/月K/分钟K)
    try {
      let tParam = 'day';
      if (period === 'weekly' || period === 'week') tParam = 'week';
      else if (period === 'monthly' || period === 'month') tParam = 'month';
      else if (period === '5m') tParam = 'm5';
      else if (period === '15m') tParam = 'm15';
      else if (period === '30m') tParam = 'm30';
      else if (period === '60m') tParam = 'm60';

      const isMin = tParam.startsWith('m');
      const url = isMin
        ? `http://web.ifzq.gtimg.cn/appstock/app/kline/mkline?param=${s},${tParam},,${count}`
        : `http://web.ifzq.gtimg.cn/appstock/app/kline/kline?param=${s},${tParam},,,${count}`;

      const res = await fetchWithTimeout(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, 3500);
      const json = await res.json();
      const symData = json.data?.[s] || {};
      const rawList = symData[tParam] || symData[`qfq${tParam}`] || symData[`hfq${tParam}`] || [];

      if (rawList.length > 0) {
        return rawList.map(p => ({
          time: p[0],
          open: parseFloat(p[1]),
          close: parseFloat(p[2]),
          high: parseFloat(p[3]),
          low: parseFloat(p[4]),
          volume: parseFloat(p[5]) || 0
        }));
      }
    } catch (_) {}

    // 3. 东方财富官方权威 K 线时序引擎 (备用，全市场高精度覆盖)
    try {
      const emBars = await getEastmoneyKline(s, period, count);
      if (emBars.length > 0) {
        return emBars;
      }
    } catch (_) {}

    // 4. 新浪时序兜底引擎 (针对周K/月K自动聚合，杜绝出现周K月K显示为日K)
    if (s.startsWith('sh') || s.startsWith('sz')) {
      try {
        const isPeriodWeekOrMonth = period === 'weekly' || period === 'monthly' || period === 'week' || period === 'month';
        const sinaScale = isPeriodWeekOrMonth ? 240 : (period === '5m' ? 5 : (period === '15m' ? 15 : (period === '30m' ? 30 : (period === '60m' ? 60 : 240))));
        const reqCount = isPeriodWeekOrMonth ? Math.max(count * 6, 240) : count;

        const url = `http://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData?symbol=${s}&scale=${sinaScale}&ma=no&datalen=${reqCount}`;
        const res = await fetchWithTimeout(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, 3500);
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) {
          const bars = data.map(d => ({
            time: d.day,
            open: parseFloat(d.open),
            close: parseFloat(d.close),
            high: parseFloat(d.high),
            low: parseFloat(d.low),
            volume: parseFloat(d.volume)
          }));
          if (isPeriodWeekOrMonth) {
            return aggregateBars(bars, period).slice(-count);
          }
          return bars.slice(-count);
        }
      } catch (_) {}
    }

    return [];
  })();

  inFlight.set(cacheKey, fetchPromise);
  try {
    const bars = await fetchPromise;
    if (bars && bars.length > 0) {
      serverCache.kline.set(cacheKey, { data: bars, timestamp: Date.now() });
    }
    return bars;
  } finally {
    inFlight.delete(cacheKey);
  }
}

/**
 * 获取个股完整 F10 深度档案 (带 30分钟 服务端缓存与去重)
 */
async function getCompanyF10(symbol) {
  const s = symbol.toLowerCase();
  const cacheKey = `f10_${s}`;
  const now = Date.now();

  const cached = serverCache.f10.get(cacheKey);
  if (cached && (now - cached.timestamp < 30 * 60 * 1000)) {
    return cached.data;
  }

  if (inFlight.has(cacheKey)) {
    try {
      return await inFlight.get(cacheKey);
    } catch (_) {}
  }

  const fetchPromise = (async () => {
    const rawCode = s.replace(/^(sh|sz|bj|hk|us)/, '');
    const isSh = s.startsWith('sh') || rawCode.startsWith('6');
    const marketPrefix = isSh ? 'SH' : 'SZ';
    const fullEastmoneyCode = marketPrefix + rawCode;

    try {
      const [profileRes, finaRes, themesRes] = await Promise.all([
        fetchWithTimeout(`https://emweb.securities.eastmoney.com/PC_HSF10/CompanySurvey/CompanySurveyAjax?code=${fullEastmoneyCode}`, { headers: { 'User-Agent': 'Mozilla/5.0' } }, 3500).then(r => r.json()).catch(() => ({})),
        fetchWithTimeout(`https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPT_F10_FINANCE_MAINFINADATA&columns=ALL&filter=(SECURITY_CODE%3D%22${rawCode}%22)&pageNumber=1&pageSize=4&sortTypes=-1&sortColumns=REPORT_DATE`, { headers: { 'User-Agent': 'Mozilla/5.0' } }, 3500).then(r => r.json()).catch(() => ({})),
        fetchWithTimeout(`https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPT_F10_CORETHEME_BOARDTYPE&columns=ALL&filter=(SECURITY_CODE%3D%22${rawCode}%22)`, { headers: { 'User-Agent': 'Mozilla/5.0' } }, 3500).then(r => r.json()).catch(() => ({}))
      ]);

      const jbzl = profileRes.jbzl || {};
      const fxxg = profileRes.fxxg || {};
      const latestFina = finaRes.result?.data?.[0] || {};
      const themes = (themesRes.result?.data || []).map(t => t.BOARD_NAME).filter(Boolean);

      return {
        symbol: s,
        code: rawCode,
        name: jbzl.gsmc || jbzl.agjc || '未知企业',
        short_name: jbzl.agjc || '',
        industry: jbzl.sshy || jbzl.sszjhhy || '--',
        legal_person: jbzl.frdb || '--',
        reg_capital: jbzl.zczb || '--',
        established_date: fxxg.clrq || '--',
        listing_date: fxxg.ssrq || '--',
        website: jbzl.gswz || '--',
        address: jbzl.zcdz || '--',
        business_scope: jbzl.jyfw || '--',
        description: (jbzl.gsjj || '').trim() || '暂无公司详细介绍',
        concepts: themes.slice(0, 18),
        financials: {
          report_period: latestFina.REPORT_DATE_NAME || '最新财报',
          revenue: latestFina.TOTALOPERATEREVE ? (latestFina.TOTALOPERATEREVE / 100000000).toFixed(2) + ' 亿' : '--',
          revenue_yoy: latestFina.TOTALOPERATEREVETZ !== null && latestFina.TOTALOPERATEREVETZ !== undefined ? latestFina.TOTALOPERATEREVETZ.toFixed(2) + '%' : '--',
          net_profit: latestFina.PARENTNETPROFIT ? (latestFina.PARENTNETPROFIT / 100000000).toFixed(2) + ' 亿' : '--',
          net_profit_yoy: latestFina.PARENTNETPROFITTZ !== null && latestFina.PARENTNETPROFITTZ !== undefined ? latestFina.PARENTNETPROFITTZ.toFixed(2) + '%' : '--',
          roe: latestFina.ROEJQ !== null && latestFina.ROEJQ !== undefined ? latestFina.ROEJQ.toFixed(2) + '%' : '--',
          gross_margin: latestFina.XSMLL !== null && latestFina.XSMLL !== undefined ? latestFina.XSMLL.toFixed(2) + '%' : '--',
          net_margin: latestFina.XSJLL !== null && latestFina.XSJLL !== undefined ? latestFina.XSJLL.toFixed(2) + '%' : '--',
          debt_ratio: latestFina.ZCFZL !== null && latestFina.ZCFZL !== undefined ? latestFina.ZCFZL.toFixed(2) + '%' : '--',
          eps: latestFina.EPSJB !== null && latestFina.EPSJB !== undefined ? '¥' + latestFina.EPSJB.toFixed(2) : '--',
          bps: latestFina.BPS !== null && latestFina.BPS !== undefined ? '¥' + latestFina.BPS.toFixed(2) : '--'
        }
      };
    } catch (err) {
      console.error(`Fetch F10 error for ${symbol}:`, err.message);
      return null;
    }
  })();

  inFlight.set(cacheKey, fetchPromise);
  try {
    const data = await fetchPromise;
    if (data) {
      serverCache.f10.set(cacheKey, { data, timestamp: Date.now() });
    }
    return data;
  } finally {
    inFlight.delete(cacheKey);
  }
}

/**
 * 获取个股即时新闻与官方公告 (带 3分钟 服务端缓存与去重)
 */
async function getStockNewsAndNotices(symbol, stockName = '') {
  const s = symbol.toLowerCase();
  const rawCode = s.replace(/^(sh|sz|bj|hk|us)/, '');
  const searchKeyword = stockName || rawCode;
  const cacheKey = `news_${s}_${searchKeyword}`;
  const now = Date.now();

  const cached = serverCache.news.get(cacheKey);
  if (cached && (now - cached.timestamp < 3 * 60 * 1000)) {
    return cached.data;
  }

  if (inFlight.has(cacheKey)) {
    try {
      return await inFlight.get(cacheKey);
    } catch (_) {}
  }

  const fetchPromise = (async () => {
    try {
      const [noticesRes, newsRes] = await Promise.all([
        // 官方公告
        fetchWithTimeout(`https://np-anotice-stock.eastmoney.com/api/security/ann?sr=-1&page_size=10&page_index=1&ann_type=A&client_source=web&stock_list=${rawCode}`, { headers: { 'User-Agent': 'Mozilla/5.0' } }, 3500)
          .then(r => r.json())
          .catch(() => ({})),
        // 即时新闻
        fetchWithTimeout(`https://search-api-web.eastmoney.com/search/jsonp?cb=cb&param=${encodeURIComponent(JSON.stringify({
          uid: '',
          keyword: searchKeyword,
          type: ['cmsArticleWebOld'],
          client: 'web',
          clientType: 'web',
          pageIndex: 1,
          pageSize: 10
        }))}`, { headers: { 'User-Agent': 'Mozilla/5.0' } }, 3500)
          .then(r => r.text())
          .catch(() => '')
      ]);

      // 解析官方公告
      const rawNotices = noticesRes?.data?.list || [];
      const notices = rawNotices.map(a => ({
        title: a.title_ch || a.title || '公司公告',
        date: a.notice_date ? a.notice_date.split(' ')[0] : '',
        code: a.art_code,
        url: `https://data.eastmoney.com/notices/detail/${rawCode}/${a.art_code}.html`
      }));

      // 解析即时新闻
      let news = [];
      if (newsRes && newsRes.includes('(')) {
        try {
          const jsonStr = newsRes.replace(/^cb\(/, '').replace(/\);?$/, '');
          const newsJson = JSON.parse(jsonStr);
          const rawNews = newsJson.result?.cmsArticleWebOld || [];
          news = rawNews.map(n => ({
            title: (n.title || '').replace(/<[^>]+>/g, ''),
            date: n.date || '',
            media: n.media_name || '财经资讯',
            url: n.url || `https://finance.eastmoney.com/a/${n.code}.html`
          }));
        } catch (_) {}
      }

      return {
        symbol: s,
        code: rawCode,
        notices,
        news
      };
    } catch (err) {
      console.error(`Fetch news & notices error for ${symbol}:`, err.message);
      return { symbol: s, code: rawCode, notices: [], news: [] };
    }
  })();

  inFlight.set(cacheKey, fetchPromise);
  try {
    const data = await fetchPromise;
    if (data) {
      serverCache.news.set(cacheKey, { data, timestamp: Date.now() });
    }
    return data;
  } finally {
    inFlight.delete(cacheKey);
  }
}

/**
 * 生成全景 AI 智能量化与基本面深度诊断分析 (带 5分钟 服务端缓存与去重)
 */
async function generateStockAIAnalysis(symbol) {
  const s = symbol.toLowerCase();
  const cacheKey = `ai_${s}`;
  const now = Date.now();

  const cached = serverCache.ai.get(cacheKey);
  if (cached && (now - cached.timestamp < 5 * 60 * 1000)) {
    return cached.data;
  }

  if (inFlight.has(cacheKey)) {
    try {
      return await inFlight.get(cacheKey);
    } catch (_) {}
  }

  const fetchPromise = (async () => {
    const rawCode = s.replace(/^(sh|sz|bj|hk|us)/, '');

    try {
      const [quotes, dailyBars, f10Data, newsData] = await Promise.all([
        getStockQuote([symbol]),
        getStockKline(symbol, 'daily', 30),
        getCompanyF10(symbol),
        getStockNewsAndNotices(symbol)
      ]);

      const q = quotes[0] || {};
      const fin = f10Data?.financials || {};
      const news = newsData?.news || [];
      const notices = newsData?.notices || [];

      const name = q.name || f10Data?.name || rawCode;
      const curPrice = q.current_price || 0;
      const changePct = q.change_pct || 0;
      const pe = q.pe_ratio || 0;
      const pb = q.pb_ratio || 0;
      const roeNum = parseFloat(fin.roe) || 10;
      const profitYoY = parseFloat(fin.net_profit_yoy) || 0;

      // 1. 技术面因子计算 (最近 30 日)
      let techScore = 65;
      let ma5 = 0, ma10 = 0, ma20 = 0;
      let lowest20 = curPrice, highest20 = curPrice;

      if (dailyBars.length >= 5) {
        const closes = dailyBars.map(b => b.close);
        ma5 = closes.slice(-5).reduce((a, b) => a + b, 0) / 5;
        if (closes.length >= 10) ma10 = closes.slice(-10).reduce((a, b) => a + b, 0) / 10;
        if (closes.length >= 20) {
          ma20 = closes.slice(-20).reduce((a, b) => a + b, 0) / 20;
          const slice20 = dailyBars.slice(-20);
          lowest20 = Math.min(...slice20.map(b => b.low || b.close));
          highest20 = Math.max(...slice20.map(b => b.high || b.close));
        }

        if (curPrice > ma5 && ma5 > ma10) techScore += 12;
        if (curPrice > ma20) techScore += 8;
        if (curPrice < ma20) techScore -= 10;
        if (changePct > 0) techScore += 5;
      }

      // 2. 基本面因子计算
      let fundScore = 60;
      if (roeNum > 15) fundScore += 18;
      else if (roeNum > 8) fundScore += 10;
      if (profitYoY > 15) fundScore += 12;
      else if (profitYoY > 0) fundScore += 5;
      else fundScore -= 10;

      // 3. 估值因子计算
      let valScore = 65;
      if (pe > 0 && pe < 25) valScore += 15;
      else if (pe >= 25 && pe < 50) valScore += 5;
      else if (pe >= 50) valScore -= 12;

      // 4. 情绪与消息面因子
      let sentScore = 70;
      if (q.turnover_rate > 3) sentScore += 10;
      if (news.length > 5) sentScore += 5;

      // 综合加权总分 (0-100)
      techScore = Math.max(30, Math.min(98, Math.round(techScore)));
      fundScore = Math.max(30, Math.min(98, Math.round(fundScore)));
      valScore = Math.max(30, Math.min(98, Math.round(valScore)));
      sentScore = Math.max(30, Math.min(98, Math.round(sentScore)));

      const totalScore = Math.round(techScore * 0.35 + fundScore * 0.30 + valScore * 0.20 + sentScore * 0.15);

      // 评级与核心定性
      let ratingTag = '⚖️ 震荡蓄势';
      let ratingColor = '#f59e0b';
      let ratingSummary = '该股目前处于多空力量相对均衡的震荡蓄势期，建议以区间波段或分批定投策略为主。';

      if (totalScore >= 85) {
        ratingTag = '🚀 强烈看多';
        ratingColor = '#ef4444';
        ratingSummary = '基本面优质强劲，技术面形成多头排列与量能共振，中短期上攻动能充沛！';
      } else if (totalScore >= 72) {
        ratingTag = '📈 偏多积极';
        ratingColor = '#f97316';
        ratingSummary = '估值合理且财务稳健，技术形态处于上升通道中，可逢回调企稳积极关注。';
      } else if (totalScore < 50) {
        ratingTag = '⚠️ 谨慎防守';
        ratingColor = '#10b981';
        ratingSummary = '短期指标偏弱或面临估值/业绩增速承压，建议控制仓位并注意破位止损风险。';
      }

      // 支撑位与阻力位预测
      const supportPrice = +(lowest20 * 0.985).toFixed(2);
      const resistancePrice = +(highest20 * 1.02).toFixed(2);
      const stopLossPrice = +(curPrice * 0.94).toFixed(2);

      // 构建完整 AI Prompt 报告
      const promptReport = `# 🤖 【${name} (${symbol.toUpperCase()})】AI 深度诊断与量化分析档案

## 📊 1. 核心行情与盘口指标
- **股票名称/代码**: ${name} (${symbol})
- **最新现价**: ¥${curPrice.toFixed(2)} (涨跌幅: ${(changePct>=0?'+':'') + changePct.toFixed(2)}%)
- **今日振幅/换手率**: 振幅 ${q.amplitude?.toFixed(2)||'--'}% / 换手率 ${q.turnover_rate?.toFixed(2)||'--'}%
- **成交金额**: ¥${q.turnover ? (q.turnover/100000000).toFixed(2)+'亿' : '--'} (成交量: ${q.volume ? (q.volume/10000).toFixed(1)+'万手' : '--'})
- **估值水平**: PE(动态): ${pe?.toFixed(2)||'--'} / PB: ${pb?.toFixed(2)||'--'} / 股息率: ${q.dividend_yield?.toFixed(2)||'--'}%
- **总市值/流通市值**: ¥${q.market_cap ? q.market_cap.toFixed(0)+'亿' : '--'} / ¥${q.float_market_cap ? q.float_market_cap.toFixed(0)+'亿' : '--'}

## 🏢 2. 基本面与财务中枢 (F10)
- **所属行业**: ${f10Data?.industry || '综合'}
- **核心题材概念**: ${(f10Data?.concepts || []).join('、') || '暂无'}
- **营业总收入**: ${fin.revenue || '--'} (同比增速: ${fin.revenue_yoy || '--'})
- **归母净利润**: ${fin.net_profit || '--'} (同比增速: ${fin.net_profit_yoy || '--'})
- **加权净资产收益率 (ROE)**: ${fin.roe || '--'} (销售毛利率: ${fin.gross_margin || '--'} / 净利率: ${fin.net_margin || '--'})
- **资产负债率**: ${fin.debt_ratio || '--'} (EPS: ¥${fin.eps || '--'} / BPS: ¥${fin.bps || '--'})
- **主营业务概要**: ${f10Data?.business_scope || '主营产品与行业领先服务'}

## 📈 3. 量化技术面研判
- **均线系统**: 5日均线 ¥${ma5.toFixed(2)} / 10日均线 ¥${ma10.toFixed(2)} / 20日均线 ¥${ma20.toFixed(2)}
- **多空排列状态**: ${curPrice > ma5 && ma5 > ma10 ? '多头排列向上发散 (强势特征)' : (curPrice < ma20 ? '空头压制调整 (弱势格局)' : '均线缠绕震荡 (方向待明)')}
- **近20日关键阻力位**: ¥${resistancePrice} (压力区)
- **近20日关键支撑位**: ¥${supportPrice} (支撑区)
- **建议止损参考位**: ¥${stopLossPrice} (-6.0% 纪律止损)

## 📰 4. 最新重要官方公告与全网舆情 (含原文链接，方便 AI 直接调阅与溯源)
### 📢 官方披露公告
${notices.slice(0, 5).map((a, i) => `${i+1}. [${a.date}] [${a.title}](${a.url})`).join('\n') || '- 暂无近期重大官方披露公告'}

### 🌐 全网最新权威财经舆情与资讯
${news.slice(0, 5).map((n, i) => `${i+1}. [${n.date} · ${n.media}] [${n.title}](${n.url})`).join('\n') || '- 暂无近期重大突发舆情快讯'}

---
### 🎯 请依据上述全部多维度全景数据（包含盘口指标、F10财务、技术形态与公告/资讯），为我提供一份深度的投研决策分析报告：
1. 诊断该股票目前的核心投资价值与估值溢价/折价合理性；
2. 给出未来 1~3 个月的中短期走势推演与阻力/支撑突破策略；
3. 结合最新官方公告与舆情链接内容，指出当前最大的潜在利好催化或黑天鹅风险与防守仓位配比建议。
`;

      return {
        symbol: s,
        name,
        total_score: totalScore,
        rating_tag: ratingTag,
        rating_color: ratingColor,
        rating_summary: ratingSummary,
        radar: {
          technical: techScore,
          fundamental: fundScore,
          valuation: valScore,
          growth: Math.min(98, Math.max(30, Math.round(50 + profitYoY))),
          sentiment: sentScore
        },
        levels: {
          support: supportPrice,
          resistance: resistancePrice,
          stop_loss: stopLossPrice
        },
        insights: [
          {
            title: '📈 技术面走势分析',
            desc: `当前现价处于 ${curPrice > ma20 ? '20日均线上方，短期属于偏强' : '20日均线下方，短期仍面临均线反压'} 态势。关键短线支撑位在 ¥${supportPrice}，上方第一强阻力位在 ¥${resistancePrice}。`
          },
          {
            title: '🏢 基本面与财务健康度',
            desc: `加权 ROE 为 ${fin.roe || '--'}，销售毛利率 ${fin.gross_margin || '--'}，净利润同比增速达 ${fin.net_profit_yoy || '--'}。在【${f10Data?.industry || '该行业'}】中具备较好的抗周期与现金流盈利韧性。`
          },
          {
            title: '🏷️ 题材概念与行业催化',
            desc: `核心覆盖【${(f10Data?.concepts || []).slice(0, 4).join(' / ') || '核心赛道'}】等主流热点板块，宏观与产业政策流动性对其估值具有良好支撑。`
          },
          {
            title: '🎯 操盘与仓位策略',
            desc: `${totalScore >= 75 ? '建议逢低分批建仓或持股待涨，以 20 日均线或 ¥' + stopLossPrice + ' 作为跟踪止损位。' : '建议以高抛低吸区间震荡操作为主，突破 ¥' + resistancePrice + ' 后可顺势右侧加仓。'}`
          }
        ],
        prompt_report: promptReport
      };
    } catch (err) {
      console.error(`Generate AI analysis error for ${symbol}:`, err.message);
      return null;
    }
  })();

  inFlight.set(cacheKey, fetchPromise);
  try {
    const data = await fetchPromise;
    if (data) {
      serverCache.ai.set(cacheKey, { data, timestamp: Date.now() });
    }
    return data;
  } finally {
    inFlight.delete(cacheKey);
  }
}

/**
 * 获取全球核心指数 (带 2秒 服务端缓存与去重)
 */
async function getGlobalIndices() {
  const now = Date.now();
  if (serverCache.indices.data && (now - serverCache.indices.timestamp < 2000)) {
    return serverCache.indices.data;
  }

  const cacheKey = 'global_indices';
  if (inFlight.has(cacheKey)) {
    try {
      return await inFlight.get(cacheKey);
    } catch (_) {}
  }

  const promise = (async () => {
    try {
      const emUrl = 'https://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=20&po=1&np=1&fltt=2&invt=2&fid=f3&fs=i:1.000001,i:0.399001,i:0.399006,i:100.HSI,i:100.NDX,i:100.SPX,i:100.N225,i:100.KS11';
      const res = await fetchWithTimeout(emUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } }, 3500);
      const json = await res.json();
      const diff = json.data?.diff || [];

      const orderKeys = ['000001', '399001', '399006', 'HSI', 'NDX', 'SPX', 'N225', 'KS11'];
      const metaMap = {
        '000001': { symbol: 'sh000001', name: '上证指数', short: '上证', market: 'INDEX' },
        '399001': { symbol: 'sz399001', name: '深证成指', short: '深证', market: 'INDEX' },
        '399006': { symbol: 'sz399006', name: '创业板指', short: '创业板', market: 'INDEX' },
        'HSI': { symbol: 'hkHSI', name: '恒生指数', short: '恒指', market: 'HK' },
        'NDX': { symbol: 'usIXIC', name: '纳斯达克', short: '纳指', market: 'US' },
        'SPX': { symbol: 'usINX', name: '标普500', short: '标普', market: 'US' },
        'N225': { symbol: 'int_nikkei', name: '日经225', short: '日经', market: 'GLOBAL' },
        'KS11': { symbol: 'int_kospi', name: '韩国综合', short: '韩国', market: 'GLOBAL' }
      };

      const mapResult = {};
      diff.forEach(d => {
        const meta = metaMap[d.f12];
        if (meta) {
          mapResult[d.f12] = {
            symbol: meta.symbol,
            name: meta.name,
            short_name: meta.short,
            current_price: parseFloat(d.f2) || 0,
            change: parseFloat(d.f4) || 0,
            change_pct: parseFloat(d.f3) || 0,
            market: meta.market
          };
        }
      });

      const list = orderKeys.map(k => mapResult[k]).filter(Boolean);
      if (list.length > 0) {
        serverCache.indices = { data: list, timestamp: Date.now() };
      }
      return list;
    } catch (err) {
      console.error('Fetch global indices error:', err.message);
      return serverCache.indices.data || [];
    }
  })();

  inFlight.set(cacheKey, promise);
  try {
    return await promise;
  } finally {
    inFlight.delete(cacheKey);
  }
}

/**
 * 格式化股票实时行情为 Markdown 卡片
 */
function formatQuoteMarkdown(quote) {
  if (!quote) return '暂无行情数据';
  const isUp = (quote.change || 0) >= 0;
  const emoji = isUp ? '📈' : '📉';
  const sign = isUp ? '+' : '';
  const price = quote.current_price != null ? quote.current_price.toFixed(2) : '--';
  const changeVal = quote.change != null ? `${sign}${quote.change.toFixed(2)}` : '--';
  const changePct = quote.change_pct != null ? `${sign}${quote.change_pct.toFixed(2)}%` : '--';
  const open = quote.open != null ? quote.open.toFixed(2) : '--';
  const prevClose = quote.prev_close != null ? quote.prev_close.toFixed(2) : '--';
  const high = quote.high != null ? quote.high.toFixed(2) : '--';
  const low = quote.low != null ? quote.low.toFixed(2) : '--';
  const pe = quote.pe_ratio != null ? quote.pe_ratio.toFixed(2) : '--';
  const pb = quote.pb_ratio != null ? quote.pb_ratio.toFixed(2) : '--';

  let turnoverStr = '--';
  if (quote.turnover != null) {
    if (quote.turnover >= 100000000) {
      turnoverStr = `¥${(quote.turnover / 100000000).toFixed(2)} 亿`;
    } else if (quote.turnover >= 10000) {
      turnoverStr = `¥${(quote.turnover / 10000).toFixed(2)} 万`;
    } else {
      turnoverStr = `¥${quote.turnover.toFixed(0)}`;
    }
  }

  let marketCapStr = '--';
  if (quote.market_cap != null) {
    marketCapStr = `${quote.market_cap.toFixed(2)} 亿`;
  }

  const time = quote.timestamp || new Date().toLocaleString();

  return `### ${emoji} ${quote.name} (\`${quote.symbol}\`) [${quote.market || 'A'}]
| 核心指标 | 数值 | 交易盘口 | 数值 |
| :--- | :--- | :--- | :--- |
| **最新现价** | **${price}** | **今开 / 昨收** | ${open} / ${prevClose} |
| **涨跌幅** | **${changePct} (${changeVal})** | **最高 / 最低** | ${high} / ${low} |
| **市盈率 (PE) / PB** | ${pe} / ${pb} | **成交额** | ${turnoverStr} |
| **总市值** | ${marketCapStr} | **行情时间** | \`${time}\` |`;
}

/**
 * 获取全市场领涨行业板块与热门概念题材榜单
 */
async function getHotSectors() {
  const cacheKey = 'hot_sectors';
  const cached = serverCache.f10.get(cacheKey);
  if (cached && (Date.now() - cached.timestamp < 15000)) {
    return cached.data;
  }
  try {
    const [indRes, conRes] = await Promise.all([
      fetchWithTimeout('https://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=15&po=1&np=1&ut=bd1d9ddb04089700cf9c27f6f7426281&fltt=2&invt=2&fid=f3&fs=m:90+t:2+f:!50&fields=f2,f3,f4,f12,f14,f104,f105,f128,f140,f136', { headers: { 'User-Agent': 'Mozilla/5.0' } }, 3500).then(r => r.json()),
      fetchWithTimeout('https://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=15&po=1&np=1&ut=bd1d9ddb04089700cf9c27f6f7426281&fltt=2&invt=2&fid=f3&fs=m:90+t:3+f:!50&fields=f2,f3,f4,f12,f14,f104,f105,f128,f140,f136', { headers: { 'User-Agent': 'Mozilla/5.0' } }, 3500).then(r => r.json())
    ]);

    const formatList = (list = []) => list.map(item => ({
      code: item.f12,
      name: item.f14,
      change_pct: item.f3 || 0,
      lead_stock_name: item.f128 || '--',
      lead_stock_code: item.f140 || '',
      lead_stock_pct: item.f136 || 0
    }));

    const result = {
      industry: formatList(indRes.data?.diff || []),
      concept: formatList(conRes.data?.diff || [])
    };
    serverCache.f10.set(cacheKey, { data: result, timestamp: Date.now() });
    return result;
  } catch (err) {
    return { industry: [], concept: [] };
  }
}

/**
 * 获取指定板块内的领涨成分股
 */
async function getSectorStocks(sectorCode) {
  if (!sectorCode) return [];
  const cacheKey = `sector_stocks_${sectorCode}`;
  const cached = serverCache.f10.get(cacheKey);
  if (cached && (Date.now() - cached.timestamp < 15000)) {
    return cached.data;
  }
  try {
    const url = `https://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=10&po=1&np=1&ut=bd1d9ddb04089700cf9c27f6f7426281&fltt=2&invt=2&fid=f3&fs=b:${sectorCode}&fields=f2,f3,f4,f12,f14,f62,f184,f66`;
    const res = await fetchWithTimeout(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, 3500).then(r => r.json());
    const list = (res.data?.diff || []).map(item => {
      const c = String(item.f12);
      const prefix = (c.startsWith('6') || c.startsWith('9')) ? 'sh' : (c.startsWith('8') || c.startsWith('4') ? 'bj' : 'sz');
      return {
        symbol: `${prefix}${c}`,
        code: c,
        name: item.f14,
        price: item.f2 || 0,
        change_pct: item.f3 || 0
      };
    });
    serverCache.f10.set(cacheKey, { data: list, timestamp: Date.now() });
    return list;
  } catch (err) {
    return [];
  }
}

/**
 * 获取个股主力、大单、中单、小单资金流向明细
 */
async function getStockFundFlow(symbol) {
  const s = symbol.toLowerCase();
  const secid = getEastmoneySecId(s);
  if (!secid) return null;

  const cacheKey = `fund_flow_${s}`;
  const cached = serverCache.f10.get(cacheKey);
  if (cached && (Date.now() - cached.timestamp < 30000)) {
    return cached.data;
  }

  try {
    const url = `https://push2his.eastmoney.com/api/qt/stock/fflow/kline/get?secid=${secid}&lmt=6&klt=101&fields1=f1,f2,f3,f7&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61,f62,f63,f64,f65`;
    const res = await fetchWithTimeout(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, 3500).then(r => r.json());
    const klines = res.data?.klines || [];
    if (!Array.isArray(klines) || klines.length === 0) return null;

    const history = klines.map(line => {
      const p = line.split(',');
      return {
        date: p[0],
        main_inflow: parseFloat(p[1]) || 0,
        small_inflow: parseFloat(p[2]) || 0,
        medium_inflow: parseFloat(p[3]) || 0,
        large_inflow: parseFloat(p[4]) || 0,
        super_large_inflow: parseFloat(p[5]) || 0
      };
    });

    const latest = history[history.length - 1];
    const total = Math.abs(latest.super_large_inflow) + Math.abs(latest.large_inflow) + Math.abs(latest.medium_inflow) + Math.abs(latest.small_inflow) || 1;

    const data = {
      latest,
      history,
      ratios: {
        super_large: +(Math.abs(latest.super_large_inflow) / total * 100).toFixed(1),
        large: +(Math.abs(latest.large_inflow) / total * 100).toFixed(1),
        medium: +(Math.abs(latest.medium_inflow) / total * 100).toFixed(1),
        small: +(Math.abs(latest.small_inflow) / total * 100).toFixed(1)
      }
    };

    serverCache.f10.set(cacheKey, { data, timestamp: Date.now() });
    return data;
  } catch (err) {
    return null;
  }
}

export {
  normalizeSymbol,
  getStockQuote,
  searchStock,
  getStockKline,
  getCompanyF10,
  getStockNewsAndNotices,
  generateStockAIAnalysis,
  getGlobalIndices,
  getHotSectors,
  getSectorStocks,
  getStockFundFlow,
  formatQuoteMarkdown
};

export default {
  normalizeSymbol,
  getStockQuote,
  searchStock,
  getStockKline,
  getCompanyF10,
  getStockNewsAndNotices,
  generateStockAIAnalysis,
  getGlobalIndices,
  getHotSectors,
  getSectorStocks,
  getStockFundFlow,
  formatQuoteMarkdown
};
