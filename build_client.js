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

      // 1. 动态挂载 Tailwind CSS (显式启用 class dark mode)
      if (!document.getElementById("dsh-tailwind-cdn")) {
        window.tailwind = window.tailwind || {};
        window.tailwind.config = {
          darkMode: 'class',
          theme: {
            extend: {
              colors: {
                darkBg: '#090d16',
              }
            }
          }
        };
        var tw = document.createElement("script");
        tw.id = "dsh-tailwind-cdn";
        tw.src = "https://cdn.tailwindcss.com";
        document.head.appendChild(tw);
      }

      // 2. 动态挂载 ECharts (带国内多镜像 CDN 容灾降级)
      if (!window.echarts && !document.getElementById("dsh-echarts-cdn")) {
        var ec = document.createElement("script");
        ec.id = "dsh-echarts-cdn";
        ec.src = "https://cdn.jsdelivr.net/npm/echarts@5.5.0/dist/echarts.min.js";
        ec.onerror = function() {
          console.warn("[dsh-plugin-stock-x] jsdelivr 镜像加载异常，自动切换为 bootcdn 镜像");
          var ec2 = document.createElement("script");
          ec2.src = "https://cdn.bootcdn.net/ajax/libs/echarts/5.5.0/echarts.min.js";
          document.head.appendChild(ec2);
        };
        document.head.appendChild(ec);
      }

      // 3. 确保我们的应用根节点存在
      if (!document.getElementById("app-root")) {
        var rootDiv = document.createElement("div");
        rootDiv.id = "app-root";
        document.body.appendChild(rootDiv);
      }

      // 4. 立即注入执行工作台核心引擎 (0ms 瞬间就绪，无需阻塞等待网络请求)
      try {
        (1, eval)(${JSON.stringify(indicatorsCode + '\n' + appCode)});
        console.log("[dsh-plugin-stock-x] 摸鱼悬浮球与自选工作台已就绪");
      } catch (err) {
        console.error("[dsh-plugin-stock-x] 启动前端应用失败:", err);
      }
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

  try {
    const destDir = path.join(os.homedir(), '.dsh', 'profiles', 'web', 'node_modules', 'dsh-plugin-stock-x');
    if (fs.existsSync(destDir)) {
      fs.writeFileSync(path.join(destDir, 'client.js'), clientTemplate, 'utf8');
    }
  } catch (err) {
    // Sandboxed or profile dir not writable
  }

  console.log('client.js successfully generated! Size:', clientTemplate.length);
}

main().catch(err => console.error(err));
