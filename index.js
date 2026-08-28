import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import {
  getStockQuote,
  searchStock,
  getStockKline,
  getCompanyF10,
  getStockNewsAndNotices,
  generateStockAIAnalysis,
  getGlobalIndices,
  formatQuoteMarkdown
} from "./stock-api.js";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(MODULE_DIR, "watchlist.json");

function getWatchlist() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      return JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
    }
  } catch (_) {}
  return [
    { symbol: "sh600519", name: "贵州茅台", market: "A" },
    { symbol: "sz300750", name: "宁德时代", market: "A" },
    { symbol: "hk00700", name: "腾讯控股", market: "HK" },
    { symbol: "usNVDA", name: "英伟达", market: "US" },
    { symbol: "sh000001", name: "上证指数", market: "INDEX" }
  ];
}

function saveWatchlist(list) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(list, null, 2), "utf-8");
  } catch (err) {
    console.error("Save watchlist error:", err);
  }
}

let watchlist = getWatchlist();

export const name = "dsh-plugin-stock-x";

export function ensureUserSkills(logger) {
  try {
    const skillsRoot = process.env.DSH_STOCK_SKILLS_DIR || path.join(os.homedir(), ".agents", "skills");
    const bundledSkillsDir = path.join(MODULE_DIR, "skills");
    if (!fs.existsSync(bundledSkillsDir)) return;
    if (!fs.existsSync(skillsRoot)) fs.mkdirSync(skillsRoot, { recursive: true });

    const skills = fs.readdirSync(bundledSkillsDir);
    skills.forEach(skill => {
      const srcSkillDir = path.join(bundledSkillsDir, skill);
      const targetSkillDir = path.join(skillsRoot, skill);
      if (!fs.existsSync(targetSkillDir)) {
        fs.mkdirSync(targetSkillDir, { recursive: true });
        const files = fs.readdirSync(srcSkillDir);
        files.forEach(f => {
          fs.copyFileSync(path.join(srcSkillDir, f), path.join(targetSkillDir, f));
        });
        logger?.info?.(`[dsh-plugin-stock-x] 已注入投研技能: ${skill}`);
      }
    });
  } catch (err) {
    logger?.warn?.(`[dsh-plugin-stock-x] 技能提示: ${err.message}`);
  }
}

