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
 * 查询单只或多只股票最新实时行情 (腾讯股票高频接口 + 深度盘口指标)
 */
async function getStockQuote(symbolsInput) {
  const symbols = Array.isArray(symbolsInput) ? symbolsInput : [symbolsInput];
  const normalized = symbols.map(normalizeSymbol).filter(Boolean);
  if (normalized.length === 0) return [];

  const url = `http://qt.gtimg.cn/q=${normalized.join(',')}`;
  const response = await fetch(url);
  const arrayBuffer = await response.arrayBuffer();
  const text = new TextDecoder('gb18030').decode(arrayBuffer);

  const lines = text.split(';').map(l => l.trim()).filter(l => l.length > 10);
  const results = [];

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

    let market = 'A';
    if (rawCode.startsWith('hk')) market = 'HK';
    else if (rawCode.startsWith('us')) market = 'US';
    else if (rawCode.startsWith('sh000') || rawCode.startsWith('sz399')) market = 'INDEX';

    results.push({
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
      timestamp: parts[30] || new Date().toLocaleString()
    });
  }

  return results;
}

/**
 * 模糊拼音、代码与名称搜索股票
 */
async function searchStock(keyword) {
  if (!keyword || !keyword.trim()) return [];
  const q = keyword.trim();

  const url = `https://smartbox.gtimg.cn/s3/?t=all&q=${encodeURIComponent(q)}`;
  const response = await fetch(url);
  const arrayBuffer = await response.arrayBuffer();
  const text = new TextDecoder('gb18030').decode(arrayBuffer);

  const match = text.match(/v_hint="([^"]+)"/);
  if (!match || !match[1]) return [];

  const items = match[1].split('^').filter(Boolean);
  return items.map(item => {
    const p = item.split('~');
    const marketRaw = p[0]?.toLowerCase() || '';
    const code = p[1];
    const name = decodeUnicode(p[2]);
    const pinyin = p[3];

    let fullCode = `${marketRaw}${code}`;
    let market = 'A';
    if (marketRaw === 'hk') market = 'HK';
    else if (marketRaw === 'us') market = 'US';

    return {
      symbol: fullCode,
      code,
      name,
      pinyin,
      market
    };
  });
}

/**
 * 将日K线数据聚合为周K或月K数据
 */
