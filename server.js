import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getStockQuote,
  searchStock,
  getStockKline,
  getCompanyF10,
  getStockNewsAndNotices,
  generateStockAIAnalysis,
  getGlobalIndices
} from './stock-api.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_FILE = path.join(__dirname, 'watchlist.json');

function getWatchlist() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
    }
  } catch (_) {}
  return [
    { symbol: 'sh600519', name: '贵州茅台', market: 'A' },
    { symbol: 'sz300750', name: '宁德时代', market: 'A' },
    { symbol: 'hk00700', name: '腾讯控股', market: 'HK' },
    { symbol: 'usNVDA', name: '英伟达', market: 'US' },
    { symbol: 'sh000001', name: '上证指数', market: 'INDEX' }
  ];
}

function saveWatchlist(list) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(list, null, 2), 'utf-8');
  } catch (err) {
    console.error('Save watchlist error:', err);
  }
}

let watchlist = getWatchlist();

const server = http.createServer(async (req, res) => {
  const urlObj = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
  const pathname = urlObj.pathname;

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // Normalize path
  let subPath = pathname;
  if (subPath.startsWith('/dsh-plugin-stock-x')) {
    subPath = subPath.replace(/^\/dsh-plugin-stock-x/, '');
  } else if (subPath.startsWith('/api')) {
    subPath = subPath.replace(/^\/api/, '');
  }
  if (!subPath.startsWith('/')) subPath = '/' + subPath;

  // 1. 自选股列表
  if (subPath === '/watchlist' || subPath === '/watchlist/') {
    if (req.method === 'GET') {
      const symbols = watchlist.map(w => w.symbol);
      const quotes = await getStockQuote(symbols);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ data: quotes }));
      return;
    }

    if (req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', async () => {
        try {
          const item = JSON.parse(body);
          if (!watchlist.find(w => w.symbol.toLowerCase() === item.symbol.toLowerCase())) {
            watchlist.push({ symbol: item.symbol, name: item.name, market: item.market || 'A' });
            saveWatchlist(watchlist);
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'success' }));
        } catch (err) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: err.message }));
        }
      });
      return;
    }
  }

  if (subPath.startsWith('/watchlist/') && req.method === 'DELETE') {
    const sym = subPath.replace('/watchlist/', '');
    watchlist = watchlist.filter(w => w.symbol.toLowerCase() !== sym.toLowerCase());
    saveWatchlist(watchlist);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'success' }));
    return;
  }

  // 2. 指数
  if (subPath === '/indices' || subPath === '/indices/') {
    const quotes = await getGlobalIndices();
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ data: quotes }));
    return;
  }

  // 3. 实时行情
  if (subPath.startsWith('/quote/')) {
    const symbol = subPath.replace('/quote/', '');
    const quotes = await getStockQuote([symbol]);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ data: quotes[0] || null }));
    return;
  }

  // 4. 搜索
  if (subPath === '/search' || subPath === '/search/') {
    const q = urlObj.searchParams.get('q') || '';
    const results = await searchStock(q);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ data: results }));
    return;
  }

  // 5. K线时序
  if (subPath.startsWith('/kline/')) {
    const symbol = subPath.replace('/kline/', '');
    const period = urlObj.searchParams.get('period') || 'daily';
    const count = parseInt(urlObj.searchParams.get('count') || '120');
    const bars = await getStockKline(symbol, period, count);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ data: bars }));
    return;
  }

  // 6. F10
  if (subPath.startsWith('/f10/')) {
    const symbol = subPath.replace('/f10/', '');
    const f10Data = await getCompanyF10(symbol);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ data: f10Data }));
    return;
  }

  // 7. 资讯
  if (subPath.startsWith('/news/')) {
    const symbol = subPath.replace('/news/', '');
    const name = urlObj.searchParams.get('name') || '';
    const newsData = await getStockNewsAndNotices(symbol, name);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ data: newsData }));
    return;
  }

  // 8. AI分析
  if (subPath.startsWith('/ai-analysis/')) {
    const symbol = subPath.replace('/ai-analysis/', '');
    const aiData = await generateStockAIAnalysis(symbol);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ data: aiData }));
    return;
  }

  if (pathname === '/widget.js') {
    const widgetFile = path.join(__dirname, 'widget.js');
    if (fs.existsSync(widgetFile)) {
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' });
      fs.createReadStream(widgetFile).pipe(res);
      return;
    }
  }

  if (pathname === '/demo' || pathname === '/demo_embed.html') {
    const demoFile = path.join(__dirname, 'demo_embed.html');
    if (fs.existsSync(demoFile)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      fs.createReadStream(demoFile).pipe(res);
      return;
    }
  }

  let reqPath = pathname === '/' ? 'index.html' : pathname;
  let filePath = path.join(PUBLIC_DIR, reqPath);
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(PUBLIC_DIR, 'index.html');
  }

  if (fs.existsSync(filePath)) {
    const ext = path.extname(filePath);
    const mimeTypes = {
      '.html': 'text/html; charset=utf-8',
      '.js': 'text/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.svg': 'image/svg+xml',
      '.png': 'image/png',
      '.json': 'application/json; charset=utf-8'
    };
    const contentType = mimeTypes[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    fs.createReadStream(filePath).pipe(res);
    return;
  }

  res.writeHead(404);
  res.end('Not Found');
});

server.listen(PORT, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${PORT}`;
  console.log('='.repeat(70));
  console.log(`🚀 纯 JavaScript 独立股票插件 & 悬浮盯盘工作台已启动: ${url}`);
  console.log(`🎯 宿主页面嵌入式测试体验: ${url}/demo`);
  console.log('='.repeat(70));
});
