export function getLivePreviewHtml(defaultUrl: string): string {
  return `<!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link rel="preload" href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" as="style" onload="this.onload=null;this.rel='stylesheet'">
    <noscript><link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css"></noscript>
    <style>
      :root {
        --bg: var(--vscode-editor-background);
        --fg: var(--vscode-editor-foreground);
        --border: var(--vscode-panel-border);
        --input-bg: var(--vscode-input-background);
        --input-fg: var(--vscode-input-foreground);
        --input-border: var(--vscode-input-border);
        --btn-hover: var(--vscode-toolbar-hoverBackground);
        --menu-bg: var(--vscode-menu-background);
        --menu-fg: var(--vscode-menu-foreground);
        --menu-border: var(--vscode-menu-border);
        --menu-hover-bg: var(--vscode-menu-selectionBackground);
        --menu-hover-fg: var(--vscode-menu-selectionForeground);
        --focus-border: var(--vscode-focusBorder);
      }
      html, body { margin: 0; padding: 0; height: 100vh; display: flex; flex-direction: column; background-color: var(--vscode-editorPane-background, #1e1e1e); color: var(--fg); user-select: none; }
      
      .toolbar { 
        display: flex; padding: 6px 10px; background: var(--bg); 
        border-bottom: 1px solid var(--border); gap: 6px; align-items: center; flex-shrink: 0;
      }
      
      /* 🌟 联合地址栏：包含 Icon 和 输入框 */
      .address-bar-wrapper {
        flex: 1; min-width: 150px; padding: 4px 8px; border: 1px solid var(--input-border); 
        background: var(--input-bg); border-radius: 2px; 
        display: flex; align-items: center; gap: 8px; transition: border-color 0.2s;
      }
      .address-bar-wrapper:focus-within { border-color: var(--focus-border); }
      
      .address-bar { 
        flex: 1; border: none; background: transparent; color: var(--input-fg); 
        outline: none; font-family: var(--vscode-editor-font-family, monospace); font-size: 12px; padding: 0;
      }
      
      .icon-btn { 
        background: transparent; color: var(--vscode-icon-foreground); border: none; 
        padding: 4px 6px; border-radius: 4px; cursor: pointer; font-size: 14px; 
        display: inline-flex; align-items: center; justify-content: center; outline: none;
      }
      .icon-btn:hover { background: var(--btn-hover); color: var(--fg); }
      
      .vscode-select {
        background: var(--input-bg); color: var(--input-fg); border: 1px solid var(--input-border);
        padding: 4px; border-radius: 2px; outline: none; cursor: pointer; font-size: 12px;
      }
      .vscode-select:focus { border-color: var(--focus-border); }

      .divider { width: 1px; height: 18px; background: var(--border); margin: 0 2px; }

      .preview-container { 
        flex: 1; overflow: auto; display: flex; justify-content: center; align-items: flex-start; padding: 20px; 
      }
      
      #deviceWrapper { 
        background: #fff; transition: width 0.3s ease, height 0.3s ease; 
        box-shadow: 0 4px 16px rgba(0,0,0,0.4); border-radius: 2px; overflow: hidden;
        position: relative;
      }
      
      .device-responsive { width: 100%; height: 100%; box-shadow: none; border-radius: 0; }
      .device-iphone-se { width: 375px; height: 667px; }
      .device-iphone-xr { width: 414px; height: 896px; }
      .device-iphone-12-pro { width: 390px; height: 844px; }
      .device-iphone-14-pro-max { width: 430px; height: 932px; }
      .device-pixel-7 { width: 412px; height: 915px; }
      .device-galaxy-s8-plus { width: 360px; height: 740px; }
      .device-galaxy-s20-ultra { width: 412px; height: 915px; }
      .device-ipad-mini { width: 768px; height: 1024px; }
      .device-ipad-air { width: 820px; height: 1180px; }
      .device-ipad-pro { width: 1024px; height: 1366px; }
      .device-surface-pro-7 { width: 912px; height: 1368px; }
      
      iframe { width: 100%; height: 100%; border: none; background: #fff; display: block; }

      /* 右键菜单 */
      .context-menu {
        display: none; position: absolute; z-index: 9999;
        background: var(--menu-bg); border: 1px solid var(--menu-border);
        box-shadow: 0 2px 8px rgba(0,0,0,0.3); border-radius: 4px;
        padding: 4px 0; min-width: 180px;
      }
      .menu-item {
        padding: 6px 12px; font-size: 12px; color: var(--menu-fg);
        cursor: pointer; display: flex; align-items: center; gap: 8px;
      }
      .menu-item:hover { background: var(--menu-hover-bg); color: var(--menu-hover-fg); }
      .menu-divider { height: 1px; background: var(--menu-border); margin: 4px 0; }
      
      .menu-select-wrapper { padding: 4px 12px; display: flex; flex-direction: column; gap: 4px; }
      .menu-select-wrapper span { font-size: 11px; color: var(--vscode-descriptionForeground); }
      .menu-select-wrapper select { width: 100%; }
    </style>
  </head>
  <body>
    <div class="toolbar">
      <button class="icon-btn" id="refreshBtn" title="刷新页面"><i class="fa-solid fa-rotate-right"></i></button>
      
      <div class="address-bar-wrapper">
        <img id="siteFavicon" src="" style="display:none; width:14px; height:14px; border-radius:2px; object-fit:contain;" />
        <i id="defaultFavicon" class="fa-solid fa-globe" style="font-size:13px; color:var(--vscode-descriptionForeground);"></i>
        <input type="text" id="urlInput" class="address-bar" value="${defaultUrl}" placeholder="例如: localhost:5173 (可省略 http://)" autocomplete="off" spellcheck="false" />
      </div>

      <button class="icon-btn" id="goBtn" title="访问"><i class="fa-solid fa-arrow-right"></i></button>
      
      <div class="divider"></div>

      <select id="deviceSelect" class="vscode-select" title="选择预览设备">
        <optgroup label="响应式 (全屏)">
          <option value="device-responsive">响应式 (Responsive)</option>
        </optgroup>
        <optgroup label="Apple 手机">
          <option value="device-iphone-se">iPhone SE (375x667)</option>
          <option value="device-iphone-xr">iPhone XR (414x896)</option>
          <option value="device-iphone-12-pro">iPhone 12 Pro (390x844)</option>
          <option value="device-iphone-14-pro-max">iPhone 14 Pro Max (430x932)</option>
        </optgroup>
        <optgroup label="Android 手机">
          <option value="device-pixel-7">Pixel 7 (412x915)</option>
          <option value="device-galaxy-s8-plus">Galaxy S8+ (360x740)</option>
          <option value="device-galaxy-s20-ultra">Galaxy S20 Ultra (412x915)</option>
        </optgroup>
        <optgroup label="平板电脑">
          <option value="device-ipad-mini">iPad Mini (768x1024)</option>
          <option value="device-ipad-air">iPad Air (820x1180)</option>
          <option value="device-ipad-pro">iPad Pro (1024x1366)</option>
          <option value="device-surface-pro-7">Surface Pro 7 (912x1368)</option>
        </optgroup>
      </select>

      <div class="divider"></div>

      <button class="icon-btn" id="moreBtn" title="更多操作"><i class="fa-solid fa-ellipsis"></i></button>
    </div>
    
    <div class="preview-container" id="previewContainer">
      <div id="deviceWrapper" class="device-responsive">
        <iframe id="previewFrame" src="${defaultUrl}" sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads" allow="clipboard-read; clipboard-write;"></iframe>
      </div>
    </div>

    <div id="actionMenu" class="context-menu">
      <div class="menu-item" id="actionMenuRefresh"><i class="fa-solid fa-rotate-right" style="width:16px;"></i> 刷新页面</div>
      <div class="menu-item" id="actionDevTools"><i class="fa-solid fa-terminal" style="width:16px;"></i> 开发者工具</div>
      <div class="menu-item" id="actionVConsole" style="color: #2ecc71;"><i class="fa-solid fa-bug" style="width:16px;"></i> 注入 vConsole</div>
      <div class="menu-divider"></div>
      <div class="menu-select-wrapper">
        <span>强行注入字体:</span>
        <select id="fontSelect" class="vscode-select">
          <option value="">默认字体</option>
          <option value="system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif">系统 UI</option>
          <option value="'Microsoft YaHei', '微软雅黑', sans-serif">微软雅黑</option>
          <option value="SimSun, '宋体', serif">宋体 (SimSun)</option>
          <option value="'PingFang SC', '萍方', sans-serif">苹方 (Mac)</option>
          <option value="Consolas, 'Courier New', monospace">等宽代码</option>
        </select>
      </div>
    </div>

    <script>
      const vscode = acquireVsCodeApi();
      const urlInput = document.getElementById('urlInput');
      const previewFrame = document.getElementById('previewFrame');
      const goBtn = document.getElementById('goBtn');
      const refreshBtn = document.getElementById('refreshBtn');
      const deviceSelect = document.getElementById('deviceSelect');
      const deviceWrapper = document.getElementById('deviceWrapper');
      
      const siteFavicon = document.getElementById('siteFavicon');
      const defaultFavicon = document.getElementById('defaultFavicon');

      const moreBtn = document.getElementById('moreBtn');
      const actionMenu = document.getElementById('actionMenu');
      const actionMenuRefresh = document.getElementById('actionMenuRefresh');
      const actionDevTools = document.getElementById('actionDevTools');
      const actionVConsole = document.getElementById('actionVConsole');
      const fontSelect = document.getElementById('fontSelect');

      // 🌟 解析并加载 Favicon 逻辑
      function updateFavicon(urlStr) {
        try {
          const urlObj = new URL(urlStr);
          const iconUrl = urlObj.origin + '/favicon.ico';
          
          siteFavicon.onload = () => {
            siteFavicon.style.display = 'block';
            defaultFavicon.style.display = 'none';
          };
          siteFavicon.onerror = () => {
            siteFavicon.style.display = 'none';
            defaultFavicon.style.display = 'block';
          };
          
          // 加上时间戳防止强缓存
          siteFavicon.src = iconUrl + '?t=' + new Date().getTime();
        } catch(e) {
          siteFavicon.style.display = 'none';
          defaultFavicon.style.display = 'block';
        }
      }

      function loadUrl() {
        let url = urlInput.value.trim();
        if (!url) return;
        
        if (!url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('file://')) {
          url = 'http://' + url;
          urlInput.value = url;
        }
        
        previewFrame.src = url;
        updateFavicon(url); // 触发加载图标
        vscode.postMessage({ type: 'saveUrl', url: url });
      }

      function doRefresh() {
        const currentUrl = previewFrame.src;
        previewFrame.src = 'about:blank';
        setTimeout(() => { previewFrame.src = currentUrl; }, 10);
        closeMenu();
      }

      function doInjectFont() {
        try {
          const font = fontSelect.value;
          const doc = previewFrame.contentDocument || previewFrame.contentWindow.document;
          if (doc) doc.body.style.fontFamily = font;
        } catch (e) {
          vscode.postMessage({ type: 'showError', message: '注入失败：存在跨域限制(CORS)。' });
        }
      }

      // 🌟 vConsole 注入逻辑重构：失败直接走剪贴板回退
      function doInjectVConsole() {
        try {
          const frameDoc = previewFrame.contentDocument || previewFrame.contentWindow.document;
          if (!frameDoc) throw new Error("No Access");

          if (frameDoc.getElementById('vconsole-script-injected')) {
            vscode.postMessage({ type: 'showInfo', message: 'vConsole 已经注入，请查看页面右下角！' });
            closeMenu(); return;
          }

          const script = frameDoc.createElement('script');
          script.id = 'vconsole-script-injected';
          script.src = 'https://unpkg.com/vconsole@latest/dist/vconsole.min.js';
          script.onload = () => {
            const initScript = frameDoc.createElement('script');
            initScript.innerHTML = 'window.__vconsole = new window.VConsole();';
            frameDoc.body.appendChild(initScript);
            vscode.postMessage({ type: 'showInfo', message: '🚀 vConsole 注入成功！' });
          };
          frameDoc.head.appendChild(script);
        } catch (e) {
          // 核心：捕获跨域报错，抛给外层 VS Code 插件代码去复制脚本
          vscode.postMessage({ type: 'vConsoleFallback' });
        }
        closeMenu();
      }

      function doOpenDevTools() {
        vscode.postMessage({ type: 'openDevTools' });
        closeMenu();
      }

      // --- 菜单交互逻辑 ---
      function openMenu(x, y) {
        actionMenu.style.display = 'block';
        const menuWidth = actionMenu.offsetWidth;
        if (x + menuWidth > window.innerWidth) {
          actionMenu.style.left = (window.innerWidth - menuWidth - 10) + 'px';
        } else {
          actionMenu.style.left = x + 'px';
        }
        actionMenu.style.top = y + 'px';
      }

      function closeMenu() { actionMenu.style.display = 'none'; }

      moreBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const rect = moreBtn.getBoundingClientRect();
        openMenu(rect.left - 150, rect.bottom + 5);
      });

      window.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        openMenu(e.clientX, e.clientY);
      });

      window.addEventListener('click', (e) => {
        if (!e.target.closest('#actionMenu') && !e.target.closest('#moreBtn')) closeMenu();
      });

      // --- 事件绑定 ---
      goBtn.addEventListener('click', loadUrl);
      urlInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') loadUrl(); });
      
      refreshBtn.addEventListener('click', doRefresh);
      actionMenuRefresh.addEventListener('click', doRefresh);
      
      actionDevTools.addEventListener('click', doOpenDevTools);
      actionVConsole.addEventListener('click', doInjectVConsole);
      fontSelect.addEventListener('change', doInjectFont);

      deviceSelect.addEventListener('change', (e) => {
        deviceWrapper.className = e.target.value;
        vscode.postMessage({ type: 'saveDevice', device: e.target.value });
      });

      window.addEventListener('message', event => {
        const message = event.data;
        if (message.type === 'init') {
          if (message.device) {
            deviceSelect.value = message.device;
            deviceWrapper.className = message.device;
          }
          // 初始化时也尝试加载一下 Icon
          updateFavicon(urlInput.value);
        }
      });
      
      // 首次加载初始化 Icon
      updateFavicon('${defaultUrl}');
    </script>
  </body>
  </html>`;
}
