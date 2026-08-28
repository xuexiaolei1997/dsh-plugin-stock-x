import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const indicatorsCode = fs.readFileSync(path.join(__dirname, 'public', 'indicators.js'), 'utf8');
  const appCode = fs.readFileSync(path.join(__dirname, 'public', 'app.js'), 'utf8');

  const clientTemplate = `/**
 * dsh-plugin-stock-x — 浏览器端 (client.js)
 * 纯原生高性能加载自选股摸鱼悬浮球、自选股抽屉与多窗口量化工作台
 */
window.__ModuleLoader__.load({
  id: "dsh-plugin-stock-x",
  factory: function (require) {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    function initStockWidget() {
      if (typeof window === "undefined") return;

      // 1. 动态挂载 Tailwind CSS
      if (!document.getElementById("dsh-tailwind-cdn")) {
        var tw = document.createElement("script");
        tw.id = "dsh-tailwind-cdn";
        tw.src = "https://cdn.tailwindcss.com";
        document.head.appendChild(tw);
      }

      // 2. 动态挂载 ECharts
      if (!document.getElementById("dsh-echarts-cdn")) {
        var ec = document.createElement("script");
        ec.id = "dsh-echarts-cdn";
        ec.src = "https://cdn.jsdelivr.net/npm/echarts@5.5.0/dist/echarts.min.js";
        document.head.appendChild(ec);
      }

      // 3. 确保我们的应用根节点存在
      if (!document.getElementById("app-root")) {
        var rootDiv = document.createElement("div");
        rootDiv.id = "app-root";
        document.body.appendChild(rootDiv);
      }

      // 4. 等待依赖就绪后，直接执行 indicators 与 app 脚本并挂载全局函数
      function startCustomApp() {
        if (!window.echarts) {
          setTimeout(startCustomApp, 100);
          return;
        }
        try {
          // 注入指标计算库
          (new Function(${JSON.stringify(indicatorsCode)}))();
          // 注入完整自研工作台应用 (包含摸鱼悬浮球、8大全球指数、多窗口看板、量化诊断)
          (new Function(${JSON.stringify(appCode)}))();
          console.log("[dsh-plugin-stock-x] 摸鱼悬浮球与自选工作台已就绪");
        } catch (err) {
          console.error("[dsh-plugin-stock-x] 启动前端应用失败:", err);
        }
      }

      startCustomApp();
    }

    var name = "dsh-plugin-stock-x";
    var inject = [];
    function apply(ctx) {
      if (typeof window !== "undefined") {
        if (document.readyState === "loading") {
          document.addEventListener("DOMContentLoaded", initStockWidget, { once: true });
        } else {
          initStockWidget();
        }
      }
    }

    exports.name = name;
    exports.inject = inject;
    exports.apply = apply;
    exports.default = { name: name, inject: inject, apply: apply };
    return module.exports;
  }
});
`;

  fs.writeFileSync(path.join(__dirname, 'client.js'), clientTemplate, 'utf8');

  const destDir = path.join(os.homedir(), '.dsh', 'profiles', 'web', 'node_modules', 'dsh-plugin-stock-x');
  if (fs.existsSync(destDir)) {
    fs.writeFileSync(path.join(destDir, 'client.js'), clientTemplate, 'utf8');
  }

  console.log('client.js successfully generated! Size:', clientTemplate.length);
}

main().catch(err => console.error(err));
