// OmniStock 纯 JS 独立前端核心引擎
// 1. 全景 AI 智能量化与基本面深度研报诊断 (一键喂给 AI)
// 2. 全局多级智能内存缓存 (F10 / 资讯 / K线 / AI 0ms 瞬间秒开)
// 3. 窗口级精准独立局部更新 (彻底告别全局刷新互相干扰，每个窗口独立沙箱)
// 4. 摸鱼浅色半透明磨砂悬浮球 + 原地无损弹性变形
// 5. 12 核心全息大字号盘口 + 分时黄色均价线 (VWAP)
let watchlist = [];
let indices = [];
let floatingWindows = [];
let topZIndex = 100;
let currentLayout = 'free';
let theme = localStorage.getItem('omnistock_theme') || 'dark';
let fontSize = localStorage.getItem('omnistock_font_size') || 'medium';
let isDrawerOpen = false;

// 全局配置与偏好持久化系统
let appSettings = {
  colorScheme: 'red-up',   // 'red-up' (红涨绿跌) or 'green-up' (绿涨红跌)
  refreshInterval: 3000,   // 轮询毫秒数
  defaultLayout: 'tile_auto',
  activeMarketTab: 'ALL',  // 'ALL' | 'A' | 'HK' | 'US' | 'INDEX'
  sortBy: 'default',       // 'default' | 'pct_desc' | 'pct_asc' | 'amount_desc'
  isSettingsOpen: false
};

function loadSettings() {
  try {
    const raw = localStorage.getItem('omnistock_settings');
    if (raw) {
      const parsed = JSON.parse(raw);
      appSettings = { ...appSettings, ...parsed, isSettingsOpen: false };
    }
  } catch (_) {}
}

function saveSettings() {
  try {
    localStorage.setItem('omnistock_settings', JSON.stringify({
      colorScheme: appSettings.colorScheme,
      refreshInterval: appSettings.refreshInterval,
      defaultLayout: appSettings.defaultLayout,
      activeMarketTab: appSettings.activeMarketTab,
      sortBy: appSettings.sortBy
    }));
  } catch (_) {}
}

loadSettings();

// 个人持仓、价格预警、交易笔记与分类标签数据管理
let userPortfolio = {};
let userAlerts = {};
let userNotes = {};
let userTags = {};
let alertedSessionKeys = new Set();
let activeDrawerTab = 'watchlist'; // 'watchlist' | 'sectors'
let activeSectorTab = 'industry';  // 'industry' | 'concept'
let expandedSectorCode = null;
let currentAiStrategy = 'general'; // 'general' | 'short_term' | 'value_invest' | 't_grid'

let activeModalState = {
  type: null, // 'portfolio' | 'alert' | 'tag'
  symbol: '',
  name: '',
  curPrice: 0
};

const STOCK_TAG_OPTIONS = [
  { id: 'core', label: '🔴 核心重仓', color: 'bg-red-500/15 text-red-400 border-red-500/30' },
  { id: 'break', label: '🟡 突破观察', color: 'bg-amber-500/15 text-amber-400 border-amber-500/30' },
  { id: 'momentum', label: '🟢 短线打板', color: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' },
  { id: 'dip', label: '🟣 逢低低吸', color: 'bg-purple-500/15 text-purple-400 border-purple-500/30' },
  { id: 'dca', label: '⚪ 长期定投', color: 'bg-slate-500/15 text-slate-300 border-slate-500/30' }
];

function loadLocalUserData() {
  try {
    userPortfolio = JSON.parse(localStorage.getItem('omnistock_portfolio') || '{}');
    userAlerts = JSON.parse(localStorage.getItem('omnistock_alerts') || '{}');
    userNotes = JSON.parse(localStorage.getItem('omnistock_notes') || '{}');
    userTags = JSON.parse(localStorage.getItem('omnistock_tags') || '{}');
  } catch (_) {}
}

function savePortfolio() {
  try { localStorage.setItem('omnistock_portfolio', JSON.stringify(userPortfolio)); } catch (_) {}
}

function saveAlerts() {
  try { localStorage.setItem('omnistock_alerts', JSON.stringify(userAlerts)); } catch (_) {}
}

function saveNotes() {
  try { localStorage.setItem('omnistock_notes', JSON.stringify(userNotes)); } catch (_) {}
}

function saveTags() {
  try { localStorage.setItem('omnistock_tags', JSON.stringify(userTags)); } catch (_) {}
}

loadLocalUserData();

// 统一涨跌配色计算工具
function getTrendColor(isUp) {
  if (appSettings.colorScheme === 'green-up') {
    return isUp ? '#10b981' : '#ef4444';
  }
  return isUp ? '#ef4444' : '#10b981';
}

function getTrendTextClass(isUp) {
  const isRedUp = appSettings.colorScheme !== 'green-up';
  return isUp ? (isRedUp ? 'text-red-500' : 'text-emerald-500') : (isRedUp ? 'text-emerald-500' : 'text-red-500');
}

function getTrendBadgeClass(isUp) {
  const isRedUp = appSettings.colorScheme !== 'green-up';
  return isUp 
    ? (isRedUp ? 'bg-red-500/10 text-red-500 border-red-500/20' : 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20')
    : (isRedUp ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20' : 'bg-red-500/10 text-red-500 border-red-500/20');
}

// 智能内存缓存系统 (F10: 10分钟, 新闻: 2分钟, K线: 15-60秒, AI分析: 5分钟, 板块: 15秒, 资金流: 30秒)
const memoryCache = {
  f10: new Map(),
  news: new Map(),
  kline: new Map(),
  ai: new Map(),
  sectors: new Map(),
  fundflow: new Map()
};

// 前端并发请求合并去重器 (防止同时多窗口重复请求相同数据)
const clientInFlight = new Map();

async function fetchCachedSectors() {
  const cached = memoryCache.sectors.get('all');
  if (cached && (Date.now() - cached.timestamp < 15 * 1000)) {
    return cached.data;
  }
  try {
    const res = await fetch('/dsh-plugin-stock-x/sectors').then(r => r.json());
    if (res.data) {
      memoryCache.sectors.set('all', { data: res.data, timestamp: Date.now() });
      return res.data;
    }
  } catch (_) {}
  return { industry: [], concept: [] };
}

async function fetchCachedSectorStocks(code) {
  const cached = memoryCache.sectors.get(`stocks_${code}`);
  if (cached && (Date.now() - cached.timestamp < 15 * 1000)) {
    return cached.data;
  }
  try {
    const res = await fetch(`/dsh-plugin-stock-x/sector-stocks?code=${code}`).then(r => r.json());
    if (res.data) {
      memoryCache.sectors.set(`stocks_${code}`, { data: res.data, timestamp: Date.now() });
      return res.data;
    }
  } catch (_) {}
  return [];
}

async function fetchCachedFundFlow(symbol) {
  const key = symbol.toLowerCase();
  const cached = memoryCache.fundflow.get(key);
  if (cached && (Date.now() - cached.timestamp < 30 * 1000)) {
    return cached.data;
  }
  try {
    const res = await fetch(`/dsh-plugin-stock-x/fund-flow/${symbol}`).then(r => r.json());
    if (res.data) {
      memoryCache.fundflow.set(key, { data: res.data, timestamp: Date.now() });
      return res.data;
    }
  } catch (_) {}
  return null;
}

async function fetchCachedF10(symbol) {
  const key = symbol.toLowerCase();
  const cached = memoryCache.f10.get(key);
  if (cached && (Date.now() - cached.timestamp < 10 * 60 * 1000)) {
    return cached.data;
  }
  if (clientInFlight.has(`f10_${key}`)) {
    return clientInFlight.get(`f10_${key}`);
  }
  const promise = (async () => {
    try {
      const res = await fetch(`/dsh-plugin-stock-x/f10/${symbol}`).then(r => r.json());
      if (res.data) {
        memoryCache.f10.set(key, { data: res.data, timestamp: Date.now() });
      }
      return res.data;
    } catch (_) {
      return null;
    }
  })();
  clientInFlight.set(`f10_${key}`, promise);
  try {
    return await promise;
  } finally {
    clientInFlight.delete(`f10_${key}`);
  }
}

async function fetchCachedNews(symbol, name) {
  const key = symbol.toLowerCase();
  const cached = memoryCache.news.get(key);
  if (cached && (Date.now() - cached.timestamp < 2 * 60 * 1000)) {
    return cached.data;
  }
  if (clientInFlight.has(`news_${key}`)) {
    return clientInFlight.get(`news_${key}`);
  }
  const promise = (async () => {
    try {
      const res = await fetch(`/dsh-plugin-stock-x/news/${symbol}?name=${encodeURIComponent(name)}`).then(r => r.json());
      if (res.data) {
        memoryCache.news.set(key, { data: res.data, timestamp: Date.now() });
      }
      return res.data;
    } catch (_) {
      return null;
    }
  })();
  clientInFlight.set(`news_${key}`, promise);
  try {
    return await promise;
  } finally {
    clientInFlight.delete(`news_${key}`);
  }
}

async function fetchCachedKline(symbol, period) {
  const key = `${symbol.toLowerCase()}_${period}`;
  const ttl = period === 'intraday' ? 10 * 1000 : 60 * 1000;
  const cached = memoryCache.kline.get(key);
  if (cached && (Date.now() - cached.timestamp < ttl)) {
    return cached.data;
  }
  if (clientInFlight.has(`kline_${key}`)) {
    return clientInFlight.get(`kline_${key}`);
  }
  const promise = (async () => {
    try {
      const res = await fetch(`/dsh-plugin-stock-x/kline/${symbol}?period=${period}&count=150`).then(r => r.json());
      const bars = res.data || [];
      if (bars.length > 0) {
        memoryCache.kline.set(key, { data: bars, timestamp: Date.now() });
      }
      return bars;
    } catch (err) {
      console.error('Fetch kline error:', err);
      return [];
    }
  })();
  clientInFlight.set(`kline_${key}`, promise);
  try {
    return await promise;
  } finally {
    clientInFlight.delete(`kline_${key}`);
  }
}

async function fetchCachedAIAnalysis(symbol) {
  const key = symbol.toLowerCase();
  const cached = memoryCache.ai.get(key);
  if (cached && (Date.now() - cached.timestamp < 5 * 60 * 1000)) {
    return cached.data;
  }
  if (clientInFlight.has(`ai_${key}`)) {
    return clientInFlight.get(`ai_${key}`);
  }
  const promise = (async () => {
    try {
      const res = await fetch(`/dsh-plugin-stock-x/ai-analysis/${symbol}`).then(r => r.json());
      if (res.data) {
        memoryCache.ai.set(key, { data: res.data, timestamp: Date.now() });
      }
      return res.data;
    } catch (_) {
      return null;
    }
  })();
  clientInFlight.set(`ai_${key}`, promise);
  try {
    return await promise;
  } finally {
    clientInFlight.delete(`ai_${key}`);
  }
}

// 悬浮部件坐标
let widgetPos = {
  x: Math.max(20, window.innerWidth - 90),
  y: Math.max(20, window.innerHeight - 100)
};
let savedBallPos = { ...widgetPos };

const appRoot = document.getElementById('app-root');

// 初始化
function resetPollingTimer() {
  if (window.__OMNISTOCK_TIMER__) {
    clearInterval(window.__OMNISTOCK_TIMER__);
    window.__OMNISTOCK_TIMER__ = null;
  }
  if (appSettings.refreshInterval > 0) {
    window.__OMNISTOCK_TIMER__ = setInterval(refreshQuotesOnly, appSettings.refreshInterval);
  }
}

async function initOmniStockApp() {
  applyThemeAndFont();
  renderInitialApp();
  resetPollingTimer();
  await refreshData();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initOmniStockApp);
} else {
  initOmniStockApp();
}

window.addEventListener('resize', () => {
  widgetPos.x = Math.max(15, Math.min(window.innerWidth - (isDrawerOpen ? 400 : 75), widgetPos.x));
  widgetPos.y = Math.max(15, Math.min(window.innerHeight - (isDrawerOpen ? 550 : 75), widgetPos.y));
  const widget = document.getElementById('omni-morph-widget');
  if (widget) {
    widget.style.left = `${widgetPos.x}px`;
    widget.style.top = `${widgetPos.y}px`;
  }
  floatingWindows.forEach(w => {
    if (w.chartInstance) w.chartInstance.resize();
  });
});

// 全局交易员快捷键监听 (Esc 快速收起/关闭模态框, Space 快速顺次切股)
window.addEventListener('keydown', (e) => {
  const activeEl = document.activeElement;
  const isInputActive = activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA');

  if (e.key === 'Escape') {
    if (appSettings.isSettingsOpen) {
      closeSettingsModal();
      return;
    }
    if (activeModalState.type === 'portfolio') {
      closePortfolioModal();
      return;
    }
    if (activeModalState.type === 'alert') {
      closeAlertModal();
      return;
    }
    const searchDropdown = document.getElementById('search-dropdown');
    if (searchDropdown && !searchDropdown.classList.contains('hidden')) {
      searchDropdown.classList.add('hidden');
      return;
    }
    if (isDrawerOpen && !isInputActive) {
      toggleMorphDrawer(false);
      return;
    }
  }

  if (e.key === ' ' && !isInputActive) {
    if (watchlist.length > 0 && floatingWindows.length > 0) {
      e.preventDefault();
      const topWin = floatingWindows.reduce((prev, cur) => (cur.zIndex > prev.zIndex ? cur : prev), floatingWindows[0]);
      if (topWin) {
        const curIdx = watchlist.findIndex(w => w.symbol.toLowerCase() === topWin.symbol.toLowerCase());
        const nextIdx = (curIdx + 1) % watchlist.length;
        const nextStock = watchlist[nextIdx];
        topWin.symbol = nextStock.symbol;
        topWin.name = nextStock.name;
        topWin.market = nextStock.market || 'A';
        const winEl = document.getElementById(topWin.id);
        if (winEl) {
          winEl.outerHTML = renderSingleWindowHtml(topWin);
          bindSingleWindowEvents(topWin);
          if (topWin.period !== 'f10' && topWin.period !== 'news' && topWin.period !== 'ai') {
            renderChart(topWin);
          }
        }
        showToast(`⚡ 快捷切股:【${nextStock.name}】(${nextIdx + 1}/${watchlist.length})`);
      }
    }
  }
});

function applyThemeAndFont() {
  const isDark = theme === 'dark';
  if (isDark) {
    document.documentElement.classList.add('dark');
    document.documentElement.classList.remove('light');
  } else {
    document.documentElement.classList.remove('dark');
    document.documentElement.classList.add('light');
  }
  document.documentElement.className = `${theme} font-${fontSize}`;

  const appRoot = document.getElementById('app-root');
  if (appRoot) {
    if (isDark) {
      appRoot.classList.add('dark');
      appRoot.classList.remove('light');
    } else {
      appRoot.classList.remove('dark');
      appRoot.classList.add('light');
    }
  }

  if (document.body) {
    document.body.style.backgroundColor = isDark ? '#090d16' : '#f8fafc';
    document.body.style.color = isDark ? '#f8fafc' : '#0f172a';
  }
}

function toggleTheme() {
  theme = theme === 'dark' ? 'light' : 'dark';
  localStorage.setItem('omnistock_theme', theme);
  applyThemeAndFont();
  renderInitialApp();
  // 重新渲染所有打开窗口的内容面板
  floatingWindows.forEach(w => {
    if (w.period === 'f10') {
      renderF10(w);
    } else if (w.period === 'news') {
      renderNews(w);
    } else if (w.period === 'ai') {
      renderAIAnalysis(w);
    } else {
      renderChart(w);
    }
  });
}

function updateSetting(key, val) {
  appSettings[key] = val;
  if (key === 'theme') {
    theme = val;
    localStorage.setItem('omnistock_theme', theme);
    applyThemeAndFont();
  }
  saveSettings();
  if (key === 'refreshInterval') {
    resetPollingTimer();
  }
  updateWatchlistDOM();
  updateRibbonDOM();
  updateOpenChartsQuotes();
  floatingWindows.forEach(w => {
    if (w.period === 'f10') {
      renderF10(w);
    } else if (w.period === 'news') {
      renderNews(w);
    } else if (w.period === 'ai') {
      renderAIAnalysis(w);
    } else {
      renderChart(w);
    }
  });
  renderInitialApp();
}

function openSettingsModal() {
  appSettings.isSettingsOpen = true;
  const modal = document.getElementById('omni-settings-modal');
  if (modal) modal.classList.remove('hidden');
  else renderInitialApp();
}

function closeSettingsModal() {
  appSettings.isSettingsOpen = false;
  const modal = document.getElementById('omni-settings-modal');
  if (modal) modal.classList.add('hidden');
}

function setMarketTab(tabId) {
  appSettings.activeMarketTab = tabId;
  saveSettings();
  renderInitialApp();
}

function toggleSortWatchlist() {
  const sortCycle = ['default', 'pct_desc', 'pct_asc', 'amount_desc'];
  const curIdx = sortCycle.indexOf(appSettings.sortBy);
  appSettings.sortBy = sortCycle[(curIdx + 1) % sortCycle.length];
  saveSettings();
  renderInitialApp();
}

async function fetchCachedQuote(symbol) {
  const key = symbol.toLowerCase();
  try {
    const res = await fetch(`/dsh-plugin-stock-x/quote/${symbol}`).then(r => r.json());
    if (res.data) {
      const q = res.data;
      const idx = watchlist.findIndex(w => w.symbol.toLowerCase() === key);
      if (idx !== -1) {
        watchlist[idx] = { ...watchlist[idx], ...q };
      } else {
        watchlist.push(q);
      }
      return q;
    }
  } catch (_) {}
  return null;
}

function renderDepthPanelHtml(win, quote = {}) {
  const isDark = theme === 'dark';
  const depth = quote.depth;
  const isIndex = win.market === 'INDEX' || win.symbol.toLowerCase().startsWith('sh000') || win.symbol.toLowerCase().startsWith('sz399') || win.symbol.toLowerCase().startsWith('int_');

  if (isIndex) {
    return `
      <div id="depth-panel-${win.id}" class="px-4 py-2.5 border-b text-center text-xs font-mono select-none ${
        isDark ? 'bg-slate-950/90 border-slate-800/80 text-slate-400' : 'bg-slate-100/80 border-slate-200 text-slate-500'
      }">
        <span>📊 大盘指数为宏观综合指标，无买卖五档挂单撮合</span>
      </div>
    `;
  }

  if (!depth || (!depth.buy?.length && !depth.sell?.length)) {
    return `
      <div id="depth-panel-${win.id}" class="px-4 py-2.5 border-b text-center text-xs font-mono select-none ${
        isDark ? 'bg-slate-950/90 border-slate-800/80 text-slate-400' : 'bg-slate-100/80 border-slate-200 text-slate-500'
      }">
        <span class="animate-pulse">⏳ 正在获取【${win.name}】实时五档买卖盘口...</span>
      </div>
    `;
  }

  const prevClose = quote.prev_close || quote.current_price || 0;

  return `
    <div id="depth-panel-${win.id}" class="px-4 py-2 border-b grid grid-cols-2 gap-4 text-xs font-mono select-none ${
      isDark ? 'bg-slate-950/90 border-slate-800/80' : 'bg-slate-100/80 border-slate-200'
    }">
      <!-- 卖盘 (卖五 -> 卖一) -->
      <div class="space-y-0.5">
        <div class="text-[10px] font-bold opacity-60 mb-1 flex justify-between px-1 border-b pb-0.5 ${isDark ? 'border-slate-800' : 'border-slate-300'}">
          <span>卖盘</span><span>挂单价</span><span>手数</span>
        </div>
        ${(depth.sell || []).map((s, idx) => {
          const isUp = s.price >= prevClose;
          const pColor = s.price > 0 ? getTrendTextClass(isUp) : 'opacity-40';
          return `
            <div class="flex items-center justify-between text-[11px] py-0.5 hover:bg-blue-500/10 rounded px-1">
              <span class="opacity-60 text-[10px]">卖${5 - idx}</span>
              <span class="font-bold ${pColor}">${s.price > 0 ? s.price.toFixed(2) : '--'}</span>
              <span class="opacity-80">${s.volume > 0 ? (s.volume >= 10000 ? (s.volume/10000).toFixed(1)+'万' : s.volume) : '--'}</span>
            </div>
          `;
        }).join('')}
      </div>

      <!-- 买盘 (买一 -> 买五) -->
      <div class="space-y-0.5">
        <div class="text-[10px] font-bold opacity-60 mb-1 flex justify-between px-1 border-b pb-0.5 ${isDark ? 'border-slate-800' : 'border-slate-300'}">
          <span>买盘</span><span>挂单价</span><span>手数</span>
        </div>
        ${(depth.buy || []).map((b, idx) => {
          const isUp = b.price >= prevClose;
          const pColor = b.price > 0 ? getTrendTextClass(isUp) : 'opacity-40';
          return `
            <div class="flex items-center justify-between text-[11px] py-0.5 hover:bg-blue-500/10 rounded px-1">
              <span class="opacity-60 text-[10px]">买${idx + 1}</span>
              <span class="font-bold ${pColor}">${b.price > 0 ? b.price.toFixed(2) : '--'}</span>
              <span class="opacity-80">${b.volume > 0 ? (b.volume >= 10000 ? (b.volume/10000).toFixed(1)+'万' : b.volume) : '--'}</span>
            </div>
          `;
        }).join('')}
      </div>
    </div>
  `;
}

async function toggleWindowDepth(winId) {
  const win = floatingWindows.find(w => w.id === winId);
  if (!win) return;
  win.showDepth = !win.showDepth;

  if (win.showDepth) {
    fetchCachedQuote(win.symbol).then(q => {
      if (q) {
        const depthPanel = document.getElementById(`depth-panel-${win.id}`);
        if (depthPanel) {
          depthPanel.outerHTML = renderDepthPanelHtml(win, q);
        }
      }
    });
  }

  const winEl = document.getElementById(win.id);
  if (winEl) {
    winEl.outerHTML = renderSingleWindowHtml(win);
    bindSingleWindowEvents(win);
    if (win.period !== 'f10' && win.period !== 'news' && win.period !== 'ai') {
      renderChart(win);
    }
  }
}

// 导出自选股
function exportWatchlist(type = 'json') {
  if (watchlist.length === 0) {
    showToast('⚠️ 当前自选列表为空');
    return;
  }
  let text = '';
  if (type === 'json') {
    text = JSON.stringify(watchlist.map(w => ({ symbol: w.symbol, name: w.name, market: w.market })), null, 2);
  } else {
    text = watchlist.map(w => w.symbol).join(', ');
  }
  navigator.clipboard.writeText(text).then(() => {
    showToast(`✅ 已复制 ${watchlist.length} 只自选股数据到剪贴板！`);
  }).catch(() => {
    showToast('⚠️ 复制失败，请手动复制');
  });
}

// 批量导入自选股
async function handleBatchImportWatchlist() {
  const inputEl = document.getElementById('import-watchlist-text');
  if (!inputEl) return;
  const raw = inputEl.value.trim();
  if (!raw) {
    showToast('⚠️ 请输入要导入的股票代码或名称');
    return;
  }

  let itemsToImport = [];
  if (raw.startsWith('[') && raw.endsWith(']')) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        itemsToImport = parsed.map(p => p.symbol || p.code || p.name).filter(Boolean);
      }
    } catch (_) {}
  }

  if (itemsToImport.length === 0) {
    itemsToImport = raw.split(/[\n,;，；\s]+/).map(s => s.trim()).filter(Boolean);
  }

  if (itemsToImport.length === 0) {
    showToast('⚠️ 未识别到有效股票');
    return;
  }

  showToast(`⏳ 正在批量检索并导入 ${itemsToImport.length} 只标的...`);
  let addedCount = 0;

  for (const item of itemsToImport) {
    try {
      const res = await fetch(`/dsh-plugin-stock-x/search?q=${encodeURIComponent(item)}`).then(r => r.json());
      const list = res.data || [];
      if (list.length > 0) {
        const found = list[0];
        await addToWatchlist(found.symbol, found.name, found.market);
        addedCount++;
      }
    } catch (_) {}
  }

  inputEl.value = '';
  closeSettingsModal();
  await refreshData();
  renderInitialApp();
  showToast(`🎉 成功导入 ${addedCount} 只自选股票！`);
}