export function apply(ctx) {
  const logger = ctx.logger || console;
  logger.info?.("[dsh-plugin-stock-x] 自定义摸鱼悬浮球与多窗口工作台已初始化");

  ensureUserSkills(logger);

  ctx.inject(["webServer"], (hostCtx) => {
    const sendJson = (res, status, data) => {
      res.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type"
      });
      res.end(JSON.stringify(data));
    };

    const handleStockRequest = async (req, res) => {
      if (req.method === "OPTIONS") {
        res.writeHead(200, {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type"
        });
        res.end();
        return;
      }

      try {
        const url = new URL(req.url || "/", "http://127.0.0.1");
        const pathname = url.pathname;

        let subPath = pathname;
        if (subPath.startsWith("/dsh-plugin-stock-x")) {
          subPath = subPath.replace(/^\/dsh-plugin-stock-x/, "");
        } else if (subPath.startsWith("/api")) {
          subPath = subPath.replace(/^\/api/, "");
        }
        if (!subPath.startsWith("/")) subPath = "/" + subPath;

        // 1. 自选股列表
        if (subPath === "/watchlist" || subPath === "/watchlist/") {
          if (req.method === "GET") {
            const symbols = watchlist.map(w => w.symbol);
            const quotes = await getStockQuote(symbols);
            sendJson(res, 200, { data: quotes });
            return;
          }
          if (req.method === "POST") {
            let body = "";
            req.on("data", c => body += c);
            req.on("end", () => {
              try {
                const item = JSON.parse(body);
                if (!watchlist.find(w => w.symbol.toLowerCase() === item.symbol.toLowerCase())) {
                  watchlist.push({ symbol: item.symbol, name: item.name, market: item.market || "A" });
                  saveWatchlist(watchlist);
                }
                sendJson(res, 200, { status: "success" });
              } catch (e) {
                sendJson(res, 400, { error: e.message });
              }
            });
            return;
          }
        }

        if (subPath.startsWith("/watchlist/") && req.method === "DELETE") {
          const sym = subPath.replace("/watchlist/", "");
          watchlist = watchlist.filter(w => w.symbol.toLowerCase() !== sym.toLowerCase());
          saveWatchlist(watchlist);
          sendJson(res, 200, { status: "success" });
          return;
        }

        // 2. 指数
        if (subPath === "/indices" || subPath === "/indices/") {
          const quotes = await getGlobalIndices();
          sendJson(res, 200, { data: quotes });
          return;
        }

        // 3. 搜索
        if (subPath === "/search" || subPath === "/search/") {
          const q = url.searchParams.get("q") || "";
          const results = await searchStock(q);
          sendJson(res, 200, { data: results });
          return;
        }

        // 4. 行情
        if (subPath.startsWith("/quote/")) {
          const sym = subPath.replace("/quote/", "");
          const quotes = await getStockQuote([sym]);
          sendJson(res, 200, { data: quotes[0] || null });
          return;
        }

        // 5. K线时序
        if (subPath.startsWith("/kline/")) {
          const sym = subPath.replace("/kline/", "");
          const period = url.searchParams.get("period") || "daily";
          const count = parseInt(url.searchParams.get("count") || "120");
          const bars = await getStockKline(sym, period, count);
          sendJson(res, 200, { data: bars });
          return;
        }

        // 6. F10
        if (subPath.startsWith("/f10/")) {
          const sym = subPath.replace("/f10/", "");
          const data = await getCompanyF10(sym);
          sendJson(res, 200, { data });
          return;
        }

        // 7. 资讯
        if (subPath.startsWith("/news/")) {
          const sym = subPath.replace("/news/", "");
          const sName = url.searchParams.get("name") || "";
          const data = await getStockNewsAndNotices(sym, sName);
          sendJson(res, 200, { data });
          return;
        }

        // 8. AI分析
        if (subPath.startsWith("/ai-analysis/")) {
          const sym = subPath.replace("/ai-analysis/", "");
          const data = await generateStockAIAnalysis(sym);
          sendJson(res, 200, { data });
          return;
        }

        // 9. 静态资源
        if (subPath === "/app.js") {
          const filePath = path.join(MODULE_DIR, "public", "app.js");
          if (fs.existsSync(filePath)) {
            res.writeHead(200, { "Content-Type": "application/javascript; charset=utf-8" });
            res.end(fs.readFileSync(filePath, "utf-8"));
            return;
          }
        }
        if (subPath === "/indicators.js") {
          const filePath = path.join(MODULE_DIR, "public", "indicators.js");
          if (fs.existsSync(filePath)) {
            res.writeHead(200, { "Content-Type": "application/javascript; charset=utf-8" });
            res.end(fs.readFileSync(filePath, "utf-8"));
            return;
          }
        }

        sendJson(res, 404, { error: "Not found" });
      } catch (err) {
        sendJson(res, 500, { error: err.message });
      }
    };

    hostCtx.effect(() => {
      const dispose = hostCtx.webServer.register({
        kind: "prefix",
        path: "/dsh-plugin-stock-x",
        handler: handleStockRequest
      });
      return () => {
        dispose?.();
      };
    }, "dsh-plugin-stock-x: routes");
  });

  ctx.inject(["systemPrompt"], (promptCtx) => {
    promptCtx.effect(() => {
      return promptCtx.systemPrompt.section({
        name: "dsh-plugin-stock-x.analysis",
        order: 200,
        text: "当用户意图为分析某家上市公司或股票时：请首先使用技能 investment-research 完成基本面、财务报表、K线技术走势与量化规则研判，并给出严谨的投资评级与操盘策略。"
      });
    }, "dsh-plugin-stock-x: analysis prompt section");
  });
}

export default {
  name,
  apply,
  ensureUserSkills
};
