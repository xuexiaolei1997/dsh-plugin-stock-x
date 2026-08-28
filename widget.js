/**
 * OmniStock 独立嵌入式悬浮球插件 (Widget SDK)
 * 支持注入到任何 Web 宿主应用或 DeepSeek Harness (dsh) Web 界面中
 */
(function () {
  if (window.__OMNISTOCK_WIDGET_LOADED__) return;
  window.__OMNISTOCK_WIDGET_LOADED__ = true;

  const SERVER_URL = 'http://127.0.0.1:3000';

  // 1. 注入悬浮球样式
  const style = document.createElement('style');
  style.textContent = `
    .omnistock-ball-container {
      position: fixed;
      right: 25px;
      bottom: 30px;
      z-index: 999999;
      user-select: none;
      cursor: pointer;
    }
    .omnistock-ball {
      width: 58px;
      height: 58px;
      border-radius: 50%;
      background: linear-gradient(135deg, #2563eb, #7c3aed, #06b6d4);
      box-shadow: 0 10px 25px -5px rgba(37, 99, 235, 0.6), 0 0 15px 2px rgba(99, 102, 241, 0.4);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      color: #ffffff;
      border: 2px solid rgba(255, 255, 255, 0.35);
      transition: transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 0.2s;
    }
    .omnistock-ball:hover {
      transform: scale(1.12);
      box-shadow: 0 15px 35px -5px rgba(37, 99, 235, 0.8), 0 0 20px 4px rgba(99, 102, 241, 0.6);
    }
    .omnistock-ball:active {
      transform: scale(0.95);
    }
    .omnistock-ball svg {
      width: 20px;
      height: 20px;
      filter: drop-shadow(0 2px 4px rgba(0,0,0,0.3));
    }
    .omnistock-ball-label {
      font-size: 9px;
      font-weight: 900;
      letter-spacing: 1px;
      text-transform: uppercase;
      margin-top: 1px;
      filter: drop-shadow(0 1px 2px rgba(0,0,0,0.5));
    }
    .omnistock-ball-pulse {
      position: absolute;
      top: 2px;
      right: 2px;
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background-color: #ef4444;
      border: 2px solid #ffffff;
      animation: omnistock-ping 1.5s cubic-bezier(0, 0, 0.2, 1) infinite;
    }
    @keyframes omnistock-ping {
      75%, 100% {
        transform: scale(2);
        opacity: 0;
      }
    }
    .omnistock-modal-overlay {
      position: fixed;
      inset: 0;
      background: rgba(15, 23, 42, 0.65);
      backdrop-filter: blur(8px);
      z-index: 1000000;
      display: none;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .omnistock-modal-overlay.active {
      display: flex;
      animation: omnistock-fade-in 0.2s ease-out;
    }
    @keyframes omnistock-fade-in {
      from { opacity: 0; transform: scale(0.97); }
      to { opacity: 1; transform: scale(1); }
    }
    .omnistock-modal-frame {
      width: 95vw;
      max-width: 1550px;
      height: 90vh;
      background: #0f172a;
      border: 1px solid rgba(51, 65, 85, 0.8);
      border-radius: 20px;
      box-shadow: 0 25px 60px -15px rgba(0, 0, 0, 0.8);
      overflow: hidden;
      position: relative;
    }
    .omnistock-modal-close {
      position: absolute;
      top: 12px;
      right: 15px;
      z-index: 10;
      background: rgba(30, 41, 59, 0.85);
      border: 1px solid rgba(71, 85, 105, 0.8);
      color: #94a3b8;
      width: 32px;
      height: 32px;
      border-radius: 10px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 18px;
      transition: all 0.15s;
    }
    .omnistock-modal-close:hover {
      background: #ef4444;
      color: #ffffff;
      border-color: #ef4444;
    }
    .omnistock-iframe {
      width: 100%;
      height: 100%;
      border: none;
    }
  `;
  document.head.appendChild(style);

  // 2. 创建悬浮球 DOM
  const ballContainer = document.createElement('div');
  ballContainer.className = 'omnistock-ball-container';
  ballContainer.innerHTML = `
    <div class="omnistock-ball" title="点击打开 OmniStock 自选盯盘与金融图表工作台 (可拖动)">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="22 7 13.5 15.5 8.5 10.5 2 17"></polyline>
        <polyline points="16 7 22 7 22 13"></polyline>
      </svg>
      <span class="omnistock-ball-label">STOCK</span>
      <div class="omnistock-ball-pulse"></div>
    </div>
  `;
  document.body.appendChild(ballContainer);

  // 3. 创建全功能模态弹窗 Frame
  const overlay = document.createElement('div');
  overlay.className = 'omnistock-modal-overlay';
  overlay.innerHTML = `
    <div class="omnistock-modal-frame">
      <button class="omnistock-modal-close" title="收起为悬浮球">✕</button>
      <iframe class="omnistock-iframe" src="${SERVER_URL}"></iframe>
    </div>
  `;
  document.body.appendChild(overlay);

  const closeBtn = overlay.querySelector('.omnistock-modal-close');
  closeBtn.addEventListener('click', () => {
    overlay.classList.remove('active');
  });

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      overlay.classList.remove('active');
    }
  });

  // 4. 悬浮球拖拽与点击交互
  let isDragging = false;
  let startX = 0, startY = 0, posX = 0, posY = 0;

  ballContainer.addEventListener('mousedown', (e) => {
    isDragging = false;
    startX = e.clientX;
    startY = e.clientY;
    const rect = ballContainer.getBoundingClientRect();
    posX = rect.left;
    posY = rect.top;

    const onMouseMove = (ev) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
        isDragging = true;
      }
      ballContainer.style.left = `${Math.max(10, Math.min(window.innerWidth - 70, posX + dx))}px`;
      ballContainer.style.top = `${Math.max(10, Math.min(window.innerHeight - 70, posY + dy))}px`;
      ballContainer.style.right = 'auto';
      ballContainer.style.bottom = 'auto';
    };

    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  });

  ballContainer.addEventListener('click', () => {
    if (!isDragging) {
      overlay.classList.add('active');
    }
  });

  console.log('[OmniStock] 嵌入式 STOCK 悬浮球插件加载成功！');
})();