async function refreshData() {
  try {
    const [wlRes, idxRes] = await Promise.all([
      fetch('/dsh-plugin-stock-x/watchlist').then(r => r.json()),
      fetch('/dsh-plugin-stock-x/indices').then(r => r.json())
    ]);
    if (wlRes.data) watchlist = wlRes.data;
    if (idxRes.data) indices = idxRes.data;
  } catch (err) {
    console.error('Refresh error:', err);
  }
}

function checkPriceAlerts() {
  watchlist.forEach(q => {
    const alert = userAlerts[q.symbol.toLowerCase()];
    if (!alert || !q.current_price) return;
    const sym = q.symbol.toLowerCase();

    if (alert.highPrice && q.current_price >= alert.highPrice) {
      const key = `${sym}_high_${alert.highPrice}`;
      if (!alertedSessionKeys.has(key)) {
        alertedSessionKeys.add(key);
        showToast(`🚨【${q.name}】突破预警！现价 ¥${q.current_price.toFixed(2)} 已达目标价 ¥${alert.highPrice}`);
      }
    }
    if (alert.lowPrice && q.current_price <= alert.lowPrice) {
      const key = `${sym}_low_${alert.lowPrice}`;
      if (!alertedSessionKeys.has(key)) {
        alertedSessionKeys.add(key);
        showToast(`🚨【${q.name}】止损预警！现价 ¥${q.current_price.toFixed(2)} 已跌破预警价 ¥${alert.lowPrice}`);
      }
    }
    if (alert.pctThreshold && Math.abs(q.change_pct || 0) >= alert.pctThreshold) {
      const key = `${sym}_pct_${alert.pctThreshold}`;
      if (!alertedSessionKeys.has(key)) {
        alertedSessionKeys.add(key);
        showToast(`⚡【${q.name}】日内大幅异动！涨跌幅已达 ${(q.change_pct >= 0 ? '+' : '') + q.change_pct.toFixed(2)}%`);
      }
    }
  });
}

function renderPortfolioSummaryCard() {
  const isDark = theme === 'dark';
  const symbols = Object.keys(userPortfolio);
  if (symbols.length === 0) return '';

  let totalMarketValue = 0;
  let totalCost = 0;
  let todayProfit = 0;

  symbols.forEach(sym => {
    const pos = userPortfolio[sym];
    const quote = watchlist.find(w => w.symbol.toLowerCase() === sym.toLowerCase()) || {};
    const price = quote.current_price || pos.costPrice;
    const prev = quote.prev_close || price;
    const curVal = price * pos.shares;
    const costVal = pos.costPrice * pos.shares;
    totalMarketValue += curVal;
    totalCost += costVal;
    todayProfit += (price - prev) * pos.shares;
  });

  const totalProfit = totalMarketValue - totalCost;
  const totalProfitRate = totalCost > 0 ? (totalProfit / totalCost) * 100 : 0;
  const isProfitable = totalProfit >= 0;
  const isTodayUp = todayProfit >= 0;

  return `
    <div class="px-3.5 py-2.5 mx-2.5 my-1.5 rounded-xl border flex flex-col gap-1.5 text-xs select-none shadow-sm ${
      isDark ? 'bg-slate-800/80 border-slate-700 text-slate-200' : 'bg-blue-50/70 border-blue-200/80 text-slate-800'
    }">
      <div class="flex items-center justify-between font-bold">
        <span class="flex items-center gap-1 text-blue-500 font-extrabold">💼 个人持仓总览</span>
        <span class="text-[11px] opacity-70">共 ${symbols.length} 只标的</span>
      </div>
      <div class="grid grid-cols-3 gap-2 font-mono pt-1 border-t ${isDark ? 'border-slate-700/60' : 'border-blue-200/60'}">
        <div>
          <span class="text-[10px] block opacity-60">持仓总市值</span>
          <span class="font-bold text-xs">¥${(totalMarketValue / 10000).toFixed(2)}万</span>
        </div>
        <div>
          <span class="text-[10px] block opacity-60">今日盈亏</span>
          <span class="font-bold text-xs ${getTrendTextClass(isTodayUp)}">${isTodayUp ? '+' : ''}¥${todayProfit.toFixed(0)}</span>
        </div>
        <div>
          <span class="text-[10px] block opacity-60">累计总浮盈</span>
          <span class="font-bold text-xs ${getTrendTextClass(isProfitable)}">${isProfitable ? '+' : ''}¥${totalProfit.toFixed(0)} (${totalProfitRate >= 0 ? '+' : ''}${totalProfitRate.toFixed(1)}%)</span>
        </div>
      </div>
    </div>
  `;
}

function openPortfolioModal(symbol, name, curPrice) {
  activeModalState = { type: 'portfolio', symbol: symbol.toLowerCase(), name, curPrice };
  const modal = document.getElementById('omni-portfolio-modal');
  if (modal) {
    const pos = userPortfolio[symbol.toLowerCase()] || {};
    document.getElementById('portfolio-modal-title').textContent = `💼 【${name} (${symbol})】持仓记账`;
    document.getElementById('portfolio-cost-input').value = pos.costPrice || curPrice || '';
    document.getElementById('portfolio-shares-input').value = pos.shares || '';
    modal.classList.remove('hidden');
  }
}

function closePortfolioModal() {
  activeModalState.type = null;
  const modal = document.getElementById('omni-portfolio-modal');
  if (modal) modal.classList.add('hidden');
}

function savePortfolioPosition() {
  const sym = activeModalState.symbol;
  if (!sym) return;
  const cost = parseFloat(document.getElementById('portfolio-cost-input').value);
  const shares = parseInt(document.getElementById('portfolio-shares-input').value);

  if (isNaN(cost) || isNaN(shares) || shares <= 0) {
    showToast('⚠️ 请输入合法的成本价与持有股数');
    return;
  }

  userPortfolio[sym] = { costPrice: cost, shares: shares };
  savePortfolio();
  closePortfolioModal();
  updateWatchlistDOM();
  showToast(`✅ 已更新【${activeModalState.name}】持仓信息！`);
}

function deletePortfolioPosition() {
  const sym = activeModalState.symbol;
  if (!sym) return;
  delete userPortfolio[sym];
  savePortfolio();
  closePortfolioModal();
  updateWatchlistDOM();
  showToast(`🗑️ 已清除【${activeModalState.name}】持仓记账！`);
}

function openAlertModal(symbol, name, curPrice) {
  activeModalState = { type: 'alert', symbol: symbol.toLowerCase(), name, curPrice };
  const modal = document.getElementById('omni-alert-modal');
  if (modal) {
    const alert = userAlerts[symbol.toLowerCase()] || {};
    document.getElementById('alert-modal-title').textContent = `🔔 【${name} (${symbol})】价格预警设置`;
    document.getElementById('alert-high-input').value = alert.highPrice || '';
    document.getElementById('alert-low-input').value = alert.lowPrice || '';
    document.getElementById('alert-pct-input').value = alert.pctThreshold || '';
    modal.classList.remove('hidden');
  }
}

function closeAlertModal() {
  activeModalState.type = null;
  const modal = document.getElementById('omni-alert-modal');
  if (modal) modal.classList.add('hidden');
}

function saveAlertRule() {
  const sym = activeModalState.symbol;
  if (!sym) return;
  const high = parseFloat(document.getElementById('alert-high-input').value) || null;
  const low = parseFloat(document.getElementById('alert-low-input').value) || null;
  const pct = parseFloat(document.getElementById('alert-pct-input').value) || null;

  if (!high && !low && !pct) {
    delete userAlerts[sym];
    saveAlerts();
    closeAlertModal();
    updateWatchlistDOM();
    showToast(`🗑️ 已取消【${activeModalState.name}】预警`);
    return;
  }

  userAlerts[sym] = { highPrice: high, lowPrice: low, pctThreshold: pct };
  saveAlerts();
  closeAlertModal();
  updateWatchlistDOM();
  showToast(`✅ 已设置【${activeModalState.name}】价格异动预警！`);
}

function deleteAlertRule() {
  const sym = activeModalState.symbol;
  if (!sym) return;
  delete userAlerts[sym];
  saveAlerts();
  closeAlertModal();
  updateWatchlistDOM();
  showToast(`🗑️ 已清除【${activeModalState.name}】预警规则！`);
}

function openTagModal(symbol, name) {
  const sym = symbol.toLowerCase();
  activeModalState = { type: 'tag', symbol: sym, name };
  const modal = document.getElementById('omni-tag-modal');
  if (modal) {
    const titleEl = document.getElementById('tag-modal-title');
    if (titleEl) titleEl.textContent = `🏷️ 为【${name} (${symbol})】设置分类标签`;
    const curTag = userTags[sym] || '';
    const container = document.getElementById('tag-options-container');
    if (container) {
      const isDark = theme === 'dark';
      container.innerHTML = `
        <div class="space-y-2">
          <div onclick="setStockTag('${symbol}', '')" class="p-2.5 rounded-xl border cursor-pointer flex items-center justify-between transition-all ${
            !curTag ? 'border-blue-500 bg-blue-500/10 font-bold' : (isDark ? 'border-slate-800 hover:bg-slate-800' : 'border-slate-200 hover:bg-slate-50')
          }">
            <span class="opacity-75">🚫 无标签 (清除)</span>
            ${!curTag ? '<span class="text-blue-400 font-bold">✓</span>' : ''}
          </div>
          ${STOCK_TAG_OPTIONS.map(opt => `
            <div onclick="setStockTag('${symbol}', '${opt.id}')" class="p-2.5 rounded-xl border cursor-pointer flex items-center justify-between transition-all ${
              curTag === opt.id ? 'border-blue-500 bg-blue-500/10 font-bold' : (isDark ? 'border-slate-800 hover:bg-slate-800' : 'border-slate-200 hover:bg-slate-50')
            }">
              <span class="px-2.5 py-0.5 rounded-md border text-xs font-semibold ${opt.color}">${opt.label}</span>
              ${curTag === opt.id ? '<span class="text-blue-400 font-bold">✓</span>' : ''}
            </div>
          `).join('')}
        </div>
      `;
    }
    modal.classList.remove('hidden');
  }
}

function closeTagModal() {
  activeModalState.type = null;
  const modal = document.getElementById('omni-tag-modal');
  if (modal) modal.classList.add('hidden');
}

function setStockTag(symbol, tagId) {
  const sym = symbol.toLowerCase();
  if (!tagId) {
    delete userTags[sym];
  } else {
    userTags[sym] = tagId;
  }
  saveTags();
  closeTagModal();
  updateWatchlistDOM();
  floatingWindows.forEach(w => {
    if (w.symbol.toLowerCase() === sym && w.period === 'notes') {
      renderNotes(w);
    }
  });
  showToast(`🏷️ 已更新【${symbol}】分类标签！`);
}

function setDrawerTab(tab) {
  activeDrawerTab = tab;
  renderInitialApp();
  if (tab === 'sectors') {
    updateSectorsDOM();
  }
}

function setSectorTab(tab) {
  activeSectorTab = tab;
  updateSectorsDOM();
}

async function toggleExpandSector(code) {
  expandedSectorCode = expandedSectorCode === code ? null : code;
  updateSectorsDOM();
}

async function updateSectorsDOM() {
  const container = document.getElementById('sectors-items-container');
  if (!container) return;
  const isDark = theme === 'dark';
  container.innerHTML = `<div class="p-8 text-center text-xs ${isDark ? 'text-slate-400' : 'text-slate-500'}">⏳ 正在获取全市场热门板块榜单...</div>`;

  try {
    const data = await fetchCachedSectors();
    const list = activeSectorTab === 'industry' ? (data.industry || []) : (data.concept || []);

    if (list.length === 0) {
      container.innerHTML = `<div class="p-8 text-center text-xs ${isDark ? 'text-slate-400' : 'text-slate-500'}">暂无板块数据</div>`;
      return;
    }

    container.innerHTML = `
      <!-- 板块分类切换 -->
      <div class="p-2 border-b flex items-center justify-center gap-2 ${isDark ? 'bg-slate-900 border-slate-800' : 'bg-slate-50 border-slate-200'}">
        <button onclick="setSectorTab('industry')" class="px-4 py-1 rounded-lg text-xs font-semibold transition-all ${
          activeSectorTab === 'industry' ? 'bg-blue-600 text-white shadow-sm' : (isDark ? 'text-slate-400 hover:bg-slate-800' : 'text-slate-600 hover:bg-slate-200')
        }">
          🏭 领涨行业板块
        </button>
        <button onclick="setSectorTab('concept')" class="px-4 py-1 rounded-lg text-xs font-semibold transition-all ${
          activeSectorTab === 'concept' ? 'bg-purple-600 text-white shadow-sm' : (isDark ? 'text-slate-400 hover:bg-slate-800' : 'text-slate-600 hover:bg-slate-200')
        }">
          💡 热门概念题材
        </button>
      </div>

      <div class="divide-y max-h-[360px] overflow-y-auto ${isDark ? 'divide-slate-800' : 'divide-slate-100'}">
        ${list.map((sec, idx) => {
          const isUp = sec.change_pct >= 0;
          const isExp = expandedSectorCode === sec.code;
          return `
            <div class="p-3 transition-colors ${isDark ? 'hover:bg-slate-800/60' : 'hover:bg-slate-50'}">
              <div class="flex items-center justify-between cursor-pointer select-none" onclick="toggleExpandSector('${sec.code}')">
                <div class="flex items-center gap-2 min-w-0">
                  <span class="w-5 h-5 rounded-md flex items-center justify-center text-[10px] font-bold ${
                    idx < 3 ? 'bg-amber-500 text-white shadow-sm' : (isDark ? 'bg-slate-800 text-slate-400' : 'bg-slate-200 text-slate-600')
                  }">${idx + 1}</span>
                  <span class="font-bold text-sm truncate">${sec.name}</span>
                </div>
                <div class="flex items-center gap-3">
                  <div class="text-right">
                    <span class="font-mono font-bold text-sm ${getTrendTextClass(isUp)}">${isUp ? '+' : ''}${sec.change_pct.toFixed(2)}%</span>
                    <div class="text-[10px] opacity-60">龙头: ${sec.lead_stock_name} (${(sec.lead_stock_pct >= 0 ? '+' : '') + sec.lead_stock_pct.toFixed(1)}%)</div>
                  </div>
                  <span class="text-xs opacity-50 transform transition-transform ${isExp ? 'rotate-180' : ''}">▼</span>
                </div>
              </div>

              ${isExp ? `
                <div id="sector-stocks-${sec.code}" class="mt-2.5 p-2 rounded-xl border ${isDark ? 'bg-slate-950/70 border-slate-800' : 'bg-slate-100/70 border-slate-200'}">
                  <div class="text-[11px] opacity-60 font-bold mb-1.5 flex justify-between px-1">
                    <span>板块领涨成分股</span>
                    <span>现价 / 涨幅</span>
                  </div>
                  <div id="sector-stocks-list-${sec.code}">
                    <div class="py-2 text-center text-xs opacity-60 animate-pulse">正在加载成分龙头股...</div>
                  </div>
                </div>
              ` : ''}
            </div>
          `;
        }).join('')}
      </div>
    `;

    if (expandedSectorCode) {
      fetchCachedSectorStocks(expandedSectorCode).then(stocks => {
        const el = document.getElementById(`sector-stocks-list-${expandedSectorCode}`);
        if (!el) return;
        if (stocks.length === 0) {
          el.innerHTML = `<div class="py-2 text-center text-xs opacity-60">暂无成分股</div>`;
          return;
        }
        el.innerHTML = stocks.map(stk => `
          <div class="flex items-center justify-between py-1 px-1.5 hover:bg-blue-500/10 rounded text-xs transition-colors">
            <div class="flex items-center gap-1.5 min-w-0">
              <span class="font-bold truncate">${stk.name}</span>
              <span class="text-[10px] font-mono opacity-50">(${stk.symbol})</span>
            </div>
            <div class="flex items-center gap-2">
              <span class="font-mono font-bold ${getTrendTextClass(stk.change_pct >= 0)}">¥${stk.price.toFixed(2)} (${stk.change_pct >= 0 ? '+' : ''}${stk.change_pct.toFixed(2)}%)</span>
              <button onclick="openChart('${stk.symbol}', '${stk.name}', 'A')" class="p-1 rounded bg-blue-600/20 text-blue-400 hover:bg-blue-600 hover:text-white text-[10px]">📊看图</button>
              <button onclick="addToWatchlist('${stk.symbol}', '${stk.name}', 'A')" class="p-1 rounded bg-emerald-600/20 text-emerald-400 hover:bg-emerald-600 hover:text-white text-[10px]">+自选</button>
            </div>
          </div>
        `).join('');
      });
    }
  } catch (err) {
    container.innerHTML = `<div class="p-8 text-center text-xs text-red-400">获取板块榜单失败: ${err.message}</div>`;
  }
}

let isRefreshing = false;
async function refreshQuotesOnly() {
  if (isRefreshing) return;
  isRefreshing = true;
  try {
    await refreshData();
    checkPriceAlerts();
    updateWatchlistDOM();
    updateRibbonDOM();
    updateOpenChartsQuotes();
  } finally {
    isRefreshing = false;
  }
}

function getFilteredAndSortedWatchlist() {
  let list = [...watchlist];
  
  // 1. 市场分类过滤
  if (appSettings.activeMarketTab === 'A') {
    list = list.filter(item => item.market === 'A');
  } else if (appSettings.activeMarketTab === 'HK') {
    list = list.filter(item => item.market === 'HK');
  } else if (appSettings.activeMarketTab === 'US') {
    list = list.filter(item => item.market === 'US');
  } else if (appSettings.activeMarketTab === 'INDEX') {
    list = list.filter(item => item.market === 'INDEX' || item.market === 'GLOBAL' || (item.symbol && (item.symbol.toLowerCase().startsWith('sh000') || item.symbol.toLowerCase().startsWith('sz399') || item.symbol.toLowerCase().startsWith('int_'))));
  }

  // 2. 多维排序
  if (appSettings.sortBy === 'pct_desc') {
    list.sort((a, b) => (b.change_pct || 0) - (a.change_pct || 0));
  } else if (appSettings.sortBy === 'pct_asc') {
    list.sort((a, b) => (a.change_pct || 0) - (b.change_pct || 0));
  } else if (appSettings.sortBy === 'amount_desc') {
    list.sort((a, b) => (b.turnover || 0) - (a.turnover || 0));
  }

  return list;
}

function updateWatchlistDOM() {
  const container = document.getElementById('watchlist-items-container');
  if (!container) return;
  const isDark = theme === 'dark';

  // 确保容器自身的外观与主题严格同步
  container.className = `flex-1 overflow-y-auto divide-y max-h-[300px] ${
    isDark ? 'bg-slate-900 divide-slate-800 text-slate-100' : 'bg-white divide-slate-100 text-slate-800'
  }`;

  const summaryEl = document.getElementById('portfolio-summary-slot');
  if (summaryEl) {
    summaryEl.innerHTML = renderPortfolioSummaryCard();
  }

  const displayList = getFilteredAndSortedWatchlist();

  if (displayList.length === 0) {
    container.innerHTML = `<div class="p-8 text-center text-sm ${isDark ? 'bg-slate-900 text-slate-400' : 'bg-white text-slate-500'}">暂无匹配自选股票</div>`;
    return;
  }

  container.innerHTML = displayList.map(item => {
    const isUp = (item.change || 0) >= 0;
    const color = getTrendTextClass(isUp);
    const sign = isUp ? '+' : '';
    const pos = userPortfolio[item.symbol.toLowerCase()];
    const alert = userAlerts[item.symbol.toLowerCase()];
    const tagId = userTags[item.symbol.toLowerCase()];
    const tagObj = STOCK_TAG_OPTIONS.find(t => t.id === tagId);

    let posHtml = '';
    if (pos) {
      const curPrice = item.current_price || pos.costPrice;
      const profit = (curPrice - pos.costPrice) * pos.shares;
      const pRate = pos.costPrice > 0 ? (profit / (pos.costPrice * pos.shares)) * 100 : 0;
      const isPosUp = profit >= 0;
      posHtml = `
        <div class="text-[10px] font-mono font-semibold mt-0.5 ${getTrendTextClass(isPosUp)}">
          持 ${pos.shares}股 · 浮盈: ${profit >= 0 ? '+' : ''}¥${profit.toFixed(0)} (${pRate >= 0 ? '+' : ''}${pRate.toFixed(1)}%)
        </div>
      `;
    }

    return `
      <div class="px-3.5 py-2.5 flex items-center justify-between gap-2 transition-colors group ${
        isDark ? 'bg-slate-900 hover:bg-slate-800 text-slate-100' : 'bg-white hover:bg-slate-50 text-slate-800'
      }">
        <div class="flex items-center gap-2 min-w-0 flex-1 cursor-pointer" onclick="openChart('${item.symbol}', '${item.name}', '${item.market}')">
          <span class="text-[10px] font-bold px-1.5 py-0.5 rounded border flex-shrink-0 ${
            item.market === 'A' ? 'bg-blue-500/10 text-blue-500 border-blue-500/20' :
            item.market === 'HK' ? 'bg-purple-500/10 text-purple-500 border-purple-500/20' :
            'bg-amber-500/10 text-amber-500 border-amber-500/20'
          }">${item.market || 'A'}</span>
          <div class="truncate">
            <div class="flex items-center gap-1.5 truncate">
              <span class="font-bold text-sm group-hover:text-blue-500 transition-colors truncate ${isDark ? 'text-slate-100' : 'text-slate-900'}">${item.name}</span>
              ${tagObj ? `<span onclick="event.stopPropagation(); openTagModal('${item.symbol}', '${item.name}')" class="text-[9px] px-1.5 py-0.2 rounded border font-semibold cursor-pointer ${tagObj.color}">${tagObj.label}</span>` : ''}
              ${alert ? `<span class="text-[10px] text-amber-400" title="已设置预警">🔔</span>` : ''}
            </div>
            <div class="text-xs font-mono opacity-60 ${isDark ? 'text-slate-400' : 'text-slate-500'}">${item.symbol}</div>
            ${posHtml}
          </div>
        </div>

        <div class="text-right cursor-pointer" onclick="openChart('${item.symbol}', '${item.name}', '${item.market}')">
          <div class="font-mono font-bold text-sm ${color}">
            ${item.current_price > 0 ? item.current_price.toFixed(2) : '--'}
          </div>
          <div class="text-xs font-mono font-semibold ${color}">
            ${sign}${item.change_pct ? item.change_pct.toFixed(2) : '0.00'}%
          </div>
        </div>

        <div class="flex items-center gap-1 ml-1 flex-shrink-0">
          <button onclick="openTagModal('${item.symbol}', '${item.name}')"
            class="p-1.5 rounded-lg ${tagObj ? 'bg-purple-600/20 text-purple-400 font-bold' : (isDark ? 'hover:bg-slate-800 text-slate-400' : 'hover:bg-slate-100 text-slate-500')} transition-all"
            title="分类标签">
            🏷️
          </button>
          <button onclick="openPortfolioModal('${item.symbol}', '${item.name}', ${item.current_price || 0})"
            class="p-1.5 rounded-lg ${pos ? 'bg-blue-600/20 text-blue-400 font-bold' : (isDark ? 'hover:bg-slate-800 text-slate-400' : 'hover:bg-slate-100 text-slate-500')} transition-all"
            title="持仓记账与收益追踪">
            💼
          </button>
          <button onclick="openAlertModal('${item.symbol}', '${item.name}', ${item.current_price || 0})"
            class="p-1.5 rounded-lg ${alert ? 'bg-amber-500/20 text-amber-400 font-bold' : (isDark ? 'hover:bg-slate-800 text-slate-400' : 'hover:bg-slate-100 text-slate-500')} transition-all"
            title="设置价格突破与异动预警">
            🔔
          </button>
          <button onclick="sendStockToDSHChat('${item.symbol}', '${item.name}', false)"
            class="p-1.5 rounded-lg bg-indigo-600/15 hover:bg-indigo-600 text-indigo-400 hover:text-white transition-all shadow-sm flex items-center justify-center text-xs"
            title="一键发送该股票投研数据到 DSH 聊天框">
            💬
          </button>
          <button onclick="openChart('${item.symbol}', '${item.name}', '${item.market}')"
            class="p-1.5 rounded-lg bg-blue-600/15 hover:bg-blue-600 text-blue-400 hover:text-white transition-all shadow-sm flex items-center justify-center"
            title="打开走势与深度详情">
            <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline>
            </svg>
          </button>
          <button onclick="removeFromWatchlist('${item.symbol}')"
            class="p-1 rounded-lg text-sm transition-colors ${isDark ? 'hover:bg-red-600/20 text-slate-400 hover:text-red-400' : 'hover:bg-red-50 text-slate-400 hover:text-red-500'}"
            title="移出自选">
            ✕
          </button>
        </div>
      </div>
    `;
  }).join('');
}