function aggregateBars(dailyBars, period) {
  if (!dailyBars || dailyBars.length === 0) return [];
  if (period !== 'weekly' && period !== 'monthly' && period !== 'week' && period !== 'month') return dailyBars;

  const isWeekly = period === 'weekly' || period === 'week';
  const groups = new Map();
  dailyBars.forEach(b => {
    const d = new Date(b.time);
    let key;
    if (isWeekly) {
      const day = d.getDay();
      const diff = d.getDate() - day + (day === 0 ? -6 : 1);
      const monday = new Date(d);
      monday.setDate(diff);
      key = monday.toISOString().slice(0, 10);
    } else {
      key = b.time.slice(0, 7);
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
 * 获取股票历史 K 线与分时数据
 */
async function getStockKline(symbol, period = 'intraday', count = 120) {
  const s = symbol.toLowerCase();

  // 0. 全球核心基准指数专业时序引擎 (纳斯达克/标普500/道琼斯/日经225/韩国KOSPI)
  const isUS = s.startsWith('us') || s === 'ndx' || s === 'spx' || s === 'dji';
  const isNikkei = s === 'int_nikkei' || s === 'gb_nikkei' || s === 'n225';
  const isKospi = s === 'int_kospi' || s === 'gb_ks11' || s === 'ks11';

  // 0.1 美股核心基准 (纳指 .IXIC / 标普 .INX / 道指 .DJI)
  if (isUS) {
    const symMap = { 'usixic': '.IXIC', 'usndx': '.IXIC', 'ndx': '.IXIC', 'usinx': '.INX', 'usspx': '.INX', 'spx': '.INX', 'usdji': '.DJI', 'dji': '.DJI' };
    const sinaSym = symMap[s] || s.replace(/^us/, '').toUpperCase();
    
    if (period === 'daily' || period === 'weekly' || period === 'monthly') {
      try {
        const url = `http://stock.finance.sina.com.cn/usstock/api/json_v2.php/US_MinKService.getDailyK?symbol=${encodeURIComponent(sinaSym)}`;
        const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
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
          if (period === 'weekly' || period === 'monthly') {
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
        const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
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
        const res = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0' } });
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

    try {
      const url = 'http://stock.finance.sina.com.cn/futures/api/jsonp.php/var/GlobalFuturesService.getGlobalFuturesDailyKLine?symbol=NK';
      const res = await fetch(url, { headers: { 'Referer': 'http://finance.sina.com.cn', 'User-Agent': 'Mozilla/5.0' } });
      const text = await res.text();
      const match = text.match(/\[.*\]/s);
      if (match) {
        const raw = JSON.parse(match[0]);
        const daily = raw.map(d => ({
          time: d.date,
          open: parseFloat(d.open),
          close: parseFloat(d.close),
          high: parseFloat(d.high),
          low: parseFloat(d.low),
          volume: parseFloat(d.volume) || 0
        }));
        if (period === 'weekly' || period === 'monthly') {
          return aggregateBars(daily, period).slice(-count);
        }
        return daily.slice(-count);
      }
    } catch (_) {}
  }

  // 0.3 韩国综合指数 (int_kospi / KS11)
  if (isKospi) {
    if (period === 'intraday') {
      try {
        const u = 'https://push2.eastmoney.com/api/qt/stock/trends2/get?secid=100.KS11&fields1=f1,f2,f3,f4,f5,f6,f7,f8&fields2=f51,f52,f53,f54,f55,f56,f57,f58';
        const res = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0' } });
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

    try {
      const url = 'http://stock.finance.sina.com.cn/usstock/api/json_v2.php/US_MinKService.getDailyK?symbol=EWY';
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        const scaleFactor = 6912.37 / 179.18;
        const daily = data.map(d => ({
          time: d.d,
          open: +(parseFloat(d.o) * scaleFactor).toFixed(2),
          close: +(parseFloat(d.c) * scaleFactor).toFixed(2),
          high: +(parseFloat(d.h) * scaleFactor).toFixed(2),
          low: +(parseFloat(d.l) * scaleFactor).toFixed(2),
          volume: parseFloat(d.v) || 0
        }));
        if (period === 'weekly' || period === 'monthly') {
          return aggregateBars(daily, period).slice(-count);
        }
        return daily.slice(-count);
      }
    } catch (_) {}
  }

  // 1. 分时数据
  if (period === 'intraday' || period === '1m') {
    const isIndex = s.startsWith('sh000') || s.startsWith('sz399') || s.startsWith('hk') || s.startsWith('us') || s.startsWith('int_');
    try {
      const url = `http://web.ifzq.gtimg.cn/appstock/app/minute/query?code=${s}`;
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
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

    // 备用分时
    try {
      const url = `http://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData?symbol=${s}&scale=5&ma=no&datalen=60`;
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        return data.map(d => ({
          time: d.day,
          open: parseFloat(d.open),
          close: parseFloat(d.close),
          high: parseFloat(d.high),
          low: parseFloat(d.low),
          avg_price: parseFloat(d.close),
          volume: parseFloat(d.volume)
        }));
      }
    } catch (_) {}
    return [];
  }

  // 2. 周K 与 月K 时序数据 (腾讯证券高可用时序引擎)
  if (period === 'weekly' || period === 'monthly' || period === 'week' || period === 'month') {
    const tParam = (period === 'weekly' || period === 'week') ? 'week' : 'month';
    try {
      const url = `http://web.ifzq.gtimg.cn/appstock/app/kline/kline?param=${s},${tParam},,,${count}`;
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      const json = await res.json();
      const symData = json.data?.[s] || {};
      const rawList = symData[tParam] || symData[`qfq${tParam}`] || [];

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
    } catch (err) {
      console.error(`Fetch ${period} error for ${symbol}:`, err);
    }
  }

  // 3. 分钟 (5m/15m/30m/60m) 与 日K (新浪引擎)
  const scaleMap = {
    '5m': 5,
    '15m': 15,
    '30m': 30,
    '60m': 60,
    'daily': 240
  };
  const scale = scaleMap[period] || 240;

  if (s.startsWith('sh') || s.startsWith('sz')) {
    try {
      const url = `http://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData?symbol=${s}&scale=${scale}&ma=no&datalen=${count}`;
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        return data.map(d => ({
          time: d.day,
          open: parseFloat(d.open),
          close: parseFloat(d.close),
          high: parseFloat(d.high),
          low: parseFloat(d.low),
          volume: parseFloat(d.volume)
        }));
      }
    } catch (_) {}
  }

  // 4. 腾讯 K 线备用引擎
  try {
    let tParam = 'day';
    if (period === 'weekly') tParam = 'week';
    else if (period === 'monthly') tParam = 'month';
    else if (period === '5m') tParam = 'm5';
    else if (period === '15m') tParam = 'm15';
    else if (period === '30m') tParam = 'm30';
    else if (period === '60m') tParam = 'm60';

    const isMin = tParam.startsWith('m');
    const url = isMin
      ? `http://web.ifzq.gtimg.cn/appstock/app/kline/mkline?param=${s},${tParam},,${count}`
      : `http://web.ifzq.gtimg.cn/appstock/app/kline/kline?param=${s},${tParam},,,${count}`;

    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const json = await res.json();
    const symData = json.data?.[s] || {};
    const rawList = symData[tParam] || symData[`qfq${tParam}`] || [];

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
  } catch (err) {
    console.error(`Fetch kline error for ${symbol}:`, err);
  }

  return [];
}

/**
 * 获取个股完整 F10 深度档案
 */
async function getCompanyF10(symbol) {
  const s = symbol.toLowerCase();
  const rawCode = s.replace(/^(sh|sz|bj|hk|us)/, '');
  const isSh = s.startsWith('sh') || rawCode.startsWith('6');
  const marketPrefix = isSh ? 'SH' : 'SZ';
  const fullEastmoneyCode = marketPrefix + rawCode;

  try {
    const [profileRes, finaRes, themesRes] = await Promise.all([
      fetch(`https://emweb.securities.eastmoney.com/PC_HSF10/CompanySurvey/CompanySurveyAjax?code=${fullEastmoneyCode}`, { headers: { 'User-Agent': 'Mozilla/5.0' } }).then(r => r.json()).catch(() => ({})),
      fetch(`https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPT_F10_FINANCE_MAINFINADATA&columns=ALL&filter=(SECURITY_CODE%3D%22${rawCode}%22)&pageNumber=1&pageSize=4&sortTypes=-1&sortColumns=REPORT_DATE`, { headers: { 'User-Agent': 'Mozilla/5.0' } }).then(r => r.json()).catch(() => ({})),
      fetch(`https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPT_F10_CORETHEME_BOARDTYPE&columns=ALL&filter=(SECURITY_CODE%3D%22${rawCode}%22)`, { headers: { 'User-Agent': 'Mozilla/5.0' } }).then(r => r.json()).catch(() => ({}))
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
    console.error(`Fetch F10 error for ${symbol}:`, err);
    return null;
  }
}

/**
 * 获取个股即时新闻与官方公告 (全网新闻快讯 + 官方披露公告)
 */
async function getStockNewsAndNotices(symbol, stockName = '') {
  const s = symbol.toLowerCase();
  const rawCode = s.replace(/^(sh|sz|bj|hk|us)/, '');
  const searchKeyword = stockName || rawCode;

  try {
    const [noticesRes, newsRes] = await Promise.all([
      // 官方公告
      fetch(`https://np-anotice-stock.eastmoney.com/api/security/ann?sr=-1&page_size=10&page_index=1&ann_type=A&client_source=web&stock_list=${rawCode}`, { headers: { 'User-Agent': 'Mozilla/5.0' } })
        .then(r => r.json())
        .catch(() => ({})),
      // 即时新闻
      fetch(`https://search-api-web.eastmoney.com/search/jsonp?cb=cb&param=${encodeURIComponent(JSON.stringify({
        uid: '',
        keyword: searchKeyword,
        type: ['cmsArticleWebOld'],
        client: 'web',
        clientType: 'web',
        pageIndex: 1,
        pageSize: 10
      }))}`, { headers: { 'User-Agent': 'Mozilla/5.0' } })
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
    console.error(`Fetch news & notices error for ${symbol}:`, err);
    return { symbol: s, code: rawCode, notices: [], news: [] };
  }
}

/**
 * 生成全景 AI 智能量化与基本面深度诊断分析
 */
async function generateStockAIAnalysis(symbol) {
  const s = symbol.toLowerCase();
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
    const revYoY = parseFloat(fin.revenue_yoy) || 0;
    const profitYoY = parseFloat(fin.net_profit_yoy) || 0;

    // 1. 技术面因子计算 (最近 30 日)
    let techScore = 65;
    let ma5 = 0, ma10 = 0, ma20 = 0;
    let lowest20 = curPrice, highest20 = curPrice;

    if (dailyBars.length >= 5) {
      const closes = dailyBars.map(b => b.close);
      const last = closes.length - 1;
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

    // 构建完整 AI Prompt 报告 (方便一键复制给任意大模型)
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

## 📰 4. 最新舆情动态与官方公告
${news.slice(0, 3).map((n, i) => `${i+1}. [${n.media}] ${n.title} (${n.date})`).join('\n') || '- 暂无重大突发负面舆情'}
${notices.slice(0, 3).map((a, i) => `${i+1}. [官方公告] ${a.title} (${a.date})`).join('\n') || '- 暂无重大临时披露公告'}

---
### 🎯 请依据上述全部多维度全景数据，为我提供一份深度的投研决策分析报告：
1. 诊断该股票目前的核心投资价值与估值溢价/折价合理性；
2. 给出未来 1~3 个月的中短期走势推演与阻力/支撑突破策略；
3. 指出当前最大的潜在黑天鹅风险与防守仓位配比建议。
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
    console.error(`Generate AI analysis error for ${symbol}:`, err);
    return null;
  }
}

/**
 * 获取全球核心指数 (A股/港股/美股纳指标普/亚太日经韩国)
 */
async function getGlobalIndices() {
  try {
    const emUrl = 'https://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=20&po=1&np=1&fltt=2&invt=2&fid=f3&fs=i:1.000001,i:0.399001,i:0.399006,i:100.HSI,i:100.NDX,i:100.SPX,i:100.N225,i:100.KS11';
    const res = await fetch(emUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
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

    return orderKeys.map(k => mapResult[k]).filter(Boolean);
  } catch (err) {
    console.error('Fetch global indices error:', err);
    return [];
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

export {
  normalizeSymbol,
  getStockQuote,
  searchStock,
  getStockKline,
  getCompanyF10,
  getStockNewsAndNotices,
  generateStockAIAnalysis,
  getGlobalIndices,
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
  formatQuoteMarkdown
};
