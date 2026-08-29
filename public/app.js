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

// 智能内存缓存系统 (F10: 10分钟, 新闻: 2分钟, K线: 15-60秒, AI分析: 5分钟)
const memoryCache = {
  f10: new Map(),
  news: new Map(),
  kline: new Map(),
  ai: new Map()
};

// 前端并发请求合并去重器 (防止同时多窗口重复请求相同数据)
const clientInFlight = new Map();

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
async function initOmniStockApp() {
  applyThemeAndFont();
  await refreshData();
  if (!window.__OMNISTOCK_TIMER__) {
    window.__OMNISTOCK_TIMER__ = setInterval(refreshQuotesOnly, 3000);
  }
  renderInitialApp();
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
  // 重新渲染所有打开窗口的内容面板（支持图表、F10、资讯、AI分析全量同步换色）
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

let isRefreshing = false;
async function refreshQuotesOnly() {
  if (isRefreshing) return;
  isRefreshing = true;
  try {
    await refreshData();
    updateWatchlistDOM();
    updateRibbonDOM();
    updateOpenChartsQuotes();
  } finally {
    isRefreshing = false;
  }
}

function updateWatchlistDOM() {
  const container = document.getElementById('watchlist-items-container');
  if (!container) return;
  const isDark = theme === 'dark';

  // 确保容器自身的外观与主题严格同步
  container.className = `flex-1 overflow-y-auto divide-y max-h-[300px] ${
    isDark ? 'bg-slate-900 divide-slate-800 text-slate-100' : 'bg-white divide-slate-100 text-slate-800'
  }`;

  if (watchlist.length === 0) {
    container.innerHTML = `<div class="p-8 text-center text-sm ${isDark ? 'bg-slate-900 text-slate-400' : 'bg-white text-slate-500'}">暂无自选股票，请在上方搜索添加</div>`;
    return;
  }

  container.innerHTML = watchlist.map(item => {
    const isUp = (item.change || 0) >= 0;
    const color = isUp ? 'text-red-500' : 'text-emerald-500';
    const sign = isUp ? '+' : '';

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
            <div class="font-bold text-sm group-hover:text-blue-500 transition-colors truncate ${isDark ? 'text-slate-100' : 'text-slate-900'}">${item.name}</div>
            <div class="text-xs font-mono opacity-60 ${isDark ? 'text-slate-400' : 'text-slate-500'}">${item.symbol}</div>
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
    const color = isUp ? 'text-red-500' : 'text-emerald-500';
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
    const color = isUp ? 'text-red-500' : 'text-emerald-500';
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
  });
}

// 页面基础框架渲染
function renderInitialApp() {
  const isDark = theme === 'dark';
  let html = '';

  const w = isDrawerOpen ? 390 : 56;
  const h = isDrawerOpen ? 530 : 56;
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

      <!-- 状态 B: 自选盯盘面板 (不透明纯色实底) -->
      <div id="morph-panel-view"
        style="opacity: ${isDrawerOpen ? 1 : 0}; transform: scale(${isDrawerOpen ? 1 : 0.94}); pointer-events: ${isDrawerOpen ? 'auto' : 'none'};"
        class="morph-view absolute inset-0 w-full h-full flex flex-col ${isDark ? 'bg-slate-900 text-slate-100' : 'bg-white text-slate-800'}">
        
        <!-- 面板头部 -->
        <div id="panel-drag-header" class="px-4 py-3 border-b flex items-center justify-between cursor-move select-none ${
          isDark ? 'bg-slate-800 border-slate-700 text-slate-100' : 'bg-slate-100 border-slate-200 text-slate-800'
        }">
          <div class="flex items-center gap-2">
            <span class="w-6 h-6 rounded-lg bg-blue-600/20 text-blue-500 flex items-center justify-center text-sm font-bold">📈</span>
            <span class="font-bold text-base">自选盯盘</span>
            <span id="watchlist-count-badge" class="text-xs font-semibold px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20">
              ${watchlist.length} 只
            </span>
          </div>

          <div class="flex items-center gap-1.5 text-sm">
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

        <!-- 自选股票列表 (实色底色，不透明) -->
        <div id="watchlist-items-container" class="flex-1 overflow-y-auto divide-y max-h-[300px] ${
          isDark ? 'bg-slate-900 divide-slate-800' : 'bg-white divide-slate-100'
        }"></div>

        <!-- 底部窗口管理集成区 -->
        <div id="watchlist-footer-manager" class="p-2.5 border-t flex flex-col gap-2 text-xs ${
          isDark ? 'bg-slate-900 border-slate-800 text-slate-300' : 'bg-slate-50 border-slate-200 text-slate-700'
        }">
          ${renderFooterManagerHtml()}
        </div>
      </div>
    </div>
  `;

  // 2. 走势图窗口容器
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
  updateWatchlistDOM();
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

// 渲染单个窗口 HTML (含 AI 分析顶栏按钮与专属面板)
function renderSingleWindowHtml(win) {
  const isDark = theme === 'dark';
  const quote = watchlist.find(w => w.symbol.toLowerCase() === win.symbol.toLowerCase()) || {};
  const isUp = (quote.change || 0) >= 0;
  const sign = isUp ? '+' : '';

  if (win.isMinimized) {
    return `
      <div id="${win.id}" style="position:fixed; left:${win.x}px; top:${win.y}px; z-index:${win.zIndex};"
        class="border rounded-2xl shadow-xl flex items-center gap-3 px-4 py-2.5 select-none backdrop-blur-xl cursor-move ${
          isDark ? 'bg-slate-900/95 border-slate-700 text-slate-100' : 'bg-white/95 border-slate-300 text-slate-800'
        }">
        <span class="text-blue-500 font-bold text-sm">📊 ${win.name}</span>
        <span class="font-mono text-sm font-bold ${isUp ? 'text-red-500' : 'text-emerald-500'}">
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
        <div><span class="text-xs block opacity-60 mb-0.5">最新现价</span><span class="quote-price font-bold text-base ${isUp ? 'text-red-500' : 'text-emerald-500'}">${quote.current_price?.toFixed(2) || '--'}</span></div>
        <div><span class="text-xs block opacity-60 mb-0.5">今日涨跌</span><span class="quote-pct font-bold text-base ${isUp ? 'text-red-500' : 'text-emerald-500'}">${sign}${quote.change_pct ? quote.change_pct.toFixed(2) : '0.00'}%</span></div>
        <div><span class="text-xs block opacity-60 mb-0.5">今开 / 昨收</span><span class="text-sm font-semibold">${quote.open?.toFixed(2) || '--'} / ${quote.prev_close?.toFixed(2) || '--'}</span></div>
        <div><span class="text-xs block opacity-60 mb-0.5">最高 / 最低</span><span class="text-sm font-semibold text-red-500">${quote.high?.toFixed(2) || '--'}</span> / <span class="text-sm font-semibold text-emerald-500">${quote.low?.toFixed(2) || '--'}</span></div>
        
        <div><span class="text-xs block opacity-60 mb-0.5">换手率</span><span class="text-sm font-bold text-amber-500">${quote.turnover_rate ? quote.turnover_rate.toFixed(2) + '%' : '--'}</span></div>
        <div><span class="text-xs block opacity-60 mb-0.5">日内振幅</span><span class="text-sm font-semibold">${quote.amplitude ? quote.amplitude.toFixed(2) + '%' : '--'}</span></div>
        <div><span class="text-xs block opacity-60 mb-0.5">成交量</span><span class="text-sm font-semibold">${quote.volume ? (quote.volume>=10000 ? (quote.volume/10000).toFixed(1)+'万' : quote.volume) : '--'}</span></div>
        <div><span class="text-xs block opacity-60 mb-0.5">成交额</span><span class="text-sm font-semibold">${quote.turnover ? '¥'+(quote.turnover/100000000).toFixed(2)+'亿' : '--'}</span></div>

        <div><span class="text-xs block opacity-60 mb-0.5">市盈率(PE) / PB</span><span class="text-sm font-semibold">${quote.pe_ratio?.toFixed(1) || '--'} / ${quote.pb_ratio?.toFixed(1) || '--'}</span></div>
        <div><span class="text-xs block opacity-60 mb-0.5">流通 / 总市值</span><span class="text-sm font-semibold">${quote.float_market_cap ? quote.float_market_cap.toFixed(0)+'亿' : '--'} / ${quote.market_cap ? quote.market_cap.toFixed(0)+'亿' : '--'}</span></div>
        <div><span class="text-xs block opacity-60 mb-0.5">涨停 / 跌停价</span><span class="text-sm font-semibold text-red-500">${quote.limit_up?.toFixed(2) || '--'}</span> / <span class="text-sm font-semibold text-emerald-500">${quote.limit_down?.toFixed(2) || '--'}</span></div>
        <div><span class="text-xs block opacity-60 mb-0.5">股息率</span><span class="text-sm font-semibold text-blue-400">${quote.dividend_yield ? quote.dividend_yield.toFixed(2)+'%' : '--'}</span></div>
      </div>

      <!-- 周期与看板控制栏 (含 AI 分析选项卡) -->
      <div id="controls-bar-${win.id}" class="px-4 py-2.5 border-b flex flex-wrap items-center justify-between gap-2.5 text-xs ${
        isDark ? 'bg-slate-900/90 border-slate-800' : 'bg-white border-slate-200'
      }">
        ${renderWindowControlsHtml(win)}
      </div>

      <!-- 图表 / F10 / 资讯 / AI分析 专属容器 -->
      <div id="chart-container-${win.id}" class="flex-1 p-2.5 relative overflow-y-auto ${isDark ? 'bg-slate-950/40' : 'bg-slate-50/50'}">
        <div id="chart-${win.id}" class="w-full h-full ${win.period === 'f10' || win.period === 'news' || win.period === 'ai' ? 'hidden' : ''}"></div>
        <div id="f10-container-${win.id}" class="space-y-3.5 leading-relaxed ${win.period !== 'f10' ? 'hidden' : ''}"></div>
        <div id="news-container-${win.id}" class="space-y-3.5 leading-relaxed ${win.period !== 'news' ? 'hidden' : ''}"></div>
        <div id="ai-container-${win.id}" class="space-y-3.5 leading-relaxed ${win.period !== 'ai' ? 'hidden' : ''}"></div>
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
            { key: 'daily', label: '日K' },
            { key: 'weekly', label: '周K' },
            { key: 'monthly', label: '月K' },
            { key: '5m', label: '5m' },
            { key: '15m', label: '15m' },
            { key: '30m', label: '30m' },
            { key: '60m', label: '60m' }
          ].map(p => `
            <button onclick="setWindowPeriod('${win.id}', '${p.key}')" class="period-btn px-2.5 py-1 rounded-lg text-xs font-semibold transition-all ${
              win.period === p.key ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
            }">${p.label}</button>
          `).join('')}
        </div>

        ${win.period !== 'intraday' && win.period !== 'f10' && win.period !== 'news' && win.period !== 'ai' ? `
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
        ` : (win.period === 'intraday' ? `
          <div class="text-xs text-blue-400 flex items-center gap-3 font-semibold">
            <span class="flex items-center gap-1.5"><b class="w-3 h-0.5 bg-blue-500 inline-block"></b> 现价</span>
            <span class="flex items-center gap-1.5"><b class="w-3 h-0.5 bg-amber-500 inline-block"></b> 分时均价</span>
          </div>
        ` : `<div></div>`)}
      </div>

      <!-- 第二行：F10档案、资讯公告、AI深度分析 -->
      <div class="flex flex-wrap items-center justify-between gap-2 pt-2 border-t ${isDark ? 'border-slate-800/80' : 'border-slate-200/80'}">
        <div class="flex items-center gap-2">
          <span class="text-xs font-semibold text-purple-400 mr-0.5">深度投研:</span>
          <button onclick="setWindowPeriod('${win.id}', 'f10')" class="px-3 py-1 rounded-lg text-xs font-semibold transition-all flex items-center gap-1 ${
            win.period === 'f10' ? 'bg-blue-600 text-white shadow-sm font-bold' : (isDark ? 'bg-slate-800/80 text-slate-300 hover:text-white hover:bg-slate-700' : 'bg-slate-100 text-slate-700 hover:bg-slate-200')
          }">
            <span>📑 F10公司档案</span>
          </button>
          <button onclick="setWindowPeriod('${win.id}', 'news')" class="px-3 py-1 rounded-lg text-xs font-semibold transition-all flex items-center gap-1 ${
            win.period === 'news' ? 'bg-blue-600 text-white shadow-sm font-bold' : (isDark ? 'bg-slate-800/80 text-slate-300 hover:text-white hover:bg-slate-700' : 'bg-slate-100 text-slate-700 hover:bg-slate-200')
          }">
            <span>📰 即时资讯与公告</span>
          </button>
          <button onclick="setWindowPeriod('${win.id}', 'ai')" class="px-3.5 py-1 rounded-lg text-xs font-bold transition-all flex items-center gap-1 shadow-sm ${
            win.period === 'ai'
              ? 'bg-gradient-to-r from-purple-600 to-indigo-600 text-white shadow-md shadow-indigo-500/25 ring-2 ring-purple-400/30'
              : 'bg-purple-950/40 text-purple-300 border border-purple-800/40 hover:bg-purple-900/60 hover:text-white'
          }">
            <span>📐 量化诊断 (喂给AI)</span>
          </button>
        </div>

        <div class="text-xs font-medium ${isDark ? 'text-slate-400' : 'text-slate-500'}">
          ${win.period === 'f10' ? '🏢 企业基本面与财务中枢' : (win.period === 'news' ? '⚡ 即时热点新闻 & 官方公告' : (win.period === 'ai' ? '📐 规则多因子量化诊断模型' : '📈 专业技术走势图'))}
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
    const ai = await fetchCachedAIAnalysis(win.symbol);
    if (!ai) {
      container.innerHTML = `<div class="p-8 text-center text-sm text-slate-400">未能生成该股票的 AI 诊断分析</div>`;
      return;
    }

    container.innerHTML = `
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
            <button onclick="sendStockToDSHChat('${win.symbol}', '${win.name}', false)" class="px-3 py-1.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-bold text-xs shadow-lg shadow-blue-500/25 flex items-center gap-1 transition-all hover:scale-105" title="将个股研报直接填入 DSH 对话框">
              <span>💬 填入聊天框</span>
            </button>
            <button onclick="sendStockToDSHChat('${win.symbol}', '${win.name}', true)" class="px-3 py-1.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold text-xs shadow-lg shadow-emerald-500/25 flex items-center gap-1 transition-all hover:scale-105" title="填入并直接发送给 AI 提问">
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
            <span>📝 完整投研数据包与 AI 提示词 (一键复制喂给 AI)</span>
          </div>
          <button onclick="copyStockAIPrompt('${win.id}')" class="px-3 py-1 rounded-lg bg-blue-600/20 hover:bg-blue-600 text-blue-400 hover:text-white font-bold text-xs transition-all">
            📋 复制数据包
          </button>
        </div>
        <textarea id="ai-prompt-text-${win.id}" readonly
          class="w-full h-40 p-3 rounded-xl font-mono text-xs border focus:outline-none resize-none select-all ${
            isDark ? 'bg-slate-950 border-slate-800 text-slate-300' : 'bg-slate-50 border-slate-300 text-slate-800'
          }">${ai.prompt_report}</textarea>
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
async function sendStockToDSHChat(symbol, name, autoSend = false) {
  // 1. 获取最新盘口与量化分析数据
  const quote = watchlist.find(w => w.symbol.toLowerCase() === symbol.toLowerCase()) || {};
  let aiData = null;
  try {
    aiData = await fetchCachedAIAnalysis(symbol);
  } catch (_) {}

  // 2. 构造高质量的投研提示词
  let promptText = '';
  if (aiData && aiData.prompt_report) {
    promptText = aiData.prompt_report;
  } else {
    let newsList = [];
    try {
      const nData = await fetchCachedNews(symbol, name);
      newsList = nData?.news || [];
    } catch (_) {}

    const isUp = (quote.change || 0) >= 0;
    const sign = isUp ? '+' : '';
    promptText = `【${name} (${symbol}) 股票实时投研诊断与交易决策咨询】