function updateRibbonDOM() {
  const ribbon = document.getElementById('mini-indices-ribbon');
  if (!ribbon) return;
  const isDark = theme === 'dark';
  const displayIndices = indices.slice(0, 8);
  ribbon.innerHTML = displayIndices.map(idx => {
    const isUp = (idx.change || 0) >= 0;
    const color = getTrendTextClass(isUp);
    const sign = isUp ? '+' : '';
    const shortName = idx.short_name || idx.name.replace('指数', '').replace('成指', '').slice(0, 3);

    return `
      <div onclick="openChart('${idx.symbol}', '${idx.name}', '${idx.market}')"
        class="px-1.5 py-1 rounded-lg flex flex-col items-center justify-center cursor-pointer transition-all hover:scale-105 border ${
          isDark ? 'bg-slate-900 hover:bg-slate-800 border-slate-800 text-slate-100' : 'bg-white hover:bg-slate-100 border-slate-200 shadow-sm text-slate-800'
        }" title="${idx.name} - 点击看图">
        <div class="flex items-center justify-between w-full text-[10px] leading-tight">
          <span class="truncate font-semibold opacity-80">${shortName}</span>
          <span class="font-mono font-bold text-[9px] ${color}">${sign}${idx.change_pct ? idx.change_pct.toFixed(2) : '0.00'}%</span>
        </div>
        <div class="font-mono font-black text-[11px] ${color} mt-0.5 tracking-tighter w-full text-center truncate">
          ${idx.current_price ? (idx.current_price >= 10000 ? idx.current_price.toFixed(0) : idx.current_price.toFixed(1)) : '--'}
        </div>
      </div>
    `;
  }).join('');
}

function updateOpenChartsQuotes() {
  floatingWindows.forEach(win => {
    const quote = watchlist.find(w => w.symbol.toLowerCase() === win.symbol.toLowerCase());
    if (!quote) return;
    const winEl = document.getElementById(win.id);
    if (!winEl) return;
    const isUp = (quote.change || 0) >= 0;
    const color = getTrendTextClass(isUp);
    const sign = isUp ? '+' : '';

    const priceEl = winEl.querySelector('.quote-price');
    if (priceEl) {
      priceEl.textContent = quote.current_price ? quote.current_price.toFixed(2) : '--';
      priceEl.className = `quote-price font-bold text-base ${color}`;
    }
    const pctEl = winEl.querySelector('.quote-pct');
    if (pctEl) {
      pctEl.textContent = `${sign}${quote.change_pct ? quote.change_pct.toFixed(2) : '0.00'}%`;
      pctEl.className = `quote-pct font-bold text-base ${color}`;
    }

    if (win.showDepth) {
      const depthPanel = document.getElementById(`depth-panel-${win.id}`);
      if (depthPanel && quote.depth) {
        depthPanel.outerHTML = renderDepthPanelHtml(win, quote);
      }
    }
  });
}

// 页面基础框架渲染
function renderInitialApp() {
  const isDark = theme === 'dark';
  let html = '';

  const w = isDrawerOpen ? 400 : 56;
  const h = isDrawerOpen ? 560 : 56;
  const r = isDrawerOpen ? 22 : 28;

  // 1. 原地变形悬浮主体 (实底不透明，跟随主题)
  html += `
    <div id="omni-morph-widget"
      style="position: fixed; left: ${widgetPos.x}px; top: ${widgetPos.y}px; width: ${w}px; height: ${h}px; border-radius: ${r}px; z-index: 99990;"
      class="select-none overflow-hidden ${
        isDrawerOpen
          ? (isDark ? 'bg-slate-900 border border-slate-700 shadow-2xl shadow-black/80 text-slate-100' : 'bg-white border border-slate-300 shadow-2xl shadow-slate-400/40 text-slate-800')
          : 'cursor-pointer'
      }">
      
      <!-- 状态 A: 摸鱼浅色半透明磨砂悬浮球 -->
      <div id="morph-ball-view"
        style="opacity: ${isDrawerOpen ? 0 : 1}; transform: scale(${isDrawerOpen ? 0.5 : 1}); pointer-events: ${isDrawerOpen ? 'none' : 'auto'};"
        class="morph-view absolute inset-0 w-full h-full rounded-full slacker-glass-ball flex flex-col items-center justify-center group"
        title="点击查看自选行情">
        
        <span class="text-xs font-black tracking-wider ${isDark ? 'text-slate-200' : 'text-slate-700'} drop-shadow-sm uppercase group-hover:scale-105 transition-transform">
          stock
        </span>
        <span class="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-emerald-400/80"></span>
      </div>

      <!-- 状态 B: 自选盯盘/板块热点面板 (不透明纯色实底) -->
      <div id="morph-panel-view"
        style="opacity: ${isDrawerOpen ? 1 : 0}; transform: scale(${isDrawerOpen ? 1 : 0.94}); pointer-events: ${isDrawerOpen ? 'auto' : 'none'};"
        class="morph-view absolute inset-0 w-full h-full flex flex-col ${isDark ? 'bg-slate-900 text-slate-100' : 'bg-white text-slate-800'}">
        
        <!-- 面板头部 -->
        <div id="panel-drag-header" class="px-4 py-3 border-b flex items-center justify-between cursor-move select-none ${
          isDark ? 'bg-slate-800 border-slate-700 text-slate-100' : 'bg-slate-100 border-slate-200 text-slate-800'
        }">
          <div class="flex items-center gap-1.5 p-0.5 rounded-xl border ${isDark ? 'bg-slate-950/60 border-slate-700/60' : 'bg-slate-200/70 border-slate-300'}">
            <button onclick="setDrawerTab('watchlist')" class="px-2.5 py-1 rounded-lg text-xs font-bold transition-all ${
              activeDrawerTab === 'watchlist' ? 'bg-blue-600 text-white shadow-sm' : (isDark ? 'text-slate-400 hover:text-white' : 'text-slate-600 hover:text-slate-900')
            }">
              📈 自选 (${watchlist.length})
            </button>
            <button onclick="setDrawerTab('sectors')" class="px-2.5 py-1 rounded-lg text-xs font-bold transition-all ${
              activeDrawerTab === 'sectors' ? 'bg-purple-600 text-white shadow-sm' : (isDark ? 'text-slate-400 hover:text-white' : 'text-slate-600 hover:text-slate-900')
            }">
              🔥 领涨热点
            </button>
          </div>

          <div class="flex items-center gap-1.5 text-sm">
            <button onclick="openSettingsModal()" class="p-1 rounded-lg hover:bg-slate-700 text-slate-400 hover:text-white" title="全局设置中心">
              ⚙️
            </button>
            <button onclick="toggleTheme()" class="p-1 rounded-lg hover:bg-slate-700 text-slate-400 hover:text-white" title="切换暗色/亮色">
              ${isDark ? '☀️' : '🌙'}
            </button>
            <button onclick="toggleMorphDrawer(false)" class="p-1 rounded-lg hover:bg-red-600/20 text-slate-400 hover:text-red-500 text-base font-bold transition-transform hover:scale-110" title="缩回为悬浮球">
              ✕
            </button>
          </div>
        </div>

        <!-- 全球核心指数卡片栏 -->
        <div id="mini-indices-ribbon" class="px-2.5 py-1.5 border-b grid grid-cols-4 gap-1.5 text-xs ${
          isDark ? 'bg-slate-900 border-slate-800' : 'bg-slate-50 border-slate-200'
        }"></div>

        <!-- 搜索栏 -->
        <div class="p-2.5 border-b relative ${isDark ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'}">
          <input
            id="search-input"
            type="text"
            placeholder="搜索代码、拼音 (如 gzmt, 600519, 00700, NVDA)..."
            class="w-full border rounded-xl px-3.5 py-2 text-xs placeholder-slate-400 focus:outline-none focus:border-blue-500 transition-all ${
              isDark ? 'bg-slate-800 border-slate-700 text-slate-100' : 'bg-slate-50 border-slate-300 text-slate-900'
            }"
          />
          <div id="search-dropdown" class="hidden absolute left-2.5 right-2.5 top-full mt-1 border rounded-xl shadow-2xl z-50 max-h-60 overflow-y-auto divide-y ${
            isDark ? 'bg-slate-900 border-slate-700 divide-slate-800' : 'bg-white border-slate-200 divide-slate-100'
          }"></div>
        </div>

        ${activeDrawerTab === 'watchlist' ? `
          <!-- 市场分类药丸与排序栏 -->
          <div class="px-3 py-1.5 border-b flex items-center justify-between gap-1 text-[11px] ${
            isDark ? 'bg-slate-900 border-slate-800' : 'bg-slate-50 border-slate-200'
          }">
            <div class="flex items-center gap-1">
              ${[
                { id: 'ALL', label: '全部' },
                { id: 'A', label: 'A股' },
                { id: 'HK', label: '港股' },
                { id: 'US', label: '美股' },
                { id: 'INDEX', label: '指数' }
              ].map(tab => `
                <button onclick="setMarketTab('${tab.id}')"
                  class="px-2 py-0.5 rounded-md font-semibold transition-all ${
                    appSettings.activeMarketTab === tab.id
                      ? 'bg-blue-600 text-white shadow-sm'
                      : (isDark ? 'text-slate-400 hover:text-slate-200 hover:bg-slate-800' : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200')
                  }">
                  ${tab.label}
                </button>
              `).join('')}
            </div>

            <div class="flex items-center gap-1">
              <button onclick="toggleSortWatchlist()"
                class="px-2 py-0.5 rounded-md font-semibold flex items-center gap-1 border transition-all ${
                  appSettings.sortBy !== 'default'
                    ? 'bg-indigo-600/15 text-indigo-400 border-indigo-500/30 font-bold'
                    : (isDark ? 'bg-slate-800/80 text-slate-400 border-slate-700 hover:text-slate-200' : 'bg-white text-slate-600 border-slate-300 hover:text-slate-900')
                }">
                <span>${
                  appSettings.sortBy === 'pct_desc' ? '涨幅 ⬇' :
                  appSettings.sortBy === 'pct_asc' ? '跌幅 ⬆' :
                  appSettings.sortBy === 'amount_desc' ? '成交额 💰' : '默认排序'
                }</span>
              </button>
            </div>
          </div>

          <!-- 个人持仓总览卡片插槽 -->
          <div id="portfolio-summary-slot"></div>

          <!-- 自选股票列表 (实色底色，不透明) -->
          <div id="watchlist-items-container" class="flex-1 overflow-y-auto divide-y max-h-[300px] ${
            isDark ? 'bg-slate-900 divide-slate-800' : 'bg-white divide-slate-100'
          }"></div>
        ` : `
          <!-- 全市场领涨行业与热门概念板块专属容器 -->
          <div id="sectors-items-container" class="flex-1 overflow-y-auto ${
            isDark ? 'bg-slate-900' : 'bg-white'
          }"></div>
        `}

        <!-- 底部窗口管理集成区 -->
        <div id="watchlist-footer-manager" class="p-2.5 border-t flex flex-col gap-2 text-xs ${
          isDark ? 'bg-slate-900 border-slate-800 text-slate-300' : 'bg-slate-50 border-slate-200 text-slate-700'
        }">
          ${renderFooterManagerHtml()}
        </div>
      </div>
    </div>
  `;

  // 2. 全局设置中心模态框
  html += `
    <div id="omni-settings-modal" class="${appSettings.isSettingsOpen ? '' : 'hidden'} fixed inset-0 z-[999999] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div class="w-full max-w-lg rounded-2xl border shadow-2xl overflow-hidden flex flex-col max-h-[85vh] ${
        isDark ? 'bg-slate-900 border-slate-700 text-slate-100' : 'bg-white border-slate-300 text-slate-800'
      }">
        <div class="px-5 py-3.5 border-b flex items-center justify-between ${isDark ? 'bg-slate-800/80 border-slate-700' : 'bg-slate-100 border-slate-200'}">
          <div class="flex items-center gap-2 font-bold text-base">
            <span>⚙️ 全局偏好与设置中心</span>
          </div>
          <button onclick="closeSettingsModal()" class="p-1 rounded-lg hover:bg-red-500/20 text-slate-400 hover:text-red-500 font-bold">✕</button>
        </div>

        <div class="p-5 overflow-y-auto space-y-5 text-xs">
          <!-- 1. 主题外观风格 -->
          <div class="space-y-2">
            <label class="font-bold text-sm text-blue-500 block">🌓 视觉主题风格</label>
            <div class="grid grid-cols-2 gap-3">
              <div onclick="updateSetting('theme', 'dark')" class="p-3 rounded-xl border cursor-pointer flex items-center justify-between transition-all ${
                theme === 'dark' ? 'border-blue-500 bg-blue-500/10 font-bold ring-1 ring-blue-500' : (isDark ? 'border-slate-800 bg-slate-950/40 hover:border-slate-700' : 'border-slate-200 bg-slate-50')
              }">
                <div class="flex items-center gap-2.5">
                  <span class="text-base">🌙</span>
                  <div>
                    <div class="font-bold">极客深色暗黑</div>
                    <div class="text-[10px] opacity-60">夜间专注护眼，高对比专业质感</div>
                  </div>
                </div>
                <span class="w-2.5 h-2.5 rounded-full ${theme === 'dark' ? 'bg-blue-500 ring-2 ring-blue-400/40' : 'bg-slate-700'}"></span>
              </div>

              <div onclick="updateSetting('theme', 'light')" class="p-3 rounded-xl border cursor-pointer flex items-center justify-between transition-all ${
                theme === 'light' ? 'border-blue-500 bg-blue-500/10 font-bold ring-1 ring-blue-500' : (isDark ? 'border-slate-800 bg-slate-950/40 hover:border-slate-700' : 'border-slate-200 bg-slate-50')
              }">
                <div class="flex items-center gap-2.5">
                  <span class="text-base">☀️</span>
                  <div>
                    <div class="font-bold">清爽高雅亮白</div>
                    <div class="text-[10px] opacity-60">明亮通透清晰，白天办公首选</div>
                  </div>
                </div>
                <span class="w-2.5 h-2.5 rounded-full ${theme === 'light' ? 'bg-blue-500 ring-2 ring-blue-400/40' : 'bg-slate-300'}"></span>
              </div>
            </div>
          </div>

          <!-- 2. 涨跌配色习惯 -->
          <div class="space-y-2">
            <label class="font-bold text-sm text-blue-500 block">🎨 涨跌配色习惯</label>
            <div class="grid grid-cols-2 gap-3">
              <div onclick="updateSetting('colorScheme', 'red-up')" class="p-3 rounded-xl border cursor-pointer flex items-center justify-between transition-all ${
                appSettings.colorScheme === 'red-up' ? 'border-blue-500 bg-blue-500/10 font-bold ring-1 ring-blue-500' : (isDark ? 'border-slate-800 bg-slate-950/40 hover:border-slate-700' : 'border-slate-200 bg-slate-50')
              }">
                <div>
                  <div class="font-bold">🇨🇳 红涨绿跌</div>
                  <div class="text-[10px] opacity-60">中国 A 股 / 港股标准习惯</div>
                </div>
                <div class="flex items-center gap-1 font-mono font-bold">
                  <span class="text-red-500">+2.5%</span>
                  <span class="text-emerald-500">-1.8%</span>
                </div>
              </div>

              <div onclick="updateSetting('colorScheme', 'green-up')" class="p-3 rounded-xl border cursor-pointer flex items-center justify-between transition-all ${
                appSettings.colorScheme === 'green-up' ? 'border-emerald-500 bg-emerald-500/10 font-bold ring-1 ring-emerald-500' : (isDark ? 'border-slate-800 bg-slate-950/40 hover:border-slate-700' : 'border-slate-200 bg-slate-50')
              }">
                <div>
                  <div class="font-bold">🌐 绿涨红跌</div>
                  <div class="text-[10px] opacity-60">美股 / 加密货币国际标准</div>
                </div>
                <div class="flex items-center gap-1 font-mono font-bold">
                  <span class="text-emerald-500">+2.5%</span>
                  <span class="text-red-500">-1.8%</span>
                </div>
              </div>
            </div>
          </div>

          <!-- 3. 行情轮询频率 -->
          <div class="space-y-2">
            <label class="font-bold text-sm text-blue-500 block">⏱️ 行情自动刷新频率</label>
            <div class="grid grid-cols-4 gap-2 font-mono">
              ${[
                { ms: 2000, label: '2秒 (极速)' },
                { ms: 3000, label: '3秒 (标准)' },
                { ms: 5000, label: '5秒 (省流)' },
                { ms: 10000, label: '10秒' }
              ].map(opt => `
                <button onclick="updateSetting('refreshInterval', ${opt.ms})" class="py-2 rounded-xl border text-center font-semibold transition-all ${
                  appSettings.refreshInterval === opt.ms
                    ? 'bg-blue-600 text-white border-blue-500 shadow-sm'
                    : (isDark ? 'bg-slate-950/40 border-slate-800 text-slate-300 hover:border-slate-700' : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100')
                }">${opt.label}</button>
              `).join('')}
            </div>
          </div>

          <!-- 4. 自选股批量导入与备份 -->
          <div class="space-y-2">
            <label class="font-bold text-sm text-purple-400 block">📦 自选股备份与批量导入</label>
            <div class="p-3.5 rounded-xl border space-y-3 ${isDark ? 'bg-slate-950/60 border-slate-800' : 'bg-slate-50 border-slate-200'}">
              <div>
                <span class="block font-semibold mb-1">批量导入股票代码或名称:</span>
                <textarea id="import-watchlist-text" placeholder="支持输入任意逗号或换行分隔的代码或名称，例如：&#10;600519, 00700, NVDA, 宁德时代, 比亚迪" class="w-full h-16 p-2 rounded-lg border font-mono text-xs focus:outline-none focus:border-blue-500 ${isDark ? 'bg-slate-900 border-slate-700 text-slate-200' : 'bg-white border-slate-300 text-slate-800'}"></textarea>
                <div class="flex justify-between items-center mt-2">
                  <span class="text-[11px] opacity-60">自动智能识别并全市场检索</span>
                  <button onclick="handleBatchImportWatchlist()" class="px-3 py-1 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs shadow-sm">
                    📥 一键批量导入
                  </button>
                </div>
              </div>

              <div class="border-t pt-2.5 flex items-center justify-between ${isDark ? 'border-slate-800' : 'border-slate-200'}">
                <span class="text-[11px] opacity-70">导出当前 ${watchlist.length} 只自选:</span>
                <div class="flex items-center gap-2">
                  <button onclick="exportWatchlist('json')" class="px-2.5 py-1 rounded-lg border text-xs font-semibold ${isDark ? 'bg-slate-800 border-slate-700 hover:text-white' : 'bg-white border-slate-300 hover:bg-slate-100'}">
                    📋 复制 JSON
                  </button>
                  <button onclick="exportWatchlist('text')" class="px-2.5 py-1 rounded-lg border text-xs font-semibold ${isDark ? 'bg-slate-800 border-slate-700 hover:text-white' : 'bg-white border-slate-300 hover:bg-slate-100'}">
                    📄 复制纯代码
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="px-5 py-3 border-t flex justify-end ${isDark ? 'bg-slate-800/80 border-slate-700' : 'bg-slate-100 border-slate-200'}">
          <button onclick="closeSettingsModal()" class="px-5 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs shadow-md">
            完成
          </button>
        </div>
      </div>
    </div>

    <!-- 3. 持仓记账模态框 -->
    <div id="omni-portfolio-modal" class="hidden fixed inset-0 z-[999999] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div class="w-full max-w-sm rounded-2xl border shadow-2xl overflow-hidden flex flex-col ${
        isDark ? 'bg-slate-900 border-slate-700 text-slate-100' : 'bg-white border-slate-300 text-slate-800'
      }">
        <div class="px-5 py-3.5 border-b flex items-center justify-between ${isDark ? 'bg-slate-800/80 border-slate-700' : 'bg-slate-100 border-slate-200'}">
          <div id="portfolio-modal-title" class="font-bold text-sm text-blue-500">💼 持仓记账</div>
          <button onclick="closePortfolioModal()" class="p-1 rounded-lg hover:bg-red-500/20 text-slate-400 hover:text-red-500 font-bold">✕</button>
        </div>
        <div class="p-5 space-y-4 text-xs">
          <div>
            <label class="block font-semibold mb-1 opacity-80">买入成本均价 (¥ / 股):</label>
            <input id="portfolio-cost-input" type="number" step="0.01" placeholder="如 1350.00" class="w-full px-3 py-2 border rounded-xl font-mono focus:outline-none focus:border-blue-500 ${isDark ? 'bg-slate-800 border-slate-700' : 'bg-slate-50 border-slate-300'}" />
          </div>
          <div>
            <label class="block font-semibold mb-1 opacity-80">持股数量 (股):</label>
            <input id="portfolio-shares-input" type="number" step="100" placeholder="如 1000" class="w-full px-3 py-2 border rounded-xl font-mono focus:outline-none focus:border-blue-500 ${isDark ? 'bg-slate-800 border-slate-700' : 'bg-slate-50 border-slate-300'}" />
          </div>
          <div class="flex items-center justify-between gap-3 pt-2">
            <button onclick="deletePortfolioPosition()" class="px-3 py-2 rounded-xl text-red-400 hover:bg-red-500/15 font-semibold transition-all">清除持仓</button>
            <div class="flex items-center gap-2">
              <button onclick="closePortfolioModal()" class="px-3.5 py-2 rounded-xl border ${isDark ? 'border-slate-700 hover:bg-slate-800' : 'border-slate-300 hover:bg-slate-100'}">取消</button>
              <button onclick="savePortfolioPosition()" class="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold shadow-md shadow-blue-500/25">保存记录</button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 4. 价格异动预警模态框 -->
    <div id="omni-alert-modal" class="hidden fixed inset-0 z-[999999] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div class="w-full max-w-sm rounded-2xl border shadow-2xl overflow-hidden flex flex-col ${
        isDark ? 'bg-slate-900 border-slate-700 text-slate-100' : 'bg-white border-slate-300 text-slate-800'
      }">
        <div class="px-5 py-3.5 border-b flex items-center justify-between ${isDark ? 'bg-slate-800/80 border-slate-700' : 'bg-slate-100 border-slate-200'}">
          <div id="alert-modal-title" class="font-bold text-sm text-amber-400">🔔 价格异动预警设置</div>
          <button onclick="closeAlertModal()" class="p-1 rounded-lg hover:bg-red-500/20 text-slate-400 hover:text-red-500 font-bold">✕</button>
        </div>
        <div class="p-5 space-y-4 text-xs">
          <div>
            <label class="block font-semibold mb-1 opacity-80">突破上限目标价 (¥，向上触发):</label>
            <input id="alert-high-input" type="number" step="0.01" placeholder="如 1500.00" class="w-full px-3 py-2 border rounded-xl font-mono focus:outline-none focus:border-amber-500 ${isDark ? 'bg-slate-800 border-slate-700' : 'bg-slate-50 border-slate-300'}" />
          </div>
          <div>
            <label class="block font-semibold mb-1 opacity-80">跌破止损警戒价 (¥，向下触发):</label>
            <input id="alert-low-input" type="number" step="0.01" placeholder="如 1280.00" class="w-full px-3 py-2 border rounded-xl font-mono focus:outline-none focus:border-amber-500 ${isDark ? 'bg-slate-800 border-slate-700' : 'bg-slate-50 border-slate-300'}" />
          </div>
          <div>
            <label class="block font-semibold mb-1 opacity-80">单日异动涨跌幅阈值 (%，如 ±5%):</label>
            <input id="alert-pct-input" type="number" step="0.5" placeholder="如 5.0" class="w-full px-3 py-2 border rounded-xl font-mono focus:outline-none focus:border-amber-500 ${isDark ? 'bg-slate-800 border-slate-700' : 'bg-slate-50 border-slate-300'}" />
          </div>
          <div class="flex items-center justify-between gap-3 pt-2">
            <button onclick="deleteAlertRule()" class="px-3 py-2 rounded-xl text-red-400 hover:bg-red-500/15 font-semibold transition-all">清除预警</button>
            <div class="flex items-center gap-2">
              <button onclick="closeAlertModal()" class="px-3.5 py-2 rounded-xl border ${isDark ? 'border-slate-700 hover:bg-slate-800' : 'border-slate-300 hover:bg-slate-100'}">取消</button>
              <button onclick="saveAlertRule()" class="px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-bold shadow-md shadow-amber-500/25">保存预警</button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 5. 股票分类标签设置模态框 -->
    <div id="omni-tag-modal" class="hidden fixed inset-0 z-[999999] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div class="w-full max-w-xs rounded-2xl border shadow-2xl overflow-hidden flex flex-col ${
        isDark ? 'bg-slate-900 border-slate-700 text-slate-100' : 'bg-white border-slate-300 text-slate-800'
      }">
        <div class="px-4 py-3 border-b flex items-center justify-between ${isDark ? 'bg-slate-800/80 border-slate-700' : 'bg-slate-100 border-slate-200'}">
          <div id="tag-modal-title" class="font-bold text-xs text-blue-400">🏷️ 设置分类标签</div>
          <button onclick="closeTagModal()" class="p-1 rounded-lg hover:bg-red-500/20 text-slate-400 hover:text-red-500 font-bold">✕</button>
        </div>
        <div id="tag-options-container" class="p-4 text-xs"></div>
      </div>
    </div>
  `;

  // 3. 走势图窗口容器
  html += `<div id="floating-windows-container">`;
  floatingWindows.forEach(win => {
    html += renderSingleWindowHtml(win);
  });
  html += `</div>`;

  let root = document.getElementById('app-root');
  if (!root) {
    root = document.createElement('div');
    root.id = 'app-root';
    document.body.appendChild(root);
  }
  root.innerHTML = html;

  if (activeDrawerTab === 'sectors') {
    updateSectorsDOM();
  } else {
    updateWatchlistDOM();
  }
  updateRibbonDOM();
  bindDrawerEvents();

  floatingWindows.forEach(win => {
    bindSingleWindowEvents(win);
  });
}

function renderFooterManagerHtml() {
  const isDark = theme === 'dark';
  if (floatingWindows.length > 0) {
    return `
      <div class="flex items-center justify-between">
        <span class="text-xs font-semibold text-blue-400">
          已开 <b class="${isDark ? 'text-white' : 'text-slate-900'}">${floatingWindows.length}</b> 个看图窗口:
        </span>
        <div class="flex items-center gap-1.5">
          <button onclick="minimizeAllWindows()" class="px-2 py-0.5 rounded text-xs transition-colors ${isDark ? 'text-slate-400 hover:text-white bg-slate-800/60' : 'text-slate-600 hover:text-slate-900 bg-slate-200/80'}">收起</button>
          <button onclick="restoreAllWindows()" class="px-2 py-0.5 rounded text-xs transition-colors ${isDark ? 'text-slate-400 hover:text-white bg-slate-800/60' : 'text-slate-600 hover:text-slate-900 bg-slate-200/80'}">展开</button>
          <button onclick="closeAllWindows()" class="px-2 py-0.5 rounded text-xs transition-colors ${isDark ? 'text-red-400 hover:text-red-300 bg-red-950/50' : 'text-red-600 hover:text-red-700 bg-red-100'}">关闭</button>
        </div>
      </div>
      <div class="flex items-center gap-1.5 pt-0.5">
        <button onclick="applyWindowLayout('tile_auto')" class="flex-1 py-1 rounded-lg text-xs font-semibold transition-all ${
          currentLayout === 'tile_auto' ? 'bg-blue-600 text-white' : (isDark ? 'bg-slate-800 text-slate-300 hover:bg-slate-700' : 'bg-white border border-slate-300 text-slate-700 hover:bg-slate-100')
        }">🔲 平铺</button>
        <button onclick="applyWindowLayout('split_2')" class="flex-1 py-1 rounded-lg text-xs font-semibold transition-all ${
          currentLayout === 'split_2' ? 'bg-blue-600 text-white' : (isDark ? 'bg-slate-800 text-slate-300 hover:bg-slate-700' : 'bg-white border border-slate-300 text-slate-700 hover:bg-slate-100')
        }">⬛ 双屏</button>
        <button onclick="applyWindowLayout('grid_4')" class="flex-1 py-1 rounded-lg text-xs font-semibold transition-all ${
          currentLayout === 'grid_4' ? 'bg-blue-600 text-white' : (isDark ? 'bg-slate-800 text-slate-300 hover:bg-slate-700' : 'bg-white border border-slate-300 text-slate-700 hover:bg-slate-100')
        }">田 四分屏</button>
        <button onclick="applyWindowLayout('cascade')" class="flex-1 py-1 rounded-lg text-xs font-semibold transition-all ${
          currentLayout === 'cascade' ? 'bg-blue-600 text-white' : (isDark ? 'bg-slate-800 text-slate-300 hover:bg-slate-700' : 'bg-white border border-slate-300 text-slate-700 hover:bg-slate-100')
        }">📑 层叠</button>
      </div>
    `;
  }
  return `
    <div class="flex items-center justify-between opacity-80 text-xs">
      <span>💡 点击个股「📊」打开专业走势</span>
      <button onclick="openBatchTiled()" class="px-2.5 py-1 rounded bg-blue-600/20 text-blue-400 hover:bg-blue-600 hover:text-white font-medium transition-all">
        🔲 一键平铺前4只
      </button>
    </div>
  `;
}

function updateFooterManager() {
  const el = document.getElementById('watchlist-footer-manager');
  if (el) el.innerHTML = renderFooterManagerHtml();
}

// 渲染单个窗口 HTML (含 AI 分析顶栏按钮、五档深度与专属面板)
function renderSingleWindowHtml(win) {
  const isDark = theme === 'dark';
  const quote = watchlist.find(w => w.symbol.toLowerCase() === win.symbol.toLowerCase()) || {};
  const isUp = (quote.change || 0) >= 0;
  const color = getTrendTextClass(isUp);
  const sign = isUp ? '+' : '';

  if (win.isMinimized) {
    return `
      <div id="${win.id}" style="position:fixed; left:${win.x}px; top:${win.y}px; z-index:${win.zIndex};"
        class="border rounded-2xl shadow-xl flex items-center gap-3 px-4 py-2.5 select-none backdrop-blur-xl cursor-move ${
          isDark ? 'bg-slate-900/95 border-slate-700 text-slate-100' : 'bg-white/95 border-slate-300 text-slate-800'
        }">
        <span class="text-blue-500 font-bold text-sm">📊 ${win.name}</span>
        <span class="font-mono text-sm font-bold ${color}">
          ${quote.current_price ? quote.current_price.toFixed(2) : '--'} (${sign}${quote.change_pct ? quote.change_pct.toFixed(2) : '0.00'}%)
        </span>
        <button onclick="toggleMinimizeWindow('${win.id}')" class="p-1.5 rounded bg-blue-600/20 text-blue-400 hover:bg-blue-600 hover:text-white">⌃</button>
        <button onclick="closeWindow('${win.id}')" class="p-1.5 rounded hover:bg-red-600/20 text-slate-400 hover:text-red-500">✕</button>
      </div>
    `;
  }

  return `
    <div id="${win.id}" style="position:fixed; left:${win.x}px; top:${win.y}px; width:${win.width}px; height:${win.height}px; z-index:${win.zIndex};"
      class="border rounded-2xl shadow-2xl flex flex-col overflow-hidden backdrop-blur-2xl select-none ${
        isDark ? 'bg-slate-900/95 border-slate-700/80 shadow-black/80' : 'bg-white/98 border-slate-300 shadow-slate-300/80'
      }">
      
      <!-- 8 个方位调整大小手柄 -->
      <div class="resize-handle handle-nw absolute left-0 top-0 w-4 h-4 cursor-nwse-resize z-30" data-dir="nw"></div>
      <div class="resize-handle handle-ne absolute right-0 top-0 w-4 h-4 cursor-nesw-resize z-30" data-dir="ne"></div>
      <div class="resize-handle handle-sw absolute left-0 bottom-0 w-4 h-4 cursor-nesw-resize z-30" data-dir="sw"></div>
      <div class="resize-handle handle-se absolute right-0 bottom-0 w-4 h-4 cursor-nwse-resize z-30 flex items-center justify-center opacity-70 hover:opacity-100" data-dir="se">
        <div class="w-3.5 h-3.5 border-r-2 border-b-2 ${isDark ? 'border-slate-400' : 'border-slate-500'}"></div>
      </div>
      <div class="resize-handle handle-n absolute left-4 right-4 top-0 h-2.5 cursor-ns-resize z-20" data-dir="n"></div>
      <div class="resize-handle handle-s absolute left-4 right-4 bottom-0 h-2.5 cursor-ns-resize z-20" data-dir="s"></div>
      <div class="resize-handle handle-w absolute top-4 bottom-4 left-0 w-2.5 cursor-ew-resize z-20" data-dir="w"></div>
      <div class="resize-handle handle-e absolute top-4 bottom-4 right-0 w-2.5 cursor-ew-resize z-20" data-dir="e"></div>

      <!-- 头部栏 (带一键 AI 分析快捷按钮) -->
      <div class="window-header px-4 py-3 border-b flex items-center justify-between cursor-move select-none ${
        isDark ? 'bg-slate-800/90 border-slate-700/80' : 'bg-slate-100/90 border-slate-200'
      }">
        <div class="flex items-center gap-2.5">
          <span class="font-extrabold text-base ${isDark ? 'text-white' : 'text-slate-900'}">${win.name}</span>
          <span class="text-sm font-mono opacity-70 font-semibold">(${win.symbol})</span>
          <span class="text-xs font-bold px-2 py-0.5 rounded border ${
            win.market === 'A' ? 'bg-blue-500/10 text-blue-500 border-blue-500/20' : 'bg-purple-500/10 text-purple-500 border-purple-500/20'
          }">${win.market}</span>
        </div>

        <div class="flex items-center gap-2">
          <button onclick="openAlertModal('${win.symbol}', '${win.name}', ${quote.current_price || 0})" class="px-2 py-1 rounded-lg ${userAlerts[win.symbol.toLowerCase()] ? 'bg-amber-500/20 text-amber-400 font-bold border border-amber-500/30' : (isDark ? 'hover:bg-slate-700 text-slate-400 hover:text-white' : 'hover:bg-slate-200 text-slate-500')} text-xs flex items-center gap-1 transition-all" title="设置价格突破/跌破/异动预警">
            <span>🔔 预警</span>
          </button>
          <button onclick="sendStockToDSHChat('${win.symbol}', '${win.name}', false)" class="px-2.5 py-1 rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-bold text-xs shadow-md shadow-blue-500/20 flex items-center gap-1 transition-all hover:scale-105" title="一键将该股票全景数据与投研提问填入 DSH 聊天框">
            <span>💬 发送到聊天</span>
          </button>
          <button onclick="setWindowPeriod('${win.id}', 'ai')" class="px-2.5 py-1 rounded-lg bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-bold text-xs shadow-md shadow-indigo-500/20 flex items-center gap-1 transition-all hover:scale-105" title="一键生成 AI 智能研报诊断与提示词">
            <span>✨ 🤖 AI分析</span>
          </button>
          <button onclick="toggleMinimizeWindow('${win.id}')" class="p-1.5 rounded-lg hover:bg-slate-700 text-slate-400 hover:text-white" title="最小化">➖</button>
          <button onclick="toggleMaximizeWindow('${win.id}')" class="p-1.5 rounded-lg hover:bg-slate-700 text-slate-400 hover:text-white" title="最大化">🔲</button>
          <button onclick="closeWindow('${win.id}')" class="p-1.5 rounded-lg hover:bg-red-600/20 text-slate-400 hover:text-red-500 text-sm" title="关闭">✕</button>
        </div>
      </div>

      <!-- 12 大核心盘口深度数据 -->
      <div class="px-4 py-2.5 border-b grid grid-cols-4 gap-x-3 gap-y-2 font-mono ${
        isDark ? 'bg-slate-950/70 border-slate-800/80 text-slate-300' : 'bg-slate-50 border-slate-200 text-slate-700'
      }">
        <div><span class="text-xs block opacity-60 mb-0.5">最新现价</span><span class="quote-price font-bold text-base ${color}">${quote.current_price?.toFixed(2) || '--'}</span></div>
        <div><span class="text-xs block opacity-60 mb-0.5">今日涨跌</span><span class="quote-pct font-bold text-base ${color}">${sign}${quote.change_pct ? quote.change_pct.toFixed(2) : '0.00'}%</span></div>
        <div><span class="text-xs block opacity-60 mb-0.5">今开 / 昨收</span><span class="text-sm font-semibold">${quote.open?.toFixed(2) || '--'} / ${quote.prev_close?.toFixed(2) || '--'}</span></div>
        <div><span class="text-xs block opacity-60 mb-0.5">最高 / 最低</span><span class="text-sm font-semibold ${getTrendTextClass(true)}">${quote.high?.toFixed(2) || '--'}</span> / <span class="text-sm font-semibold ${getTrendTextClass(false)}">${quote.low?.toFixed(2) || '--'}</span></div>
        
        <div><span class="text-xs block opacity-60 mb-0.5">换手率</span><span class="text-sm font-bold text-amber-500">${quote.turnover_rate ? quote.turnover_rate.toFixed(2) + '%' : '--'}</span></div>
        <div><span class="text-xs block opacity-60 mb-0.5">日内振幅</span><span class="text-sm font-semibold">${quote.amplitude ? quote.amplitude.toFixed(2) + '%' : '--'}</span></div>
        <div><span class="text-xs block opacity-60 mb-0.5">成交量</span><span class="text-sm font-semibold">${quote.volume ? (quote.volume>=10000 ? (quote.volume/10000).toFixed(1)+'万' : quote.volume) : '--'}</span></div>
        <div><span class="text-xs block opacity-60 mb-0.5">成交额</span><span class="text-sm font-semibold">${quote.turnover ? '¥'+(quote.turnover/100000000).toFixed(2)+'亿' : '--'}</span></div>

        <div><span class="text-xs block opacity-60 mb-0.5">市盈率(PE) / PB</span><span class="text-sm font-semibold">${quote.pe_ratio?.toFixed(1) || '--'} / ${quote.pb_ratio?.toFixed(1) || '--'}</span></div>
        <div><span class="text-xs block opacity-60 mb-0.5">流通 / 总市值</span><span class="text-sm font-semibold">${quote.float_market_cap ? quote.float_market_cap.toFixed(0)+'亿' : '--'} / ${quote.market_cap ? quote.market_cap.toFixed(0)+'亿' : '--'}</span></div>
        <div><span class="text-xs block opacity-60 mb-0.5">涨停 / 跌停价</span><span class="text-sm font-semibold ${getTrendTextClass(true)}">${quote.limit_up?.toFixed(2) || '--'}</span> / <span class="text-sm font-semibold ${getTrendTextClass(false)}">${quote.limit_down?.toFixed(2) || '--'}</span></div>
        <div><span class="text-xs block opacity-60 mb-0.5">股息率</span><span class="text-sm font-semibold text-blue-400">${quote.dividend_yield ? quote.dividend_yield.toFixed(2)+'%' : '--'}</span></div>
      </div>

      <!-- 五档买卖挂单深度盘口 (可一键展开/收起) -->
      ${win.showDepth ? renderDepthPanelHtml(win, quote) : ''}

      <!-- 周期与看板控制栏 (含 AI 分析与五档盘口选项卡) -->
      <div id="controls-bar-${win.id}" class="px-4 py-2.5 border-b flex flex-wrap items-center justify-between gap-2.5 text-xs ${
        isDark ? 'bg-slate-900/90 border-slate-800' : 'bg-white border-slate-200'
      }">
        ${renderWindowControlsHtml(win)}
      </div>

      <!-- 图表 / F10 / 资讯 / AI分析 / 资金流向 / 交易笔记 专属容器 -->
      <div id="chart-container-${win.id}" class="flex-1 p-2.5 relative overflow-y-auto flex flex-col ${isDark ? 'bg-slate-950/40' : 'bg-slate-50/50'}">
        <!-- 实时 HUD 数据状态栏 (随十字光标高频跳动) -->
        <div id="hud-bar-${win.id}" class="px-3 py-1 mb-1.5 rounded-lg border text-[11px] font-mono flex items-center justify-between gap-2 overflow-x-auto select-none transition-all ${
          isDark ? 'bg-slate-900/90 border-slate-800 text-slate-300' : 'bg-white border-slate-200 text-slate-700 shadow-sm'
        } ${win.period === 'f10' || win.period === 'news' || win.period === 'ai' || win.period === 'fundflow' || win.period === 'notes' ? 'hidden' : ''}">
          <span class="opacity-70 text-[10px]">✨ 移动十字光标查看各周期量化指标动态</span>
        </div>

        <div id="chart-${win.id}" class="w-full flex-1 ${win.period === 'f10' || win.period === 'news' || win.period === 'ai' || win.period === 'fundflow' || win.period === 'notes' ? 'hidden' : ''}"></div>
        <div id="f10-container-${win.id}" class="space-y-3.5 leading-relaxed ${win.period !== 'f10' ? 'hidden' : ''}"></div>
        <div id="news-container-${win.id}" class="space-y-3.5 leading-relaxed ${win.period !== 'news' ? 'hidden' : ''}"></div>
        <div id="ai-container-${win.id}" class="space-y-3.5 leading-relaxed ${win.period !== 'ai' ? 'hidden' : ''}"></div>
        <div id="fundflow-container-${win.id}" class="space-y-3.5 leading-relaxed ${win.period !== 'fundflow' ? 'hidden' : ''}"></div>
        <div id="notes-container-${win.id}" class="space-y-3.5 leading-relaxed ${win.period !== 'notes' ? 'hidden' : ''}"></div>
      </div>
    </div>
  `;
}