- 最新现价: ¥${quote.current_price?.toFixed(2) || '--'} (今日涨跌: ${sign}${quote.change_pct?.toFixed(2) || '0.00'}%)
- 今开 / 昨收: ¥${quote.open?.toFixed(2) || '--'} / ¥${quote.prev_close?.toFixed(2) || '--'}
- 最高 / 最低: ¥${quote.high?.toFixed(2) || '--'} / ¥${quote.low?.toFixed(2) || '--'}
- 换手率: ${quote.turnover_rate ? quote.turnover_rate.toFixed(2) + '%' : '--'}，成交额: ${quote.turnover ? '¥' + (quote.turnover / 100000000).toFixed(2) + '亿' : '--'}
- 市盈率(PE): ${quote.pe_ratio?.toFixed(1) || '--'}，市净率(PB): ${quote.pb_ratio?.toFixed(1) || '--'}，总市值: ${quote.market_cap ? quote.market_cap.toFixed(0) + '亿' : '--'}
${newsList.length > 0 ? `\n最新资讯动态 (附源链接):\n${newsList.slice(0, 3).map((n, i) => `${i+1}. [${n.media}] [${n.title}](${n.url})`).join('\n')}\n` : ''}
请结合以上实时行情盘口与量化特征，深度分析：
1. 短线走势与多空动能（阻力位、支撑位、止损位设定）；
2. 中长线基本面估值与行业景气度评估；
3. 具体的仓位管理与操作策略建议。`;
  }

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

    if (win.period === 'intraday') {
      const isIndex = win.market === 'INDEX' || win.market === 'GLOBAL' || win.symbol.toLowerCase().startsWith('sh000') || win.symbol.toLowerCase().startsWith('sz399') || win.symbol.toLowerCase().startsWith('us') || win.symbol.toLowerCase().startsWith('int_');
      const times = bars.map(p => p.time.includes(' ') ? p.time.split(' ')[1] : p.time);
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

      const seriesList = [
        {
          name: 'K线', 
          type: 'candlestick', 
          data: ind.kValues, 
          gridIndex: 0,
          itemStyle: { color: '#ef4444', color0: '#10b981', borderColor: '#ef4444', borderColor0: '#10b981' }
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
          { name: 'DN', type: 'line', data: ind.bollLower, smooth: true, showSymbol: false, lineStyle: { color: '#10b981', width: 1.6 } }
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
            { name: 'MACD', type: 'bar', xAxisIndex: gIdx, yAxisIndex: gIdx, data: ind.macdBar.map(v => ({ value: v, itemStyle: { color: v >= 0 ? '#ef4444' : '#10b981' } })) },
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
    }
  } catch (err) {
    console.error('Render chart error:', err);
    win.chartInstance.hideLoading();
  }
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

// 切换周期 (含 F10 / 资讯 / AI分析)
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
    initOmniStockApp,
    applyThemeAndFont,
    toggleTheme,
    refreshData,
    refreshQuotesOnly,
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