function renderWindowControlsHtml(win) {
  const isDark = theme === 'dark';
  return `
    <div class="flex flex-col gap-2 w-full">
      <!-- 第一行：K线周期与主副图技术指标 -->
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div class="flex items-center gap-1.5 period-btn-group">
          <span class="text-xs font-semibold opacity-60 mr-0.5">周期:</span>
          ${[
            { key: 'intraday', label: '分时' },
            { key: '5day', label: '5日分时' },
            { key: 'daily', label: '日K' },
            { key: 'weekly', label: '周K' },
            { key: 'monthly', label: '月K' },
            { key: '5m', label: '5m' },
            { key: '15m', label: '15m' },
            { key: '30m', label: '30m' },
            { key: '60m', label: '60m' }
          ].map(p => `
            <button onclick="setWindowPeriod('${win.id}', '${p.key}')" class="period-btn px-2.5 py-1 rounded-lg text-xs font-semibold transition-all ${
              win.period === p.key ? 'bg-blue-600 text-white shadow-sm' : (isDark ? 'text-slate-400 hover:text-slate-200 hover:bg-slate-800' : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200')
            }">${p.label}</button>
          `).join('')}
        </div>

        ${win.period !== 'intraday' && win.period !== '5day' && win.period !== 'f10' && win.period !== 'news' && win.period !== 'ai' && win.period !== 'fundflow' && win.period !== 'notes' ? `
          <div class="flex items-center gap-3">
            <div class="flex items-center gap-1.5">
              <span class="text-xs font-semibold opacity-60 mr-0.5">主图:</span>
              ${['MA', 'BOLL', 'EMA'].map(m => renderIndicatorBtn(win, m, 'main', 'bg-indigo-600')).join('')}
            </div>
            <div class="flex items-center gap-1.5">
              <span class="text-xs font-semibold opacity-60 mr-0.5">副图:</span>
              ${['VOL', 'MACD', 'RSI', 'KDJ'].map(s => renderIndicatorBtn(win, s, 'sub', 'bg-emerald-600')).join('')}
            </div>
          </div>
        ` : ((win.period === 'intraday' || win.period === '5day') ? `
          <div class="text-xs text-blue-400 flex items-center gap-3 font-semibold">
            <span class="flex items-center gap-1.5"><b class="w-3 h-0.5 bg-blue-500 inline-block"></b> 现价</span>
            <span class="flex items-center gap-1.5"><b class="w-3 h-0.5 bg-amber-500 inline-block"></b> 均价</span>
          </div>
        ` : `<div></div>`)}
      </div>

      <!-- 第二行：F10档案、资讯公告、五档盘口、资金流向、交易笔记与AI深度分析 -->
      <div class="flex flex-wrap items-center justify-between gap-2 pt-2 border-t ${isDark ? 'border-slate-800/80' : 'border-slate-200/80'}">
        <div class="flex items-center gap-2">
          <span class="text-xs font-semibold text-purple-400 mr-0.5">深度投研:</span>
          <button onclick="toggleWindowDepth('${win.id}')" class="px-2.5 py-1 rounded-lg text-xs font-semibold transition-all flex items-center gap-1 ${
            win.showDepth ? 'bg-indigo-600 text-white shadow-sm font-bold' : (isDark ? 'bg-slate-800/80 text-slate-300 hover:text-white hover:bg-slate-700' : 'bg-slate-100 text-slate-700 hover:bg-slate-200')
          }" title="展开/收起五档买卖深度挂单盘口">
            <span>📊 五档盘口</span>
          </button>
          <button onclick="setWindowPeriod('${win.id}', 'fundflow')" class="px-2.5 py-1 rounded-lg text-xs font-semibold transition-all flex items-center gap-1 ${
            win.period === 'fundflow' ? 'bg-blue-600 text-white shadow-sm font-bold' : (isDark ? 'bg-slate-800/80 text-slate-300 hover:text-white hover:bg-slate-700' : 'bg-slate-100 text-slate-700 hover:bg-slate-200')
          }" title="主力资金净流入与散户博弈">
            <span>🌊 资金流向</span>
          </button>
          <button onclick="setWindowPeriod('${win.id}', 'f10')" class="px-2.5 py-1 rounded-lg text-xs font-semibold transition-all flex items-center gap-1 ${
            win.period === 'f10' ? 'bg-blue-600 text-white shadow-sm font-bold' : (isDark ? 'bg-slate-800/80 text-slate-300 hover:text-white hover:bg-slate-700' : 'bg-slate-100 text-slate-700 hover:bg-slate-200')
          }">
            <span>📑 F10档案</span>
          </button>
          <button onclick="setWindowPeriod('${win.id}', 'news')" class="px-2.5 py-1 rounded-lg text-xs font-semibold transition-all flex items-center gap-1 ${
            win.period === 'news' ? 'bg-blue-600 text-white shadow-sm font-bold' : (isDark ? 'bg-slate-800/80 text-slate-300 hover:text-white hover:bg-slate-700' : 'bg-slate-100 text-slate-700 hover:bg-slate-200')
          }">
            <span>📰 资讯公告</span>
          </button>
          <button onclick="setWindowPeriod('${win.id}', 'notes')" class="px-2.5 py-1 rounded-lg text-xs font-semibold transition-all flex items-center gap-1 ${
            win.period === 'notes' ? 'bg-blue-600 text-white shadow-sm font-bold' : (isDark ? 'bg-slate-800/80 text-slate-300 hover:text-white hover:bg-slate-700' : 'bg-slate-100 text-slate-700 hover:bg-slate-200')
          }" title="记录买入逻辑与复盘备忘">
            <span>📝 交易笔记</span>
          </button>
          <button onclick="setWindowPeriod('${win.id}', 'ai')" class="px-3 py-1 rounded-lg text-xs font-bold transition-all flex items-center gap-1 shadow-sm ${
            win.period === 'ai'
              ? 'bg-gradient-to-r from-purple-600 to-indigo-600 text-white shadow-md shadow-indigo-500/25 ring-2 ring-purple-400/30'
              : 'bg-purple-950/40 text-purple-300 border border-purple-800/40 hover:bg-purple-900/60 hover:text-white'
          }">
            <span>📐 量化诊断 (喂给AI)</span>
          </button>
        </div>

        <div class="text-xs font-medium ${isDark ? 'text-slate-400' : 'text-slate-500'}">
          ${win.period === 'f10' ? '🏢 企业基本面与财务中枢' : (win.period === 'news' ? '⚡ 即时热点新闻 & 官方公告' : (win.period === 'fundflow' ? '🌊 主力大单博弈与资金流向' : (win.period === 'notes' ? '📝 个人交易复盘备忘' : (win.period === 'ai' ? '📐 规则多因子量化诊断模型' : '📈 专业技术走势图'))))}
        </div>
      </div>
    </div>
  `;
}

// 渲染指标按钮及 hover 教程卡片
function renderIndicatorBtn(win, name, type, activeColor) {
  const isDark = theme === 'dark';
  const isActive = type === 'main' ? win.mainIndicators.includes(name) : win.subIndicators.includes(name);
  const guide = INDICATOR_GUIDES[name] || {};

  return `
    <div class="relative group inline-flex items-center">
      <button onclick="toggleIndicator('${win.id}', '${name}', '${type}')" class="px-2 py-1 rounded-lg font-semibold text-xs flex items-center gap-0.5 transition-all ${
        isActive ? `${activeColor} text-white shadow-sm` : 'text-slate-400 hover:text-slate-200 bg-slate-800/80'
      }">
        ${isActive ? `✓ ${name}` : name}
      </button>

      <div class="pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-150 absolute left-1/2 -translate-x-1/2 top-full mt-1.5 w-80 p-3.5 rounded-2xl border shadow-2xl z-[300] text-xs leading-relaxed ${
        isDark ? 'bg-slate-900/98 border-slate-700 text-slate-200 shadow-black/90' : 'bg-white border-slate-200 text-slate-800 shadow-2xl'
      }">
        <div class="font-bold text-sm border-b pb-1.5 mb-1.5 flex items-center justify-between">
          <span class="${isDark ? 'text-blue-400' : 'text-blue-600'}">${guide.fullName || name}</span>
          <span class="text-xs px-2 py-0.5 rounded bg-slate-700/50 opacity-80">实战解读</span>
        </div>
        <div class="text-xs opacity-80 mb-2">${guide.summary || ''}</div>
        <div class="text-xs font-semibold mb-1 text-amber-500">📖 怎么看与用法:</div>
        <div class="text-xs whitespace-pre-line opacity-90 leading-normal space-y-1">
          ${guide.howToUse || ''}
        </div>
      </div>
    </div>
  `;
}

// 展开/收起变形核心逻辑
function toggleMorphDrawer(open) {
  const widget = document.getElementById('omni-morph-widget');
  const ballView = document.getElementById('morph-ball-view');
  const panelView = document.getElementById('morph-panel-view');
  if (!widget) return;

  if (open) {
    savedBallPos = { ...widgetPos };
    isDrawerOpen = true;

    let targetX = savedBallPos.x - 330;
    let targetY = savedBallPos.y - 470;

    targetX = Math.max(15, Math.min(window.innerWidth - 405, targetX));
    targetY = Math.max(15, Math.min(window.innerHeight - 545, targetY));

    widgetPos = { x: targetX, y: targetY };

    widget.style.left = `${targetX}px`;
    widget.style.top = `${targetY}px`;
    widget.style.width = '390px';
    widget.style.height = '530px';
    widget.style.borderRadius = '22px';

    if (ballView) {
      ballView.style.opacity = '0';
      ballView.style.transform = 'scale(0.5)';
      ballView.style.pointerEvents = 'none';
    }
    if (panelView) {
      panelView.style.opacity = '1';
      panelView.style.transform = 'scale(1)';
      panelView.style.pointerEvents = 'auto';
      updateWatchlistDOM();
      updateRibbonDOM();
    }
  } else {
    isDrawerOpen = false;
    widgetPos = {
      x: Math.max(15, Math.min(window.innerWidth - 75, savedBallPos.x)),
      y: Math.max(15, Math.min(window.innerHeight - 75, savedBallPos.y))
    };

    widget.style.left = `${widgetPos.x}px`;
    widget.style.top = `${widgetPos.y}px`;
    widget.style.width = '56px';
    widget.style.height = '56px';
    widget.style.borderRadius = '28px';

    if (panelView) {
      panelView.style.opacity = '0';
      panelView.style.transform = 'scale(0.94)';
      panelView.style.pointerEvents = 'none';
    }
    if (ballView) {
      ballView.style.opacity = '0.82';
      ballView.style.transform = 'scale(1)';
      ballView.style.pointerEvents = 'auto';
    }
  }
}

// 绑定抽屉与搜索事件
function bindDrawerEvents() {
  const widget = document.getElementById('omni-morph-widget');
  const ballView = document.getElementById('morph-ball-view');
  const dragHeader = document.getElementById('panel-drag-header');

  const setupDrag = (triggerEl) => {
    if (!triggerEl || !widget) return;
    let isDragging = false, startX = 0, startY = 0, initialX = 0, initialY = 0;

    triggerEl.addEventListener('mousedown', e => {
      if (e.target.closest('button') || e.target.closest('input')) return;
      isDragging = false;
      startX = e.clientX; startY = e.clientY;
      initialX = widgetPos.x; initialY = widgetPos.y;

      const onMove = ev => {
        const dx = ev.clientX - startX, dy = ev.clientY - startY;
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
          isDragging = true;
          widget.classList.add('is-dragging');
        }
        widgetPos.x = Math.max(10, Math.min(window.innerWidth - (isDrawerOpen ? 395 : 60), initialX + dx));
        widgetPos.y = Math.max(10, Math.min(window.innerHeight - (isDrawerOpen ? 535 : 60), initialY + dy));
        widget.style.left = `${widgetPos.x}px`;
        widget.style.top = `${widgetPos.y}px`;
      };

      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        widget.classList.remove('is-dragging');
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });

    if (triggerEl === ballView) {
      triggerEl.addEventListener('click', () => {
        if (!isDragging) {
          toggleMorphDrawer(true);
        }
      });
    }
  };

  setupDrag(ballView);
  setupDrag(dragHeader);

  // 搜索输入与点击自动加入自选
  const searchInput = document.getElementById('search-input');
  const searchDropdown = document.getElementById('search-dropdown');
  if (searchInput && searchDropdown) {
    let timeout;
    searchInput.addEventListener('input', e => {
      const q = e.target.value.trim();
      clearTimeout(timeout);
      if (!q) {
        searchDropdown.classList.add('hidden');
        searchDropdown.innerHTML = '';
        return;
      }

      // 展现加载中提示
      searchDropdown.innerHTML = `<div class="p-3 text-center text-xs text-slate-400">正在搜索【${q}】...</div>`;
      searchDropdown.classList.remove('hidden');

      timeout = setTimeout(async () => {
        try {
          const res = await fetch(`/dsh-plugin-stock-x/search?q=${encodeURIComponent(q)}`).then(r => r.json());
          const list = (res.data || []).filter(item => item && item.code && item.name);
          if (list.length === 0) {
            searchDropdown.innerHTML = `
              <div class="p-4 text-center text-xs text-slate-400">
                <div class="font-semibold text-slate-300 mb-1">🔍 未搜索到【${q}】相关股票</div>
                <div class="text-[11px] opacity-70">支持输入股票代码 (如 600519/00700/NVDA) 或 拼音首字母 (如 gzmt/bdyy)</div>
              </div>`;
          } else {
            searchDropdown.innerHTML = list.map(item => `
              <div onclick="selectAndAddStock('${item.symbol}', '${item.name}', '${item.market}')"
                class="px-3.5 py-2.5 cursor-pointer flex items-center justify-between hover:bg-blue-600/15 transition-colors group">
                <div class="flex items-center gap-2 min-w-0">
                  <span class="text-[10px] font-bold px-1.5 py-0.5 rounded border bg-blue-500/10 text-blue-400 border-blue-500/20">${item.market}</span>
                  <span class="font-bold text-xs truncate group-hover:text-blue-400">${item.name}</span>
                  <span class="text-xs font-mono opacity-50">${item.symbol}</span>
                </div>
                <span class="px-2.5 py-1 rounded bg-blue-600 text-white text-xs font-semibold group-hover:bg-blue-500">
                  + 加自选并看图
                </span>
              </div>
            `).join('');
          }
        } catch (err) {
          searchDropdown.innerHTML = `<div class="p-3 text-center text-xs text-red-400">搜索请求异常，请重试</div>`;
        }
        searchDropdown.classList.remove('hidden');
      }, 180);
    });

    document.addEventListener('click', e => {
      if (!searchInput.contains(e.target) && !searchDropdown.contains(e.target)) {
        searchDropdown.classList.add('hidden');
      }
    });
  }
}

// 绑定单个窗口的交互事件
function bindSingleWindowEvents(win) {
  const winEl = document.getElementById(win.id);
  if (!winEl) return;

  winEl.addEventListener('mousedown', () => focusWindow(win.id));

  // 1. 如果窗口处于收起（最小化）状态，绑定胶囊条拖拽移动事件
  if (win.isMinimized) {
    winEl.addEventListener('mousedown', e => {
      if (e.target.closest('button')) return;
      focusWindow(win.id);
      const startX = e.clientX, startY = e.clientY;
      const initialX = win.x, initialY = win.y;

      const onMove = ev => {
        win.x = Math.max(10, Math.min(window.innerWidth - 100, initialX + (ev.clientX - startX)));
        win.y = Math.max(10, Math.min(window.innerHeight - 45, initialY + (ev.clientY - startY)));
        winEl.style.left = `${win.x}px`;
        winEl.style.top = `${win.y}px`;
      };

      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
    return;
  }

  // 2. 正常展开窗口的头部拖拽移动
  const header = winEl.querySelector('.window-header');
  if (header) {
    header.addEventListener('mousedown', e => {
      if (e.target.closest('button')) return;
      focusWindow(win.id);
      const startX = e.clientX, startY = e.clientY;
      const initialX = win.x, initialY = win.y;

      const onMove = ev => {
        win.x = Math.max(10, Math.min(window.innerWidth - 100, initialX + (ev.clientX - startX)));
        win.y = Math.max(10, Math.min(window.innerHeight - 80, initialY + (ev.clientY - startY)));
        winEl.style.left = `${win.x}px`;
        winEl.style.top = `${win.y}px`;
      };

      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  // 8 边角缩放
  const resizeHandles = winEl.querySelectorAll('.resize-handle');
  resizeHandles.forEach(handle => {
    handle.addEventListener('mousedown', e => {
      e.stopPropagation();
      focusWindow(win.id);
      const dir = handle.getAttribute('data-dir');
      const startX = e.clientX, startY = e.clientY;
      const initX = win.x, initY = win.y, initW = win.width, initH = win.height;

      const onMove = ev => {
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;

        let newX = initX, newY = initY, newW = initW, newH = initH;

        if (dir.includes('e')) newW = Math.max(450, initW + dx);
        if (dir.includes('s')) newH = Math.max(500, initH + dy);
        if (dir.includes('w')) {
          const possibleW = initW - dx;
          if (possibleW >= 450) {
            newW = possibleW;
            newX = initX + dx;
          }
        }
        if (dir.includes('n')) {
          const possibleH = initH - dy;
          if (possibleH >= 500) {
            newH = possibleH;
            newY = initY + dy;
          }
        }

        win.x = newX; win.y = newY; win.width = newW; win.height = newH;
        winEl.style.left = `${win.x}px`;
        winEl.style.top = `${win.y}px`;
        winEl.style.width = `${win.width}px`;
        winEl.style.height = `${win.height}px`;

        if (win.chartInstance) win.chartInstance.resize();
      };

      const onUp = () => {
        if (win.chartInstance) win.chartInstance.resize();
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  });

  if (win.period === 'f10') {
    renderF10(win);
  } else if (win.period === 'news') {
    renderNews(win);
  } else if (win.period === 'ai') {
    renderAIAnalysis(win);
  } else {
    renderChart(win);
  }
}

// 搜索结果点击：自动加入自选并打开看图
async function selectAndAddStock(symbol, name, market) {
  clearSearch();
  await addToWatchlist(symbol, name, market);
  openChart(symbol, name, market);
}

// 渲染 F10 深度档案看板
async function renderF10(win) {
  const chartEl = document.getElementById(`chart-${win.id}`);
  const newsContainer = document.getElementById(`news-container-${win.id}`);
  const aiContainer = document.getElementById(`ai-container-${win.id}`);
  const container = document.getElementById(`f10-container-${win.id}`);
  if (!container) return;
  const isDark = theme === 'dark';

  if (chartEl) chartEl.classList.add('hidden');
  if (newsContainer) newsContainer.classList.add('hidden');
  if (aiContainer) aiContainer.classList.add('hidden');
  container.classList.remove('hidden');

  const key = win.symbol.toLowerCase();
  const hasCache = memoryCache.f10.has(key);
  if (!hasCache && !container.innerHTML.includes('🏢')) {
    container.innerHTML = `<div class="p-8 text-center text-sm text-slate-400">正在加载 F10 档案资料...</div>`;
  }

  try {
    const d = await fetchCachedF10(win.symbol);
    if (!d) {
      container.innerHTML = `<div class="p-8 text-center text-sm text-slate-400">暂未查询到该股票的 F10 档案资料</div>`;
      return;
    }

    const fin = d.financials || {};

    container.innerHTML = `
      <!-- 1. 公司基本资料 -->
      <div class="p-4 rounded-xl border ${isDark ? 'bg-slate-900/80 border-slate-800' : 'bg-white border-slate-200'}">
        <div class="font-extrabold text-base text-blue-500 mb-2.5 flex items-center justify-between">
          <span>🏢 ${d.name} (${d.code})</span>
          <span class="text-xs font-semibold px-2.5 py-0.5 rounded bg-blue-500/10 border border-blue-500/20 text-blue-400">${d.industry}</span>
        </div>

        <div class="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs font-mono opacity-90">
          <div><span class="opacity-60 block text-[11px] mb-0.5">法定代表:</span><span class="font-bold">${d.legal_person}</span></div>
          <div><span class="opacity-60 block text-[11px] mb-0.5">注册资本:</span><span class="font-bold">${d.reg_capital}</span></div>
          <div><span class="opacity-60 block text-[11px] mb-0.5">成立日期:</span><span>${d.established_date}</span></div>
          <div><span class="opacity-60 block text-[11px] mb-0.5">上市日期:</span><span>${d.listing_date}</span></div>
          <div class="col-span-2"><span class="opacity-60 block text-[11px] mb-0.5">官方网站:</span><a href="http://${d.website}" target="_blank" class="text-blue-400 hover:underline font-semibold">${d.website}</a></div>
          <div class="col-span-2 truncate"><span class="opacity-60 block text-[11px] mb-0.5">注册地址:</span><span>${d.address}</span></div>
        </div>
      </div>

      <!-- 2. 所属核心题材与板块标签 -->
      ${d.concepts && d.concepts.length > 0 ? `
        <div class="p-4 rounded-xl border ${isDark ? 'bg-slate-900/80 border-slate-800' : 'bg-white border-slate-200'}">
          <div class="font-bold text-sm text-amber-500 mb-2.5 flex items-center gap-1.5">
            <span>🏷️ 概念题材与所属板块 (${d.concepts.length})</span>
          </div>
          <div class="flex flex-wrap gap-2">
            ${d.concepts.map(c => `
              <span class="px-2.5 py-1 rounded-lg text-xs font-semibold border ${
                isDark ? 'bg-slate-800/90 text-slate-200 border-slate-700' : 'bg-slate-100 text-slate-800 border-slate-300'
              }">${c}</span>
            `).join('')}
          </div>
        </div>
      ` : ''}

      <!-- 3. 主要财务与盈利中枢 -->
      <div class="p-4 rounded-xl border ${isDark ? 'bg-slate-900/80 border-slate-800' : 'bg-white border-slate-200'}">
        <div class="font-bold text-sm text-emerald-500 mb-3 flex items-center justify-between">
          <span>📊 主要财务与盈利中枢</span>
          <span class="text-xs font-mono font-semibold px-2.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">${fin.report_period || '最新'}</span>
        </div>

        <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs font-mono">
          <div class="p-2.5 rounded-lg ${isDark ? 'bg-slate-950/60' : 'bg-slate-50'}">
            <span class="text-xs opacity-60 block mb-0.5">营业总收入</span>
            <span class="font-bold text-base text-blue-400">${fin.revenue}</span>
            <span class="text-xs block opacity-75 mt-1">同比: ${fin.revenue_yoy}</span>
          </div>

          <div class="p-2.5 rounded-lg ${isDark ? 'bg-slate-950/60' : 'bg-slate-50'}">
            <span class="text-xs opacity-60 block mb-0.5">归母净利润</span>
            <span class="font-bold text-base text-red-500">${fin.net_profit}</span>
            <span class="text-xs block opacity-75 mt-1">同比: ${fin.net_profit_yoy}</span>
          </div>

          <div class="p-2.5 rounded-lg ${isDark ? 'bg-slate-950/60' : 'bg-slate-50'}">
            <span class="text-xs opacity-60 block mb-0.5">加权净资产收益率 (ROE)</span>
            <span class="font-bold text-base text-amber-500">${fin.roe}</span>
            <span class="text-xs block opacity-75 mt-1">资产负债率: ${fin.debt_ratio}</span>
          </div>

          <div class="p-2.5 rounded-lg ${isDark ? 'bg-slate-950/60' : 'bg-slate-50'}">
            <span class="text-xs opacity-60 block mb-0.5">销售毛利率 / 净利率</span>
            <span class="font-bold text-base text-purple-400">${fin.gross_margin}</span>
            <span class="text-xs block opacity-75 mt-1">净利率: ${fin.net_margin}</span>
          </div>

          <div class="p-2.5 rounded-lg ${isDark ? 'bg-slate-950/60' : 'bg-slate-50'}">
            <span class="text-xs opacity-60 block mb-0.5">每股基本收益 (EPS)</span>
            <span class="font-bold text-base text-emerald-400">${fin.eps}</span>
          </div>

          <div class="p-2.5 rounded-lg ${isDark ? 'bg-slate-950/60' : 'bg-slate-50'}">
            <span class="text-xs opacity-60 block mb-0.5">每股净资产 (BPS)</span>
            <span class="font-bold text-base text-cyan-400">${fin.bps}</span>
          </div>
        </div>
      </div>

      <!-- 4. 主营业务与公司简介 -->
      <div class="p-4 rounded-xl border ${isDark ? 'bg-slate-900/80 border-slate-800' : 'bg-white border-slate-200'}">
        <div class="font-bold text-sm text-blue-400 mb-2">💼 经营范围与主营业务</div>
        <div class="text-xs opacity-90 leading-relaxed mb-3.5">${d.business_scope}</div>

        <div class="font-bold text-sm text-slate-300 mb-2">📝 公司详细简介</div>
        <div class="text-xs opacity-85 leading-relaxed indent-5">${d.description}</div>
      </div>
    `;
  } catch (e) {
    container.innerHTML = `<div class="p-8 text-center text-sm text-red-400">加载 F10 档案失败: ${e.message}</div>`;
  }
}

// 渲染 即时新闻资讯与官方公告 看板
async function renderNews(win) {
  const chartEl = document.getElementById(`chart-${win.id}`);
  const f10Container = document.getElementById(`f10-container-${win.id}`);
  const aiContainer = document.getElementById(`ai-container-${win.id}`);
  const container = document.getElementById(`news-container-${win.id}`);
  if (!container) return;
  const isDark = theme === 'dark';

  if (chartEl) chartEl.classList.add('hidden');
  if (f10Container) f10Container.classList.add('hidden');
  if (aiContainer) aiContainer.classList.add('hidden');
  container.classList.remove('hidden');

  const key = win.symbol.toLowerCase();
  const hasCache = memoryCache.news.has(key);
  if (!hasCache && !container.innerHTML.includes('📰')) {
    container.innerHTML = `<div class="p-8 text-center text-sm text-slate-400">正在加载即时资讯与官方公告...</div>`;
  }

  try {
    const d = await fetchCachedNews(win.symbol, win.name);
    const news = d?.news || [];
    const notices = d?.notices || [];

    container.innerHTML = `
      <!-- 1. 即时热点资讯 -->
      <div class="p-4 rounded-xl border ${isDark ? 'bg-slate-900/80 border-slate-800' : 'bg-white border-slate-200'}">
        <div class="font-bold text-sm text-blue-400 mb-3 flex items-center justify-between">
          <span>📰 即时热点资讯 & 市场动态 (${news.length})</span>
          <span class="text-xs opacity-60">全网实时财经聚合</span>
        </div>

        <div class="divide-y ${isDark ? 'divide-slate-800' : 'divide-slate-100'}">
          ${news.length > 0 ? news.map(n => `
            <div class="py-2.5 flex flex-col gap-1.5 hover:bg-blue-500/5 px-2 rounded transition-colors">
              <div class="flex items-center justify-between gap-2.5">
                <a href="${n.url}" target="_blank" class="font-bold text-sm text-slate-200 hover:text-blue-400 line-clamp-1 flex-1">
                  ${n.title}
                </a>
                <span class="text-xs px-2 py-0.5 rounded bg-blue-500/10 text-blue-400 font-medium flex-shrink-0">${n.media}</span>
              </div>
              <div class="text-xs font-mono opacity-50">${n.date}</div>
            </div>
          `).join('') : `
            <div class="py-6 text-center text-sm text-slate-400">暂无相关最新新闻</div>
          `}
        </div>
      </div>

      <!-- 2. 官方披露公告 -->
      <div class="p-4 rounded-xl border ${isDark ? 'bg-slate-900/80 border-slate-800' : 'bg-white border-slate-200'}">
        <div class="font-bold text-sm text-amber-500 mb-3 flex items-center justify-between">
          <span>📢 官方披露公告 (${notices.length})</span>
          <span class="text-xs opacity-60">交易所法定权威披露</span>
        </div>

        <div class="divide-y ${isDark ? 'divide-slate-800' : 'divide-slate-100'}">
          ${notices.length > 0 ? notices.map(a => `
            <div class="py-2.5 flex items-center justify-between gap-3 hover:bg-amber-500/5 px-2 rounded transition-colors">
              <a href="${a.url}" target="_blank" class="font-semibold text-sm text-slate-200 hover:text-amber-400 line-clamp-1 flex-1">
                ${a.title}
              </a>
              <span class="text-xs font-mono opacity-70 flex-shrink-0 font-medium">${a.date}</span>
            </div>
          `).join('') : `
            <div class="py-6 text-center text-sm text-slate-400">暂无官方最新公告</div>
          `}
        </div>
      </div>
    `;
  } catch (e) {
    container.innerHTML = `<div class="p-8 text-center text-sm text-red-400">加载资讯公告失败: ${e.message}</div>`;
  }
}

// 🌟 渲染全景 AI 智能量化与基本面深度研报诊断看板
async function renderAIAnalysis(win) {
  const chartEl = document.getElementById(`chart-${win.id}`);
  const f10Container = document.getElementById(`f10-container-${win.id}`);
  const newsContainer = document.getElementById(`news-container-${win.id}`);
  const container = document.getElementById(`ai-container-${win.id}`);
  if (!container) return;
  const isDark = theme === 'dark';

  if (chartEl) chartEl.classList.add('hidden');
  if (f10Container) f10Container.classList.add('hidden');
  if (newsContainer) newsContainer.classList.add('hidden');
  container.classList.remove('hidden');

// 🌊 渲染主力与散户资金流向面板
async function renderFundFlow(win) {
  const chartEl = document.getElementById(`chart-${win.id}`);
  const hudEl = document.getElementById(`hud-bar-${win.id}`);
  const f10Container = document.getElementById(`f10-container-${win.id}`);
  const newsContainer = document.getElementById(`news-container-${win.id}`);
  const aiContainer = document.getElementById(`ai-container-${win.id}`);
  const fundContainer = document.getElementById(`fundflow-container-${win.id}`);
  const notesContainer = document.getElementById(`notes-container-${win.id}`);

  if (chartEl) chartEl.classList.add('hidden');
  if (hudEl) hudEl.classList.add('hidden');
  if (f10Container) f10Container.classList.add('hidden');
  if (newsContainer) newsContainer.classList.add('hidden');
  if (aiContainer) aiContainer.classList.add('hidden');
  if (notesContainer) notesContainer.classList.add('hidden');
  if (!fundContainer) return;
  fundContainer.classList.remove('hidden');

  const isDark = theme === 'dark';
  fundContainer.innerHTML = `<div class="p-8 text-center text-sm ${isDark ? 'text-slate-400' : 'text-slate-500'}">⏳ 正在获取【${win.name}】主力与散户资金流向数据...</div>`;

  try {
    const data = await fetchCachedFundFlow(win.symbol);
    if (!data || !data.latest) {
      fundContainer.innerHTML = `<div class="p-8 text-center text-sm ${isDark ? 'text-slate-400' : 'text-slate-500'}">暂无该标的资金流向数据（指数或部分海外标的不提供资金流向明细）</div>`;
      return;
    }

    const cur = data.latest;
    const isMainIn = cur.main_inflow >= 0;
    const formatYuan = (n) => {
      const abs = Math.abs(n);
      const sign = n >= 0 ? '+' : '-';
      if (abs >= 100000000) return `${sign}¥${(abs / 100000000).toFixed(2)}亿`;
      if (abs >= 10000) return `${sign}¥${(abs / 10000).toFixed(1)}万`;
      return `${sign}¥${abs.toFixed(0)}`;
    };

    fundContainer.innerHTML = `
      <!-- 主力资金概览卡片 -->
      <div class="p-4 rounded-2xl border ${isDark ? 'bg-slate-900/90 border-slate-800' : 'bg-white border-slate-200 shadow-sm'}">
        <div class="flex items-center justify-between mb-3">
          <div class="flex items-center gap-2">
            <span class="font-extrabold text-sm text-blue-400">🌊 今日主力资金多空博弈</span>
            <span class="text-[10px] px-2 py-0.5 rounded-full font-mono font-bold ${isMainIn ? getTrendBadgeClass(true) : getTrendBadgeClass(false)}">
              ${isMainIn ? '🔥 主力净流入' : '⚠️ 主力净流出'}
            </span>
          </div>
          <span class="text-xs font-mono opacity-60">${cur.date}</span>
        </div>

        <div class="grid grid-cols-2 gap-3 mb-4">
          <div class="p-3 rounded-xl border ${isDark ? 'bg-slate-950/60 border-slate-800' : 'bg-slate-50 border-slate-200'}">
            <span class="text-xs block opacity-60 mb-0.5">主力净流入 (超大单+大单)</span>
            <span class="font-mono font-black text-base ${getTrendTextClass(isMainIn)}">${formatYuan(cur.main_inflow)}</span>
          </div>
          <div class="p-3 rounded-xl border ${isDark ? 'bg-slate-950/60 border-slate-800' : 'bg-slate-50 border-slate-200'}">
            <span class="text-xs block opacity-60 mb-0.5">散户净流入 (小单)</span>
            <span class="font-mono font-black text-base ${getTrendTextClass(cur.small_inflow >= 0)}">${formatYuan(cur.small_inflow)}</span>
          </div>
        </div>

        <!-- 资金四档占比条 -->
        <div class="space-y-2 text-xs">
          <div class="flex justify-between font-semibold">
            <span>超大单净额: <b class="${getTrendTextClass(cur.super_large_inflow >= 0)}">${formatYuan(cur.super_large_inflow)}</b></span>
            <span class="opacity-70">${data.ratios.super_large}%</span>
          </div>
          <div class="flex justify-between font-semibold">
            <span>大单净额: <b class="${getTrendTextClass(cur.large_inflow >= 0)}">${formatYuan(cur.large_inflow)}</b></span>
            <span class="opacity-70">${data.ratios.large}%</span>
          </div>
          <div class="flex justify-between font-semibold">
            <span>中单净额: <b class="${getTrendTextClass(cur.medium_inflow >= 0)}">${formatYuan(cur.medium_inflow)}</b></span>
            <span class="opacity-70">${data.ratios.medium}%</span>
          </div>
          <div class="flex justify-between font-semibold">
            <span>小单净额: <b class="${getTrendTextClass(cur.small_inflow >= 0)}">${formatYuan(cur.small_inflow)}</b></span>
            <span class="opacity-70">${data.ratios.small}%</span>
          </div>
        </div>
      </div>

      <!-- 近5日资金流向历史趋势 -->
      <div class="p-4 rounded-2xl border ${isDark ? 'bg-slate-900/90 border-slate-800' : 'bg-white border-slate-200 shadow-sm'}">
        <div class="font-bold text-sm text-indigo-400 mb-3">📅 近5日主力资金流向趋势</div>
        <div class="divide-y font-mono text-xs ${isDark ? 'divide-slate-800' : 'divide-slate-100'}">
          ${data.history.slice(-5).reverse().map(h => `
            <div class="py-2 flex items-center justify-between">
              <span class="opacity-70">${h.date}</span>
              <span class="font-bold ${getTrendTextClass(h.main_inflow >= 0)}">${formatYuan(h.main_inflow)}</span>
              <span class="text-[11px] opacity-60">散户:${formatYuan(h.small_inflow)}</span>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  } catch (err) {
    fundContainer.innerHTML = `<div class="p-8 text-center text-sm text-red-400">加载资金流向失败: ${err.message}</div>`;
  }
}

// 📝 渲染个股交易逻辑与复盘备忘笔记
function renderNotes(win) {
  const chartEl = document.getElementById(`chart-${win.id}`);
  const hudEl = document.getElementById(`hud-bar-${win.id}`);
  const f10Container = document.getElementById(`f10-container-${win.id}`);
  const newsContainer = document.getElementById(`news-container-${win.id}`);
  const aiContainer = document.getElementById(`ai-container-${win.id}`);
  const fundContainer = document.getElementById(`fundflow-container-${win.id}`);
  const notesContainer = document.getElementById(`notes-container-${win.id}`);

  if (chartEl) chartEl.classList.add('hidden');
  if (hudEl) hudEl.classList.add('hidden');
  if (f10Container) f10Container.classList.add('hidden');
  if (newsContainer) newsContainer.classList.add('hidden');
  if (aiContainer) aiContainer.classList.add('hidden');
  if (fundContainer) fundContainer.classList.add('hidden');
  if (!notesContainer) return;
  notesContainer.classList.remove('hidden');

  const isDark = theme === 'dark';
  const sym = win.symbol.toLowerCase();
  const noteObj = userNotes[sym] || { content: '', updatedAt: null };
  const currentTagId = userTags[sym] || null;
  const currentTag = STOCK_TAG_OPTIONS.find(t => t.id === currentTagId);

  notesContainer.innerHTML = `
    <div class="p-4 rounded-2xl border space-y-4 ${isDark ? 'bg-slate-900/90 border-slate-800' : 'bg-white border-slate-200 shadow-sm'}">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2">
          <span class="font-extrabold text-sm text-blue-400">📝 【${win.name}】交易逻辑与复盘备忘</span>
          ${currentTag ? `<span class="text-xs px-2 py-0.5 rounded-md border font-semibold ${currentTag.color}">${currentTag.label}</span>` : ''}
        </div>
        <button onclick="openTagModal('${win.symbol}', '${win.name}')" class="px-2.5 py-1 rounded-lg border text-xs font-semibold hover:border-blue-500 transition-colors ${isDark ? 'bg-slate-800 border-slate-700' : 'bg-slate-100 border-slate-200'}">
          🏷️ 设置标签
        </button>
      </div>

      <div>
        <textarea id="note-input-${win.id}" rows="6" placeholder="记录你关注或买入该股票的核心逻辑、技术买点、止盈目标、止损计划与复盘心得..." class="w-full p-3 rounded-xl border font-sans text-xs focus:outline-none focus:border-blue-500 leading-relaxed ${
          isDark ? 'bg-slate-950/70 border-slate-800 text-slate-100 placeholder-slate-500' : 'bg-slate-50 border-slate-300 text-slate-900 placeholder-slate-400'
        }">${noteObj.content || ''}</textarea>
        <div class="flex items-center justify-between mt-2">
          <span class="text-[11px] opacity-60">
            ${noteObj.updatedAt ? `🕒 最后更新: ${noteObj.updatedAt}` : '💡 内容加密保存在本地，绝不上云'}
          </span>
          <button onclick="saveStockNote('${win.id}', '${win.symbol}')" class="px-4 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs shadow-md">
            💾 保存笔记
          </button>
        </div>
      </div>
    </div>
  `;
}

function saveStockNote(winId, symbol) {
  const input = document.getElementById(`note-input-${winId}`);
  if (!input) return;
  const content = input.value.trim();
  const sym = symbol.toLowerCase();
  const timeStr = new Date().toLocaleString();
  userNotes[sym] = { content, updatedAt: timeStr };
  saveNotes();
  showToast(`✅ 已保存【${symbol}】交易复盘笔记！`);
  const win = floatingWindows.find(w => w.id === winId);
  if (win && win.period === 'notes') renderNotes(win);
}

// 策略定制提示词构造器
function buildStrategyPrompt(symbol, name, aiData, quote, newsList, strategy = 'general') {
  const isUp = (quote.change || 0) >= 0;
  const sign = isUp ? '+' : '';
  const baseInfo = `【${name} (${symbol}) 股票实时投研诊断与交易决策咨询】
- 最新现价: ¥${quote.current_price?.toFixed(2) || '--'} (今日涨跌: ${sign}${quote.change_pct?.toFixed(2) || '0.00'}%)
- 今开 / 昨收: ¥${quote.open?.toFixed(2) || '--'} / ¥${quote.prev_close?.toFixed(2) || '--'}
- 最高 / 最低: ¥${quote.high?.toFixed(2) || '--'} / ¥${quote.low?.toFixed(2) || '--'}
- 换手率: ${quote.turnover_rate ? quote.turnover_rate.toFixed(2) + '%' : '--'}，成交额: ${quote.turnover ? '¥' + (quote.turnover / 100000000).toFixed(2) + '亿' : '--'}
- 市盈率(PE): ${quote.pe_ratio?.toFixed(1) || '--'}，市净率(PB): ${quote.pb_ratio?.toFixed(1) || '--'}，总市值: ${quote.market_cap ? quote.market_cap.toFixed(0) + '亿' : '--'}`;

  const newsStr = newsList && newsList.length > 0
    ? `\n最新资讯动态 (附源链接):\n${newsList.slice(0, 3).map((n, i) => `${i+1}. [${n.media}] [${n.title}](${n.url})`).join('\n')}\n`
    : '';

  if (strategy === 'short_term') {
    return `${baseInfo}
${newsStr}
【短线打板与动量攻防策略咨询】
请结合当前的分时量价异动、技术均线突破与日内盘口博弈，重点分析：
1. 关键突破压力位与短线回调支撑位；
2. 短线动量是否具备持续性（多空力量对比）；
3. 明确的短线买入触发条件与严格纪律止损位 (-3% ~ -5%)。`;
  }

  if (strategy === 'value_invest') {
    return `${baseInfo}
${newsStr}
【价值投资与长期基本面估值咨询】
请结合公司的行业地位、财务估值中枢与长期成长性，重点分析：
1. 当前 PE / PB 估值所处历史百分位及安全边际；
2. 公司核心商业壁垒与未来 1~3 年业绩增长确定性；
3. 分批定投或长期持有的仓位建仓策略。`;
  }

  if (strategy === 't_grid') {
    return `${baseInfo}
${newsStr}
【套牢自救与日内网格做T策略咨询】
请结合当前的振幅特征与分时均价波动，重点分析：
1. 日内做T的高抛低吸关键点位（日内阻力/支撑）；
2. 网格交易区间与分批补仓间距建议；
3. 如何在控制总仓位风险的前提下快速降低持仓成本。`;
  }

  // 默认全景综合
  if (aiData && aiData.prompt_report) {
    return aiData.prompt_report;
  }

  return `${baseInfo}
${newsStr}
请结合以上实时行情盘口与量化特征，深度分析：
1. 短线走势与多空动能（阻力位、支撑位、止损位设定）；
2. 中长线基本面估值与行业景气度评估；
3. 具体的仓位管理与操作策略建议。`;
}

function setAiPromptStrategy(winId, symbol, strategyKey) {
  const win = floatingWindows.find(w => w.id === winId);
  if (win) {
    win.aiStrategy = strategyKey;
    renderAIAnalysis(win);
  }
}

// 🌟 渲染全景 AI 智能量化与基本面深度研报诊断看板
async function renderAIAnalysis(win) {
  const chartEl = document.getElementById(`chart-${win.id}`);
  const hudEl = document.getElementById(`hud-bar-${win.id}`);
  const f10Container = document.getElementById(`f10-container-${win.id}`);
  const newsContainer = document.getElementById(`news-container-${win.id}`);
  const fundContainer = document.getElementById(`fundflow-container-${win.id}`);
  const notesContainer = document.getElementById(`notes-container-${win.id}`);
  const container = document.getElementById(`ai-container-${win.id}`);
  if (!container) return;
  const isDark = theme === 'dark';

  if (chartEl) chartEl.classList.add('hidden');
  if (hudEl) hudEl.classList.add('hidden');
  if (f10Container) f10Container.classList.add('hidden');
  if (newsContainer) newsContainer.classList.add('hidden');
  if (fundContainer) fundContainer.classList.add('hidden');
  if (notesContainer) notesContainer.classList.add('hidden');
  container.classList.remove('hidden');

  const key = win.symbol.toLowerCase();
  const hasCache = memoryCache.ai.has(key);
  if (!hasCache && !container.innerHTML.includes('🤖')) {
    container.innerHTML = `
      <div class="p-12 text-center flex flex-col items-center justify-center gap-3">
        <div class="w-10 h-10 border-4 border-purple-500 border-t-transparent rounded-full animate-spin"></div>
        <div class="font-bold text-base text-purple-400">正在聚合盘口行情、时序指标、F10财报与最新资讯...</div>
        <div class="text-xs text-slate-400">AI 智能量化模型正在进行多因子推演诊断...</div>
      </div>
    `;
  }

  try {
    const [ai, nData] = await Promise.all([
      fetchCachedAIAnalysis(win.symbol),
      fetchCachedNews(win.symbol, win.name)
    ]);
    if (!ai) {
      container.innerHTML = `<div class="p-8 text-center text-sm text-slate-400">未能生成该股票的 AI 诊断分析</div>`;
      return;
    }

    const curStrategy = win.aiStrategy || 'general';
    const quote = watchlist.find(w => w.symbol.toLowerCase() === win.symbol.toLowerCase()) || {};
    const promptContent = buildStrategyPrompt(win.symbol, win.name, ai, quote, nData?.news || [], curStrategy);

    container.innerHTML = `
      <!-- 策略模式选择药丸 -->
      <div class="flex items-center gap-1.5 p-1 rounded-xl border mb-3 ${isDark ? 'bg-slate-950/60 border-slate-800' : 'bg-slate-100 border-slate-200'}">
        <span class="text-[10px] font-bold opacity-60 ml-2 mr-1">策略模式:</span>
        ${[
          { key: 'general', label: '🎯 全景投研' },
          { key: 'short_term', label: '⚡ 短线攻防' },
          { key: 'value_invest', label: '💎 价值长线' },
          { key: 't_grid', label: '🔄 做T解套' }
        ].map(s => `
          <button onclick="setAiPromptStrategy('${win.id}', '${win.symbol}', '${s.key}')"
            class="px-2.5 py-1 rounded-lg text-xs font-semibold transition-all ${
              curStrategy === s.key ? 'bg-purple-600 text-white shadow-sm font-bold' : (isDark ? 'text-slate-400 hover:text-white' : 'text-slate-600 hover:text-slate-900')
            }">
            ${s.label}
          </button>
        `).join('')}
      </div>

      <!-- 1. 量化多因子体检核心综述卡片 -->
      <div class="p-4 rounded-2xl border relative overflow-hidden ${
        isDark ? 'bg-gradient-to-br from-purple-950/40 via-slate-900/90 to-indigo-950/40 border-purple-800/50 shadow-xl' : 'bg-gradient-to-br from-purple-50 via-white to-indigo-50 border-purple-200 shadow-xl'
      }">
        <div class="flex flex-wrap items-center justify-between gap-3 mb-3">
          <div class="flex items-center gap-3">
            <div class="w-12 h-12 rounded-2xl bg-gradient-to-tr from-purple-600 to-indigo-600 text-white flex flex-col items-center justify-center font-black shadow-lg">
              <span class="text-lg leading-none">${ai.total_score}</span>
              <span class="text-[9px] opacity-80 scale-90">量化分</span>
            </div>
            <div>
              <div class="flex items-center gap-2">
                <span class="font-extrabold text-base ${isDark ? 'text-white' : 'text-slate-900'}">${ai.name}</span>
                <span class="px-2.5 py-0.5 rounded-full text-xs font-bold text-white shadow-sm" style="background-color: ${ai.rating_color}">
                  ${ai.rating_tag}
                </span>
              </div>
              <div class="text-xs opacity-75 mt-0.5">${ai.rating_summary}</div>
            </div>
          </div>

          <div class="flex items-center gap-2">
            <button onclick="sendStockToDSHChat('${win.symbol}', '${win.name}', false, '${curStrategy}')" class="px-3 py-1.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-bold text-xs shadow-lg shadow-blue-500/25 flex items-center gap-1 transition-all hover:scale-105" title="将个股研报直接填入 DSH 对话框">
              <span>💬 填入聊天框</span>
            </button>
            <button onclick="sendStockToDSHChat('${win.symbol}', '${win.name}', true, '${curStrategy}')" class="px-3 py-1.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold text-xs shadow-lg shadow-emerald-500/25 flex items-center gap-1 transition-all hover:scale-105" title="填入并直接发送给 AI 提问">
              <span>⚡ 一键提问AI</span>
            </button>
            <button onclick="copyStockAIPrompt('${win.id}')" class="px-3 py-1.5 rounded-xl bg-purple-600/20 hover:bg-purple-600 text-purple-300 hover:text-white font-bold text-xs border border-purple-500/30 flex items-center gap-1 transition-all" title="复制全量数据包">
              <span>📋 复制</span>
            </button>
          </div>
        </div>

        <!-- 关键价位标签 -->
        <div class="grid grid-cols-3 gap-2 pt-2 border-t ${isDark ? 'border-purple-800/30' : 'border-purple-100'} font-mono text-xs">
          <div class="p-2 rounded-xl text-center ${isDark ? 'bg-slate-900/60' : 'bg-white/80'}">
            <span class="text-[11px] opacity-60 block mb-0.5">近20日关键支撑位</span>
            <span class="font-bold text-sm text-emerald-400">¥${ai.levels.support}</span>
          </div>
          <div class="p-2 rounded-xl text-center ${isDark ? 'bg-slate-900/60' : 'bg-white/80'}">
            <span class="text-[11px] opacity-60 block mb-0.5">近20日关键阻力位</span>
            <span class="font-bold text-sm text-red-500">¥${ai.levels.resistance}</span>
          </div>
          <div class="p-2 rounded-xl text-center ${isDark ? 'bg-slate-900/60' : 'bg-white/80'}">
            <span class="text-[11px] opacity-60 block mb-0.5">纪律止损参考位 (-6%)</span>
            <span class="font-bold text-sm text-amber-500">¥${ai.levels.stop_loss}</span>
          </div>
        </div>
      </div>

      <!-- 2. 五维量化规则因子能力条 -->
      <div class="p-4 rounded-xl border ${isDark ? 'bg-slate-900/80 border-slate-800' : 'bg-white border-slate-200'}">
        <div class="font-bold text-sm text-indigo-400 mb-3 flex items-center justify-between">
          <span>📊 五维量化规则因子得分</span>
          <span class="text-xs opacity-60 font-mono">技术/基本面/估值/成长/情绪规则模型</span>
        </div>

        <div class="space-y-2.5 text-xs">
          ${[
            { label: '📈 技术面动能 (均线/量价/动量)', val: ai.radar.technical, color: 'bg-blue-500' },
            { label: '🏢 基本面质量 (ROE/盈利韧性)', val: ai.radar.fundamental, color: 'bg-purple-500' },
            { label: '💰 估值性价比 (PE/PB/股息率)', val: ai.radar.valuation, color: 'bg-emerald-500' },
            { label: '🚀 业绩成长性 (营收/净利同比)', val: ai.radar.growth, color: 'bg-amber-500' },
            { label: '🔥 市场情绪活跃度 (换手/热点)', val: ai.radar.sentiment, color: 'bg-pink-500' }
          ].map(r => `
            <div>
              <div class="flex justify-between mb-1">
                <span class="font-semibold">${r.label}</span>
                <span class="font-mono font-bold">${r.val} 分</span>
              </div>
              <div class="w-full h-2 rounded-full ${isDark ? 'bg-slate-800' : 'bg-slate-100'} overflow-hidden">
                <div class="h-full rounded-full ${r.color} transition-all duration-500" style="width: ${r.val}%"></div>
              </div>
            </div>
          `).join('')}
        </div>
      </div>

      <!-- 3. 四大量化研判维度卡片 -->
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        ${ai.insights.map(item => `
          <div class="p-3.5 rounded-xl border ${isDark ? 'bg-slate-900/80 border-slate-800' : 'bg-white border-slate-200'} flex flex-col justify-between">
            <div class="font-bold text-sm text-slate-200 mb-1.5">${item.title}</div>
            <div class="text-xs opacity-85 leading-relaxed">${item.desc}</div>
          </div>
        `).join('')}
      </div>

      <!-- 4. 完整投研数据包与 AI 提示词 (可直接复制) -->
      <div class="p-4 rounded-xl border ${isDark ? 'bg-slate-900/80 border-slate-800' : 'bg-white border-slate-200'}">
        <div class="flex items-center justify-between mb-2">
          <div class="font-bold text-sm text-purple-400 flex items-center gap-1.5">
            <span>📝 完整投研数据包与 AI 提示词 (${curStrategy})</span>
          </div>
          <button onclick="copyStockAIPrompt('${win.id}')" class="px-3 py-1 rounded-lg bg-blue-600/20 hover:bg-blue-600 text-blue-400 hover:text-white font-bold text-xs transition-all">
            📋 复制数据包
          </button>
        </div>
        <textarea id="ai-prompt-text-${win.id}" readonly
          class="w-full h-40 p-3 rounded-xl font-mono text-xs border focus:outline-none resize-none select-all ${
            isDark ? 'bg-slate-950 border-slate-800 text-slate-300' : 'bg-slate-50 border-slate-300 text-slate-800'
          }">${promptContent}</textarea>
        <div class="text-[11px] opacity-60 mt-1.5">💡 提示：点击复制后，直接粘贴给 DeepSeek, ChatGPT, Claude, 豆包等任意真实 AI 大模型，即可获得针对该股的超深度定制投研互动！</div>
      </div>
    `;
  } catch (e) {
    container.innerHTML = `<div class="p-8 text-center text-sm text-red-400">加载量化诊断失败: ${e.message}</div>`;
  }
}

// 在 DSH 宿主中自动新建智能会话并调度 investment-research 技能
async function createDSHAgentSession(symbol, name) {
  const dshProps = window.__DSH_PROPS__;
  const conn = dshProps?.connection;
  const api = conn?.api;
  const sessionsSvc = dshProps?.sessionsService;

  if (!api || !sessionsSvc) {
    // 独立运行模式回退：自动复制 Prompt
    const win = floatingWindows.find(w => w.symbol === symbol);
    if (win) copyStockAIPrompt(win.id);
    alert(`💡 当前处于【独立浏览器运行模式】\n\n已为你一键打包【${name}】的全景投研数据包到剪贴板！可以直接粘贴给 DeepSeek 或任意 AI。\n\n（在 DSH 宿主环境启动时，此按钮会自动在 DSH 中创建新会话并调度 investment-research 投研技能！）`);
    return;
  }

  try {
    const curId = dshProps.sessions?.current;
    const workspaces = dshProps.workspaces;
    const ws = (workspaces && Array.isArray(workspaces.items))
      ? workspaces.items.find(w => curId && Array.isArray(w.sessionIds) && w.sessionIds.includes(curId))
      : null;
    
    let createPayload = {};
    if (ws && ws.workspaceId) createPayload = { workspaceId: ws.workspaceId };

    const created = await api.sessions.create(createPayload);
    const sessionId = created?.result?.value?.sessionId;
    if (!sessionId) throw new Error('DSH 会话创建失败');

    await api.sessions.prompt({
      sessionId,
      mode: 'queue',
      content: [{ type: 'text', text: `分析${name}（${symbol}）` }]
    });

    sessionsSvc.open(sessionId);
  } catch (err) {
    alert(`创建 DSH 对话失败: ${err.message}`);
  }
}

// 一键复制股票 AI 提示词与数据报告到剪贴板
async function copyStockAIPrompt(winId) {
  const textarea = document.getElementById(`ai-prompt-text-${winId}`);
  if (!textarea) return;

  try {
    await navigator.clipboard.writeText(textarea.value);
    showToast('✅ 提示词已成功复制到剪贴板！');
  } catch (err) {
    textarea.select();
    document.execCommand('copy');
    showToast('✅ 提示词已选中并复制！');
  }
}

// 一键将股票全景数据与投研提问填入 DSH 聊天窗口或直接提问
async function sendStockToDSHChat(symbol, name, autoSend = false, strategy = 'general') {
  // 1. 获取最新盘口与量化分析数据
  const quote = watchlist.find(w => w.symbol.toLowerCase() === symbol.toLowerCase()) || {};
  let aiData = null;
  try {
    aiData = await fetchCachedAIAnalysis(symbol);
  } catch (_) {}

  let newsList = [];
  try {
    const nData = await fetchCachedNews(symbol, name);
    newsList = nData?.news || [];
  } catch (_) {}

  // 2. 构造高质量的策略投研提示词
  const promptText = buildStrategyPrompt(symbol, name, aiData, quote, newsList, strategy);

  // 3. 寻找 DSH 页面中的主聊天输入框
  const textareas = Array.from(document.querySelectorAll('textarea:not([readonly])'));
  // 排除插件内部的 textarea
  const targetTextarea = textareas.find(el => !el.id.startsWith('ai-prompt-text'));
  const contentEditable = document.querySelector('div[contenteditable="true"]');

  let injected = false;

  if (targetTextarea) {
    targetTextarea.focus();
    // 使用 React/原生通用的属性赋值触发 setter
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
    if (nativeSetter) {
      nativeSetter.call(targetTextarea, promptText);
    } else {
      targetTextarea.value = promptText;
    }
    targetTextarea.dispatchEvent(new Event('input', { bubbles: true }));
    targetTextarea.dispatchEvent(new Event('change', { bubbles: true }));
    injected = true;

    if (autoSend) {
      setTimeout(() => {
        const sendBtn = document.querySelector('button[type="submit"], button[aria-label*="发送"], button[aria-label*="Send"], button.send-btn, button[title*="发送"]');
        if (sendBtn && !sendBtn.disabled) {
          sendBtn.click();
        } else {
          targetTextarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
        }
      }, 150);
    }
  } else if (contentEditable) {
    contentEditable.focus();
    contentEditable.innerText = promptText;
    contentEditable.dispatchEvent(new Event('input', { bubbles: true }));
    injected = true;

    if (autoSend) {
      setTimeout(() => {
        const sendBtn = document.querySelector('button[type="submit"], button[aria-label*="发送"], button[aria-label*="Send"]');
        if (sendBtn && !sendBtn.disabled) sendBtn.click();
      }, 150);
    }
  }

  // 4. 同时备份到剪贴板，并弹出友好 Toast
  try {
    await navigator.clipboard.writeText(promptText);
  } catch (_) {}

  showToast(injected 
    ? (autoSend ? `⚡ 已将【${name}】投研分析发送至 DSH 对话！` : `💬 已将【${name}】投研分析填入 DSH 聊天框，可直接与 AI 深入交流！`)
    : `📋 已将【${name}】全量投研数据包复制到剪贴板，请直接粘贴至聊天框！`
  );
}

// 统一气泡提示
function showToast(msg) {
  let toast = document.getElementById('omni-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'omni-toast';
    toast.style.cssText = 'position:fixed; bottom:30px; left:50%; transform:translateX(-50%); z-index:999999; transition:all 0.3s cubic-bezier(0.4, 0, 0.2, 1); pointer-events:none;';
    document.body.appendChild(toast);
  }
  const isDark = theme === 'dark';
  toast.innerHTML = `
    <div class="px-5 py-3 rounded-2xl shadow-2xl border text-sm font-bold flex items-center gap-2.5 backdrop-blur-2xl ${
      isDark ? 'bg-slate-900/95 border-blue-500/50 text-white shadow-black/80 ring-1 ring-blue-500/20' : 'bg-white/95 border-blue-400 text-slate-800 shadow-slate-300'
    }">
      <span>✨</span>
      <span>${msg}</span>
    </div>
  `;
  toast.style.opacity = '1';
  toast.style.transform = 'translateX(-50%) translateY(0)';

  clearTimeout(window.__OMNI_TOAST_TIMER__);
  window.__OMNI_TOAST_TIMER__ = setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(-50%) translateY(10px)';
  }, 2800);
}

// 渲染 ECharts 完整技术图表
async function renderChart(win) {
  const f10Container = document.getElementById(`f10-container-${win.id}`);
  const newsContainer = document.getElementById(`news-container-${win.id}`);
  const aiContainer = document.getElementById(`ai-container-${win.id}`);
  const chartDom = document.getElementById(`chart-${win.id}`);
  if (!chartDom) return;

  if (f10Container) f10Container.classList.add('hidden');
  if (newsContainer) newsContainer.classList.add('hidden');
  if (aiContainer) aiContainer.classList.add('hidden');
  chartDom.classList.remove('hidden');

  if (win.chartInstance) {
    try {
      const oldDom = win.chartInstance.getDom();
      if (!document.contains(oldDom) || oldDom !== chartDom) {
        win.chartInstance.dispose();
        win.chartInstance = echarts.init(chartDom);
      }
    } catch (_) {
      win.chartInstance = echarts.init(chartDom);
    }
  } else {
    win.chartInstance = echarts.init(chartDom);
  }

  const isDark = theme === 'dark';
  const axisColor = isDark ? '#334155' : '#cbd5e1';
  const labelColor = isDark ? '#94a3b8' : '#64748b';
  const titleColor = isDark ? '#e2e8f0' : '#1e293b';
  const gridLineColor = isDark ? '#1e293b' : '#f1f5f9';

  const periodNames = {
    intraday: '分时',
    '5day': '5日分时',
    daily: '日K',
    weekly: '周K',
    monthly: '月K',
    '5m': '5分钟',
    '15m': '15分钟',
    '30m': '30分钟',
    '60m': '60分钟'
  };
  const pLabel = periodNames[win.period] || win.period;

  // 1. 切换时立即清空旧图表并展示加载中状态，防止残留上一个周期的图表
  win.chartInstance.clear();
  win.chartInstance.showLoading({
    text: `正在查询【${win.name}】${pLabel}行情数据...`,
    color: '#3b82f6',
    textColor: labelColor,
    maskColor: isDark ? 'rgba(15, 23, 42, 0.9)' : 'rgba(255, 255, 255, 0.9)',
    fontSize: 13
  });

  try {
    const bars = await fetchCachedKline(win.symbol, win.period);
    win.chartInstance.hideLoading();
    
    if (!bars || bars.length === 0) {
      win.chartInstance.clear();
      win.chartInstance.setOption({
        backgroundColor: 'transparent',
        title: {
          text: `未获取到【${win.name}】${pLabel}时序数据`,
          subtext: `该标的/指数暂无【${pLabel}】行情源，请切换至【分时】或【日K】查看`,
          left: 'center',
          top: 'center',
          textStyle: { color: isDark ? '#94a3b8' : '#64748b', fontSize: 14, fontWeight: 'bold' },
          subtextStyle: { color: isDark ? '#64748b' : '#94a3b8', fontSize: 12 }
        }
      }, true);
      return;
    }

    if (win.period === 'intraday' || win.period === '5day') {
      const isIndex = win.market === 'INDEX' || win.market === 'GLOBAL' || win.symbol.toLowerCase().startsWith('sh000') || win.symbol.toLowerCase().startsWith('sz399') || win.symbol.toLowerCase().startsWith('us') || win.symbol.toLowerCase().startsWith('int_');
      const times = bars.map(p => {
        if (win.period === '5day') {
          return p.time.length > 10 ? p.time.slice(5) : p.time;
        }
        return p.time.includes(' ') ? p.time.split(' ')[1] : p.time;
      });
      const prices = bars.map(p => p.close);
      const avgPrices = bars.map(p => p.avg_price || p.close);
      const volumes = bars.map(p => p.volume);

      win.chartInstance.hideLoading();
      win.chartInstance.setOption({
        backgroundColor: 'transparent',
        animation: false,
        tooltip: { 
          trigger: 'axis', 
          axisPointer: { type: 'cross' },
          formatter: (params) => {
            let res = `<div class="font-mono text-sm font-bold mb-1">${params[0]?.axisValue || ''}</div>`;
            params.forEach(p => {
              res += `<div class="text-xs flex items-center justify-between gap-4 py-0.5">
                <span style="color:${p.color}">● ${p.seriesName}:</span>
                <span class="font-mono font-bold">${p.value}</span>
              </div>`;
            });
            return res;
          }
        },
        grid: [
          { left: '9%', right: '3%', top: '7%', height: '62%' },
          { left: '9%', right: '3%', top: '74%', height: '20%' }
        ],
        xAxis: [
          { type: 'category', data: times, gridIndex: 0, axisLine: { lineStyle: { color: axisColor } }, axisLabel: { color: labelColor, fontSize: 11 } },
          { type: 'category', data: times, gridIndex: 1, axisLine: { lineStyle: { color: axisColor } }, axisLabel: { show: false } }
        ],
        yAxis: [
          { 
            type: 'value', 
            gridIndex: 0, 
            scale: true, 
            min: (val) => {
              const span = val.max - val.min;
              const pad = span > 0 ? span * 0.08 : (val.min ? val.min * 0.02 : 1);
              return +(val.min - pad).toFixed(2);
            },
            max: (val) => {
              const span = val.max - val.min;
              const pad = span > 0 ? span * 0.08 : (val.max ? val.max * 0.02 : 1);
              return +(val.max + pad).toFixed(2);
            },
            splitLine: { lineStyle: { color: gridLineColor } }, 
            axisLabel: { color: labelColor, fontSize: 11 } 
          },
          { type: 'value', gridIndex: 1, splitLine: { lineStyle: { color: gridLineColor } }, axisLabel: { show: false } }
        ],
        dataZoom: [{ type: 'inside', xAxisIndex: [0, 1], start: 0, end: 100 }],
        series: [
          { name: '现价', type: 'line', data: prices, smooth: true, showSymbol: false, lineStyle: { color: '#3b82f6', width: 2.2 } },
          ...(!isIndex ? [{ name: '分时均价', type: 'line', data: avgPrices, smooth: true, showSymbol: false, lineStyle: { color: '#f59e0b', width: 1.6, type: 'solid' } }] : []),
          { name: '成交量', type: 'bar', xAxisIndex: 1, yAxisIndex: 1, data: volumes, itemStyle: { color: '#64748b' } }
        ]
      }, true);
    } else {
      const ind = calculateIndicators(bars);
      const activeSubs = win.subIndicators;
      const subCount = activeSubs.length;
      const totalPanes = 1 + subCount;

      let grids = [], titles = [];
      const subTitleMap = { 
        VOL: '【VOL 成交量】', 
        MACD: '【MACD 异同均线】', 
        RSI: '【RSI 相对强弱】', 
        KDJ: '【KDJ 随机指标】' 
      };

      if (subCount === 0) {
        grids.push({ left: '9%', right: '3%', top: '5%', height: '90%' });
        titles.push({ text: 'K线主图', left: '9%', top: '0.8%', textStyle: { color: titleColor, fontSize: 13.5, fontWeight: 'bold' } });
      } else {
        const mainHeight = subCount === 1 ? 52 : (subCount === 2 ? 38 : (subCount === 3 ? 28 : 24));
        grids.push({ left: '9%', right: '3%', top: '4.5%', height: `${mainHeight}%` });
        titles.push({ text: 'K线主图', left: '9%', top: '0.6%', textStyle: { color: titleColor, fontSize: 13, fontWeight: 'bold' } });

        const remainingHeight = 89 - mainHeight - (subCount * 3.2);
        const subHeight = Math.max(13, Math.floor(remainingHeight / subCount));

        activeSubs.forEach((subKey, i) => {
          const topPercent = mainHeight + 7.8 + i * (subHeight + 3.2);
          grids.push({
            left: '9%',
            right: '3%',
            top: `${topPercent}%`,
            height: `${subHeight}%`
          });
          titles.push({
            text: subTitleMap[subKey] || `【${subKey}】`,
            left: '9%',
            top: `${topPercent - 2.8}%`,
            textStyle: { color: titleColor, fontSize: 11.5, fontWeight: 'bold' }
          });
        });
      }

      const xAxes = [], yAxes = [];
      for (let i = 0; i < totalPanes; i++) {
        xAxes.push({
          type: 'category', 
          data: ind.dates, 
          gridIndex: i,
          axisLine: { lineStyle: { color: axisColor } },
          axisLabel: { show: i === totalPanes - 1, color: labelColor, fontSize: 11 }
        });
        yAxes.push({
          type: 'value', 
          gridIndex: i, 
          scale: true,
          min: i === 0 ? (val) => {
            const span = val.max - val.min;
            const pad = span > 0 ? span * 0.06 : (val.min ? val.min * 0.02 : 1);
            return +(val.min - pad).toFixed(2);
          } : undefined,
          max: i === 0 ? (val) => {
            const span = val.max - val.min;
            const pad = span > 0 ? span * 0.06 : (val.max ? val.max * 0.02 : 1);
            return +(val.max + pad).toFixed(2);
          } : undefined,
          splitLine: { lineStyle: { color: gridLineColor } },
          axisLabel: { color: labelColor, fontSize: 11 }
        });
      }

      const upColor = getTrendColor(true);
      const downColor = getTrendColor(false);

      const seriesList = [
        {
          name: 'K线', 
          type: 'candlestick', 
          data: ind.kValues, 
          gridIndex: 0,
          itemStyle: { color: upColor, color0: downColor, borderColor: upColor, borderColor0: downColor }
        }
      ];

      // 主图技术指标
      if (win.mainIndicators.includes('MA')) {
        seriesList.push(
          { name: 'MA5', type: 'line', data: ind.ma5, smooth: true, showSymbol: false, lineStyle: { color: '#f59e0b', width: 1.6 } },
          { name: 'MA10', type: 'line', data: ind.ma10, smooth: true, showSymbol: false, lineStyle: { color: '#06b6d4', width: 1.6 } },
          { name: 'MA20', type: 'line', data: ind.ma20, smooth: true, showSymbol: false, lineStyle: { color: '#8b5cf6', width: 1.6 } },
          { name: 'MA60', type: 'line', data: ind.ma60, smooth: true, showSymbol: false, lineStyle: { color: '#ec4899', width: 1.6 } }
        );
      }
      if (win.mainIndicators.includes('BOLL')) {
        seriesList.push(
          { name: 'UP', type: 'line', data: ind.bollUpper, smooth: true, showSymbol: false, lineStyle: { color: '#f59e0b', width: 1.6 } },
          { name: 'MID', type: 'line', data: ind.bollMid, smooth: true, showSymbol: false, lineStyle: { color: '#3b82f6', width: 1.6 } },
          { name: 'DN', type: 'line', data: ind.bollLower, smooth: true, showSymbol: false, lineStyle: { color: '#06b6d4', width: 1.6 } }
        );
      }
      if (win.mainIndicators.includes('EMA')) {
        seriesList.push(
          { name: 'EMA12', type: 'line', data: ind.ema12, smooth: true, showSymbol: false, lineStyle: { color: '#f59e0b', width: 1.6 } },
          { name: 'EMA26', type: 'line', data: ind.ema26, smooth: true, showSymbol: false, lineStyle: { color: '#8b5cf6', width: 1.6 } }
        );
      }

      // 副图技术指标
      activeSubs.forEach((sub, idx) => {
        const gIdx = idx + 1;
        if (sub === 'VOL') {
          seriesList.push(
            { name: '成交量', type: 'bar', xAxisIndex: gIdx, yAxisIndex: gIdx, data: ind.volumes, itemStyle: { color: '#64748b' } },
            { name: 'MA_VOL5', type: 'line', xAxisIndex: gIdx, yAxisIndex: gIdx, data: ind.volMa5, smooth: true, showSymbol: false, lineStyle: { color: '#f59e0b', width: 1.3 } },
            { name: 'MA_VOL10', type: 'line', xAxisIndex: gIdx, yAxisIndex: gIdx, data: ind.volMa10, smooth: true, showSymbol: false, lineStyle: { color: '#06b6d4', width: 1.3 } }
          );
        } else if (sub === 'MACD') {
          seriesList.push(
            { name: 'MACD', type: 'bar', xAxisIndex: gIdx, yAxisIndex: gIdx, data: ind.macdBar.map(v => ({ value: v, itemStyle: { color: v >= 0 ? upColor : downColor } })) },
            { name: 'DIF', type: 'line', xAxisIndex: gIdx, yAxisIndex: gIdx, data: ind.dif, smooth: true, showSymbol: false, lineStyle: { color: '#f59e0b', width: 1.6 } },
            { name: 'DEA', type: 'line', xAxisIndex: gIdx, yAxisIndex: gIdx, data: ind.dea, smooth: true, showSymbol: false, lineStyle: { color: '#3b82f6', width: 1.6 } }
          );
        } else if (sub === 'RSI') {
          seriesList.push(
            { name: 'RSI6', type: 'line', xAxisIndex: gIdx, yAxisIndex: gIdx, data: ind.rsi6, smooth: true, showSymbol: false, lineStyle: { color: '#f59e0b', width: 1.6 } },
            { name: 'RSI12', type: 'line', xAxisIndex: gIdx, yAxisIndex: gIdx, data: ind.rsi12, smooth: true, showSymbol: false, lineStyle: { color: '#3b82f6', width: 1.6 } },
            { name: 'RSI24', type: 'line', xAxisIndex: gIdx, yAxisIndex: gIdx, data: ind.rsi24, smooth: true, showSymbol: false, lineStyle: { color: '#8b5cf6', width: 1.6 } }
          );
        } else if (sub === 'KDJ') {
          seriesList.push(
            { name: 'K', type: 'line', xAxisIndex: gIdx, yAxisIndex: gIdx, data: ind.kdjK, smooth: true, showSymbol: false, lineStyle: { color: '#f59e0b', width: 1.6 } },
            { name: 'D', type: 'line', xAxisIndex: gIdx, yAxisIndex: gIdx, data: ind.kdjD, smooth: true, showSymbol: false, lineStyle: { color: '#3b82f6', width: 1.6 } },
            { name: 'J', type: 'line', xAxisIndex: gIdx, yAxisIndex: gIdx, data: ind.kdjJ, smooth: true, showSymbol: false, lineStyle: { color: '#ec4899', width: 1.6 } }
          );
        }
      });

      win.chartInstance.hideLoading();
      win.chartInstance.setOption({
        backgroundColor: 'transparent',
        animation: false,
        title: titles,
        axisPointer: { link: [{ xAxisIndex: 'all' }] },
        tooltip: { trigger: 'axis', axisPointer: { type: 'cross' } },
        grid: grids,
        xAxis: xAxes,
        yAxis: yAxes,
        dataZoom: [{ 
          type: 'inside', 
          xAxisIndex: Array.from({ length: totalPanes }, (_, i) => i), 
          start: 35, 
          end: 100 
        }],
        series: seriesList
      }, true);

      // 默认呈现最新一根指标数据
      updateChartHUD(win, bars, ind, bars.length - 1);

      // 绑定十字光标 HUD 动态联动事件
      win.chartInstance.off('updateAxisPointer');
      win.chartInstance.on('updateAxisPointer', (event) => {
        const dataIndex = event.dataInfo?.dataIndex ?? event.dataIndex;
        if (dataIndex !== undefined && dataIndex >= 0 && dataIndex < bars.length) {
          updateChartHUD(win, bars, ind, dataIndex);
        }
      });

      const zr = win.chartInstance.getZr();
      zr.off('mousemove');
      zr.on('mousemove', (params) => {
        const pointInPixel = [params.offsetX, params.offsetY];
        if (win.chartInstance.containPixel({ gridIndex: 0 }, pointInPixel)) {
          const pointInGrid = win.chartInstance.convertFromPixel({ seriesIndex: 0 }, pointInPixel);
          const xIndex = pointInGrid ? Math.round(pointInGrid[0]) : -1;
          if (xIndex >= 0 && xIndex < bars.length) {
            updateChartHUD(win, bars, ind, xIndex);
          }
        }
      });

      zr.off('globalout');
      zr.on('globalout', () => {
        if (bars && bars.length > 0) {
          updateChartHUD(win, bars, ind, bars.length - 1);
        }
      });
    }

    if (win.period === 'intraday' || win.period === '5day') {
      updateChartHUD(win, bars, null, bars.length - 1);

      win.chartInstance.off('updateAxisPointer');
      win.chartInstance.on('updateAxisPointer', (event) => {
        const dataIndex = event.dataInfo?.dataIndex ?? event.dataIndex;
        if (dataIndex !== undefined && dataIndex >= 0 && dataIndex < bars.length) {
          updateChartHUD(win, bars, null, dataIndex);
        }
      });

      const zr = win.chartInstance.getZr();
      zr.off('mousemove');
      zr.on('mousemove', (params) => {
        const pointInPixel = [params.offsetX, params.offsetY];
        if (win.chartInstance.containPixel({ gridIndex: 0 }, pointInPixel)) {
          const pointInGrid = win.chartInstance.convertFromPixel({ seriesIndex: 0 }, pointInPixel);
          const xIndex = pointInGrid ? Math.round(pointInGrid[0]) : -1;
          if (xIndex >= 0 && xIndex < bars.length) {
            updateChartHUD(win, bars, null, xIndex);
          }
        }
      });

      zr.off('globalout');
      zr.on('globalout', () => {
        if (bars && bars.length > 0) {
          updateChartHUD(win, bars, null, bars.length - 1);
        }
      });
    }
  } catch (err) {
    console.error('Render chart error:', err);
    win.chartInstance.hideLoading();
  }
}

// 实时 HUD 数据状态栏动态更新函数
function updateChartHUD(win, bars, ind, idx) {
  const hudEl = document.getElementById(`hud-bar-${win.id}`);
  if (!hudEl || !bars || bars.length === 0 || idx < 0 || idx >= bars.length) return;
  const bar = bars[idx];

  if (win.period === 'intraday' || win.period === '5day') {
    const isUp = (bar.change || (bar.close - (bars[0]?.open || bar.close))) >= 0;
    const pColor = getTrendTextClass(isUp);
    const timeStr = bar.time;
    const volStr = bar.volume ? (bar.volume >= 10000 ? (bar.volume / 10000).toFixed(1) + '万' : bar.volume) : '--';
    const sign = (bar.change_pct || 0) >= 0 ? '+' : '';

    hudEl.innerHTML = `
      <div class="flex items-center gap-3 truncate w-full">
        <span class="opacity-70 font-semibold">${win.period === '5day' ? '📅' : '⏱️'} ${timeStr}</span>
        <span>现价: <b class="${pColor}">¥${bar.close.toFixed(2)}</b></span>
        <span>均价: <b class="text-amber-500 font-semibold">¥${bar.avg_price ? bar.avg_price.toFixed(2) : bar.close.toFixed(2)}</b></span>
        <span>涨跌: <b class="${pColor}">${sign}${(bar.change_pct || 0).toFixed(2)}%</b></span>
        <span class="opacity-80">成交量: <b>${volStr}</b></span>
      </div>
    `;
    return;
  }

  // K线周期
  const isUp = bar.close >= bar.open;
  const pColor = getTrendTextClass(isUp);
  const prevClose = idx > 0 ? bars[idx - 1].close : bar.open;
  const pct = prevClose > 0 ? ((bar.close - prevClose) / prevClose) * 100 : 0;
  const sign = pct >= 0 ? '+' : '';
  const dateStr = bar.time.includes(' ') ? bar.time.split(' ')[0] : bar.time;
  const volStr = bar.volume ? (bar.volume >= 10000 ? (bar.volume / 10000).toFixed(1) + '万' : bar.volume) : '--';

  let indParts = [];
  if (win.mainIndicators && win.mainIndicators.includes('MA') && ind) {
    if (ind.ma5?.[idx]) indParts.push(`<span class="text-amber-400">MA5:${ind.ma5[idx].toFixed(2)}</span>`);
    if (ind.ma10?.[idx]) indParts.push(`<span class="text-cyan-400">MA10:${ind.ma10[idx].toFixed(2)}</span>`);
    if (ind.ma20?.[idx]) indParts.push(`<span class="text-purple-400">MA20:${ind.ma20[idx].toFixed(2)}</span>`);
  }
  if (win.mainIndicators && win.mainIndicators.includes('BOLL') && ind) {
    if (ind.bollMid?.[idx]) indParts.push(`<span class="text-blue-400">MID:${ind.bollMid[idx].toFixed(2)}</span>`);
  }
  if (win.subIndicators && win.subIndicators.includes('MACD') && ind && ind.dif?.[idx] !== undefined) {
    const macdVal = ind.macdBar?.[idx] || 0;
    indParts.push(`<span class="${getTrendTextClass(macdVal >= 0)}">MACD:${macdVal.toFixed(2)}</span>`);
  }
  if (win.subIndicators && win.subIndicators.includes('KDJ') && ind && ind.kdjK?.[idx] !== undefined) {
    indParts.push(`<span class="text-amber-400">K:${ind.kdjK[idx].toFixed(1)}</span>`);
  }
  if (win.subIndicators && win.subIndicators.includes('RSI') && ind && ind.rsi6?.[idx] !== undefined) {
    indParts.push(`<span class="text-cyan-400">RSI6:${ind.rsi6[idx].toFixed(1)}</span>`);
  }

  hudEl.innerHTML = `
    <div class="flex items-center gap-2 truncate w-full">
      <span class="opacity-70 font-semibold">${dateStr}</span>
      <span>开:<b class="${bar.open >= prevClose ? getTrendTextClass(true) : getTrendTextClass(false)}">${bar.open.toFixed(2)}</b></span>
      <span>高:<b class="${getTrendTextClass(true)}">${bar.high.toFixed(2)}</b></span>
      <span>低:<b class="${getTrendTextClass(false)}">${bar.low.toFixed(2)}</b></span>
      <span>收:<b class="${pColor}">${bar.close.toFixed(2)}</b></span>
      <span class="${pColor} font-bold">(${sign}${pct.toFixed(2)}%)</span>
      <span class="opacity-80">量:<b>${volStr}</b></span>
      ${indParts.length > 0 ? `<span class="opacity-30">|</span> ${indParts.join(' ')}` : ''}
    </div>
  `;
}

// 走势图窗口控制
function openChart(symbol, name, market) {
  const existing = floatingWindows.find(w => w.symbol.toLowerCase() === symbol.toLowerCase());
  if (existing) {
    if (existing.isMinimized) {
      existing.isMinimized = false;
      const winEl = document.getElementById(existing.id);
      if (winEl) winEl.outerHTML = renderSingleWindowHtml(existing);
      bindSingleWindowEvents(existing);
    }
    focusWindow(existing.id);
    updateFooterManager();
    return;
  }

  topZIndex++;
  const offset = (floatingWindows.length % 5) * 28;
  const newWin = {
    id: `win_${symbol}_${Date.now()}`,
    symbol,
    name,
    market: market || 'A',
    period: 'intraday',
    mainIndicators: ['MA'],
    subIndicators: ['VOL', 'MACD', 'RSI', 'KDJ'],
    x: 40 + offset,
    y: 15 + offset,
    width: Math.min(720, window.innerWidth - 40),
    height: Math.min(940, window.innerHeight - 30),
    zIndex: topZIndex,
    isMinimized: false,
    isMaximized: false
  };

  floatingWindows.push(newWin);

  const container = document.getElementById('floating-windows-container');
  if (container) {
    container.insertAdjacentHTML('beforeend', renderSingleWindowHtml(newWin));
    bindSingleWindowEvents(newWin);
  }
  updateFooterManager();
}

function openBatchTiled() {
  const top4 = watchlist.slice(0, 4);
  top4.forEach((item) => {
    openChart(item.symbol, item.name, item.market);
  });
  applyWindowLayout('tile_auto');
}

function closeWindow(id) {
  const win = floatingWindows.find(w => w.id === id);
  if (win && win.chartInstance) win.chartInstance.dispose();
  floatingWindows = floatingWindows.filter(w => w.id !== id);
  const winEl = document.getElementById(id);
  if (winEl) winEl.remove();
  updateFooterManager();
}

function focusWindow(id) {
  topZIndex++;
  const win = floatingWindows.find(w => w.id === id);
  if (win) win.zIndex = topZIndex;
  const winEl = document.getElementById(id);
  if (winEl) winEl.style.zIndex = topZIndex;
}

function toggleMinimizeWindow(id) {
  const win = floatingWindows.find(w => w.id === id);
  if (win) {
    win.isMinimized = !win.isMinimized;
    const winEl = document.getElementById(id);
    if (winEl) {
      winEl.outerHTML = renderSingleWindowHtml(win);
      bindSingleWindowEvents(win);
    }
    updateFooterManager();
  }
}

function toggleMaximizeWindow(id) {
  const win = floatingWindows.find(w => w.id === id);
  if (win) {
    win.isMaximized = !win.isMaximized;
    if (win.isMaximized) {
      win.prevX = win.x; win.prevY = win.y; win.prevW = win.width; win.prevH = win.height;
      win.x = 20; win.y = 20; win.width = window.innerWidth - 40; win.height = window.innerHeight - 40;
    } else {
      win.x = win.prevX || 40; win.y = win.prevY || 15; win.width = win.prevW || 720; win.height = win.prevH || 940;
    }
    const winEl = document.getElementById(id);
    if (winEl) {
      winEl.style.left = `${win.x}px`;
      winEl.style.top = `${win.y}px`;
      winEl.style.width = `${win.width}px`;
      winEl.style.height = `${win.height}px`;
    }
    setTimeout(() => {
      if (win.chartInstance) win.chartInstance.resize();
    }, 50);
  }
}

// 切换周期 (含 F10 / 资讯 / AI分析 / 资金流向 / 交易笔记)
function setWindowPeriod(id, period) {
  const win = floatingWindows.find(w => w.id === id);
  if (!win) return;
  win.period = period;

  // 1. 仅局部刷新当前窗口的控制栏
  const controlsBar = document.getElementById(`controls-bar-${win.id}`);
  if (controlsBar) controlsBar.innerHTML = renderWindowControlsHtml(win);

  // 2. 根据所选 Tab 仅更新当前窗口的内容区
  if (period === 'f10') {
    renderF10(win);
  } else if (period === 'news') {
    renderNews(win);
  } else if (period === 'ai') {
    renderAIAnalysis(win);
  } else if (period === 'fundflow') {
    renderFundFlow(win);
  } else if (period === 'notes') {
    renderNotes(win);
  } else {
    renderChart(win);
  }
}

// 切换指标
function toggleIndicator(id, name, type) {
  const win = floatingWindows.find(w => w.id === id);
  if (!win) return;
  if (type === 'main') {
    if (win.mainIndicators.includes(name)) win.mainIndicators = win.mainIndicators.filter(x => x !== name);
    else win.mainIndicators.push(name);
  } else {
    if (win.subIndicators.includes(name)) win.subIndicators = win.subIndicators.filter(x => x !== name);
    else win.subIndicators.push(name);
  }

  const controlsBar = document.getElementById(`controls-bar-${win.id}`);
  if (controlsBar) controlsBar.innerHTML = renderWindowControlsHtml(win);
  renderChart(win);
}

function applyWindowLayout(mode) {
  currentLayout = mode;
  const padding = 12, topOffset = 20;
  const availW = window.innerWidth - (isDrawerOpen ? 420 : 80);
  const availH = window.innerHeight - topOffset - padding * 2;
  const activeWins = floatingWindows.filter(w => !w.isMinimized);

  if (mode === 'split_2') {
    const w = Math.floor((availW - padding) / 2);
    activeWins.forEach((win, i) => {
      win.x = padding + (i % 2) * (w + padding);
      win.y = topOffset + padding;
      win.width = w; win.height = availH;
    });
  } else if (mode === 'grid_4') {
    const w = Math.floor((availW - padding) / 2);
    const h = Math.floor((availH - padding) / 2);
    activeWins.forEach((win, i) => {
      win.x = padding + (i % 2) * (w + padding);
      win.y = topOffset + padding + Math.floor((i % 4) / 2) * (h + padding);
      win.width = w; win.height = h;
    });
  } else if (mode === 'tile_auto') {
    // 默认竖列排列（纵向通顶长条、横向并排）：股票盘口与技术指标自上而下阅读，竖向占满全屏高，横向平分宽度
    const count = activeWins.length || 1;
    // 优先单行全高竖列铺开；若窗口过多且单列过窄 (<260px) 则自适应换行
    let cols = count;
    let rows = 1;
    if (count > 2 && Math.floor((availW - padding * (count - 1)) / count) < 260) {
      cols = Math.ceil(count / 2);
      rows = 2;
    }
    const w = Math.floor((availW - padding * (cols - 1)) / cols);
    const h = rows === 1 ? availH : Math.floor((availH - padding * (rows - 1)) / rows);
    activeWins.forEach((win, i) => {
      win.x = padding + (i % cols) * (w + padding);
      win.y = topOffset + padding + Math.floor(i / cols) * (h + padding);
      win.width = w;
      win.height = h;
    });
  } else if (mode === 'cascade') {
    activeWins.forEach((win, i) => {
      win.x = 40 + (i % 5) * 28;
      win.y = 15 + (i % 5) * 28;
      win.width = 720; win.height = 940;
    });
  }

  activeWins.forEach(win => {
    const winEl = document.getElementById(win.id);
    if (winEl) {
      winEl.style.left = `${win.x}px`;
      winEl.style.top = `${win.y}px`;
      winEl.style.width = `${win.width}px`;
      winEl.style.height = `${win.height}px`;
    }
  });
  updateFooterManager();
  setTimeout(() => {
    activeWins.forEach(win => {
      if (win.chartInstance) win.chartInstance.resize();
    });
  }, 50);
}

function minimizeAllWindows() {
  floatingWindows.forEach(w => {
    if (!w.isMinimized) toggleMinimizeWindow(w.id);
  });
}

function restoreAllWindows() {
  floatingWindows.forEach(w => {
    if (w.isMinimized) toggleMinimizeWindow(w.id);
  });
}

function closeAllWindows() {
  floatingWindows.forEach(w => {
    if (w.chartInstance) w.chartInstance.dispose();
    const winEl = document.getElementById(w.id);
    if (winEl) winEl.remove();
  });
  floatingWindows = [];
  updateFooterManager();
}

async function addToWatchlist(symbol, name, market) {
  await fetch('/dsh-plugin-stock-x/watchlist', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ symbol, name, market })
  });
  await refreshData();
  updateWatchlistDOM();
  const badge = document.getElementById('watchlist-count-badge');
  if (badge) badge.textContent = `${watchlist.length} 只`;
}

async function removeFromWatchlist(symbol) {
  await fetch(`/dsh-plugin-stock-x/watchlist/${symbol}`, { method: 'DELETE' });
  await refreshData();
  updateWatchlistDOM();
  const badge = document.getElementById('watchlist-count-badge');
  if (badge) badge.textContent = `${watchlist.length} 只`;
}

function clearSearch() {
  const input = document.getElementById('search-input');
  if (input) input.value = '';
  const dropdown = document.getElementById('search-dropdown');
  if (dropdown) dropdown.classList.add('hidden');
}

// 确保在模块闭包或全局运行环境中，所有 HTML 内联事件与业务函数均能正常调用
if (typeof window !== 'undefined') {
  Object.assign(window, {
    fetchCachedF10,
    fetchCachedNews,
    fetchCachedKline,
    fetchCachedAIAnalysis,
    fetchCachedQuote,
    renderDepthPanelHtml,
    initOmniStockApp,
    applyThemeAndFont,
    toggleTheme,
    refreshData,
    refreshQuotesOnly,
    resetPollingTimer,
    loadSettings,
    saveSettings,
    updateSetting,
    openSettingsModal,
    closeSettingsModal,
    openPortfolioModal,
    closePortfolioModal,
    savePortfolioPosition,
    deletePortfolioPosition,
    openAlertModal,
    closeAlertModal,
    saveAlertRule,
    deleteAlertRule,
    openTagModal,
    closeTagModal,
    setStockTag,
    setDrawerTab,
    setSectorTab,
    toggleExpandSector,
    updateSectorsDOM,
    renderFundFlow,
    renderNotes,
    saveStockNote,
    setAiPromptStrategy,
    buildStrategyPrompt,
    updateChartHUD,
    renderPortfolioSummaryCard,
    checkPriceAlerts,
    setMarketTab,
    toggleSortWatchlist,
    toggleWindowDepth,
    exportWatchlist,
    handleBatchImportWatchlist,
    getFilteredAndSortedWatchlist,
    getTrendColor,
    getTrendTextClass,
    getTrendBadgeClass,
    updateWatchlistDOM,
    updateRibbonDOM,
    updateOpenChartsQuotes,
    renderInitialApp,
    renderFooterManagerHtml,
    updateFooterManager,
    renderSingleWindowHtml,
    renderWindowControlsHtml,
    renderIndicatorBtn,
    toggleMorphDrawer,
    bindDrawerEvents,
    bindSingleWindowEvents,
    selectAndAddStock,
    renderF10,
    renderNews,
    renderAIAnalysis,
    createDSHAgentSession,
    copyStockAIPrompt,
    renderChart,
    openChart,
    openBatchTiled,
    closeWindow,
    focusWindow,
    toggleMinimizeWindow,
    toggleMaximizeWindow,
    setWindowPeriod,
    toggleIndicator,
    applyWindowLayout,
    minimizeAllWindows,
    restoreAllWindows,
    closeAllWindows,
    addToWatchlist,
    removeFromWatchlist,
    sendStockToDSHChat,
    showToast,
    clearSearch
  });
}
