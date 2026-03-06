export function getLivePreviewHtml(defaultUrl: string): string {
  // 判断是否有传入初始 URL
  const hasUrl = !!defaultUrl;

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
      html, body { margin: 0; padding: 0; height: 100vh; display: flex; flex-direction: column; background-color: var(--vscode-editorPane-background, #1e1e1e); color: var(--fg); user-select: none; overflow: hidden; }
      
      .toolbar { 
        display: flex; padding: 6px 10px; background: var(--bg); 
        border-bottom: 1px solid var(--border); gap: 6px; align-items: center; flex-shrink: 0;
      }
      
      .address-bar-wrapper {
        flex: 1; min-width: 150px; padding: 4px 8px; border: 1px solid var(--input-border); 
        background: var(--input-bg); border-radius: 2px; 
        display: flex; align-items: center; gap: 8px; transition: border-color 0.2s;
      }
      .address-bar-wrapper:focus-within { border-color: var(--focus-border); }
      
      .address-bar { 
        flex: 1; border: none; background: transparent; color: var(--input-fg); 
        outline: none; font-family: var(--vscode-editor-font-family, monospace); font-size: 12px; padding: 0; min-width: 0;
      }

      .clear-btn {
        color: var(--vscode-icon-foreground); cursor: pointer; font-size: 14px; 
        padding: 0 4px; display: none; opacity: 0.7; transition: opacity 0.2s;
      }
      .clear-btn:hover { opacity: 1; color: var(--fg); }
      
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
        position: relative; transition: padding 0.3s ease;
      }
      .preview-container.no-padding {
        padding: 0 !important;
      }
      
      #deviceWrapper { 
        display: ${hasUrl ? 'block' : 'none'}; 
        background: #fff; transition: width 0.3s ease, height 0.3s ease; 
        box-shadow: 0 4px 16px rgba(0,0,0,0.4); border-radius: 2px; overflow: hidden;
        position: relative; z-index: 2;
      }
      
      .device-responsive { width: 100%; height: 100%; box-shadow: none !important; border-radius: 0 !important; }
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

      .welcome-page {
        display: ${hasUrl ? 'none' : 'flex'}; 
        position: absolute; top: 0; left: 0; width: 100%; height: 100%;
        flex-direction: column; align-items: center; justify-content: center;
        background-color: var(--bg); z-index: 1; padding: 20px; box-sizing: border-box;
      }
      .welcome-icon { font-size: 56px; color: var(--vscode-descriptionForeground); margin-bottom: 24px; opacity: 0.5; }
      .welcome-title { font-size: 24px; font-weight: 300; margin-bottom: 12px; color: var(--fg); }
      .welcome-subtitle { font-size: 13px; color: var(--vscode-descriptionForeground); margin-bottom: 32px; text-align: center; max-width: 400px; line-height: 1.6; }
      
      .quick-links { display: flex; flex-direction: column; gap: 12px; width: 100%; max-width: 300px; }
      .quick-link-btn {
        display: flex; align-items: center; gap: 12px; padding: 10px 16px;
        background: var(--vscode-button-secondaryBackground, rgba(255,255,255,0.05)); 
        color: var(--vscode-button-secondaryForeground, var(--fg)); 
        border: 1px solid var(--border); border-radius: 4px; cursor: pointer;
        font-size: 13px; transition: all 0.15s; outline: none; text-align: left;
      }
      .quick-link-btn i { font-size: 16px; opacity: 0.8; width: 20px; text-align: center; }
      .quick-link-btn:hover { background: var(--vscode-button-secondaryHoverBackground, rgba(255,255,255,0.1)); border-color: var(--focus-border); }

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
        <input type="text" id="urlInput" class="address-bar" value="${defaultUrl}" placeholder="输入网址 或 搜索内容" autocomplete="off" spellcheck="false" />
        <i class="fa-solid fa-xmark clear-btn" id="clearBtn" title="清除"></i>
      </div>

      <button class="icon-btn" id="goBtn" title="访问 / 搜索"><i class="fa-solid fa-arrow-right"></i></button>
      
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
      <button class="icon-btn" id="externalBtn" title="在外部默认浏览器中打开"><i class="fa-solid fa-arrow-up-right-from-square"></i></button>
      <button class="icon-btn" id="moreBtn" title="更多操作"><i class="fa-solid fa-ellipsis"></i></button>
    </div>
    
    <div class="preview-container" id="previewContainer">
      <div class="welcome-page" id="welcomePage">
        <i class="fa-solid fa-layer-group welcome-icon"></i>
        <h1 class="welcome-title">Live Preview</h1>
        <p class="welcome-subtitle">在上方地址栏输入您的本地开发服务器地址或搜索关键字。<br/>您也可以点击下方快捷选项快速填入：</p>
        
        <div class="quick-links">
          <button class="quick-link-btn" onclick="fillAndGo('localhost:5173')">
            <i class="fa-brands fa-vuejs" style="color: #42b883;"></i> <span>Vite 默认端口 (5173)</span>
          </button>
          <button class="quick-link-btn" onclick="fillAndGo('localhost:8080')">
            <i class="fa-brands fa-node-js" style="color: #8cc84b;"></i> <span>Vue CLI / Webpack (8080)</span>
          </button>
          <button class="quick-link-btn" onclick="fillAndGo('localhost:3000')">
            <i class="fa-brands fa-react" style="color: #61dafb;"></i> <span>React / Next.js (3000)</span>
          </button>
        </div>
      </div>

      <div id="deviceWrapper" class="device-responsive">
        <!-- 测试 -->
        <!-- <iframe id="previewFrame" src="${defaultUrl}" sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation allow-modals allow-downloads" allow="clipboard-read; clipboard-write;"></iframe> -->
        <!-- <iframe id="previewFrame" src="${defaultUrl}" sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation allow-modals allow-downloads" allow="clipboard-read; clipboard-write;"></iframe> -->
        <iframe id="previewFrame" src="${defaultUrl}" sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads" allow="clipboard-read; clipboard-write;"></iframe>
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
      const clearBtn = document.getElementById('clearBtn');
      const previewContainer = document.getElementById('previewContainer');
      const previewFrame = document.getElementById('previewFrame');
      const goBtn = document.getElementById('goBtn');
      const refreshBtn = document.getElementById('refreshBtn');
      const externalBtn = document.getElementById('externalBtn');
      const deviceSelect = document.getElementById('deviceSelect');
      const deviceWrapper = document.getElementById('deviceWrapper');
      
      const siteFavicon = document.getElementById('siteFavicon');
      const defaultFavicon = document.getElementById('defaultFavicon');
      const welcomePage = document.getElementById('welcomePage');

      const moreBtn = document.getElementById('moreBtn');
      const actionMenu = document.getElementById('actionMenu');
      const actionMenuRefresh = document.getElementById('actionMenuRefresh');
      const actionDevTools = document.getElementById('actionDevTools');
      const actionVConsole = document.getElementById('actionVConsole');
      const fontSelect = document.getElementById('fontSelect');

      // 智能判断是否是域名或 IP
      function isUrlLike(str) {
        const urlPattern = /^(https?:\\/\\/|file:\\/\\/)?(localhost|\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}|([a-zA-Z0-9-]+\\.)+[a-zA-Z]{2,})(:\\d+)?(\\/.*)?$/i;
        return urlPattern.test(str);
      }

      // 删除按钮显示隐藏逻辑
      function toggleClearBtn() {
        clearBtn.style.display = urlInput.value.length > 0 ? 'block' : 'none';
      }
      urlInput.addEventListener('input', toggleClearBtn);
      
      clearBtn.addEventListener('click', () => {
        urlInput.value = '';
        toggleClearBtn();
        urlInput.focus(); 
      });

      window.fillAndGo = function(targetUrl) {
        urlInput.value = targetUrl;
        toggleClearBtn();
        loadUrl();
      };

      function updateFavicon(urlStr) {
        try {
          const urlObj = new URL(urlStr);
          const iconUrl = urlObj.origin + '/favicon.ico';
          siteFavicon.onload = () => { siteFavicon.style.display = 'block'; defaultFavicon.style.display = 'none'; };
          siteFavicon.onerror = () => { siteFavicon.style.display = 'none'; defaultFavicon.style.display = 'block'; };
          siteFavicon.src = iconUrl + '?t=' + new Date().getTime();
        } catch(e) {
          siteFavicon.style.display = 'none'; defaultFavicon.style.display = 'block';
        }
      }

      function loadUrl() {
        let rawInput = urlInput.value.trim();
        if (!rawInput) {
          welcomePage.style.display = 'flex';
          deviceWrapper.style.display = 'none';
          previewFrame.src = 'about:blank';
          updateFavicon('');
          vscode.postMessage({ type: 'saveUrl', url: '' });
          return;
        }
        
        let finalUrl = rawInput;
        
        // 判断是网址还是搜索关键词
        if (isUrlLike(rawInput)) {
          if (!rawInput.startsWith('http://') && !rawInput.startsWith('https://') && !rawInput.startsWith('file://')) {
            finalUrl = 'http://' + rawInput;
          }
          urlInput.value = finalUrl;
        } else {
          // 🌟 终极方案：使用对 iframe 完美兼容的 Bing 搜索！
          finalUrl = 'https://www.bing.com/search?q=' + encodeURIComponent(rawInput);
        }
        
        welcomePage.style.display = 'none';
        deviceWrapper.style.display = 'block';
        
        previewFrame.src = finalUrl;
        updateFavicon(finalUrl); 
        vscode.postMessage({ type: 'saveUrl', url: finalUrl });
      }

      function doRefresh() {
        if (!urlInput.value.trim()) return; 
        const currentUrl = previewFrame.src;
        previewFrame.src = 'about:blank';
        setTimeout(() => { previewFrame.src = currentUrl; }, 10);
        closeMenu();
      }

      // 外部浏览器打开逻辑
      externalBtn.addEventListener('click', () => {
        let url = urlInput.value.trim();
        if (!url) return;
        
        if (isUrlLike(url)) {
          if (!url.startsWith('http://') && !url.startsWith('https://')) {
            url = 'http://' + url;
          }
        } else {
          // 外部搜索也统一走 Bing
          url = 'https://www.bing.com/search?q=' + encodeURIComponent(url);
        }
        
        vscode.postMessage({ type: 'openExternalBrowser', url: url });
      });

      function doInjectFont() {
        try {
          const font = fontSelect.value;
          const doc = previewFrame.contentDocument || previewFrame.contentWindow.document;
          if (doc) doc.body.style.fontFamily = font;
        } catch (e) {
          vscode.postMessage({ type: 'showError', message: '注入失败：存在跨域限制(CORS)。' });
        }
      }

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
          vscode.postMessage({ type: 'vConsoleFallback' });
        }
        closeMenu();
      }

      function doOpenDevTools() {
        vscode.postMessage({ type: 'openDevTools' });
        closeMenu();
      }

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

      // 绑定核心事件
      goBtn.addEventListener('click', loadUrl);
      urlInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') loadUrl(); });
      
      refreshBtn.addEventListener('click', doRefresh);
      actionMenuRefresh.addEventListener('click', doRefresh);
      
      actionDevTools.addEventListener('click', doOpenDevTools);
      actionVConsole.addEventListener('click', doInjectVConsole);
      fontSelect.addEventListener('change', doInjectFont);

      // 动态控制全屏模式下的边距
      deviceSelect.addEventListener('change', (e) => {
        deviceWrapper.className = e.target.value;
        if (e.target.value === 'device-responsive') {
          previewContainer.classList.add('no-padding');
        } else {
          previewContainer.classList.remove('no-padding');
        }
        vscode.postMessage({ type: 'saveDevice', device: e.target.value });
      });

      window.addEventListener('message', event => {
        const message = event.data;
        if (message.type === 'init') {
          if (message.device) {
            deviceSelect.value = message.device;
            deviceWrapper.className = message.device;
            if (message.device === 'device-responsive') {
              previewContainer.classList.add('no-padding');
            }
          }
          if (urlInput.value.trim()) {
            updateFavicon(urlInput.value);
            toggleClearBtn();
          }
        }
      });
      
      // 初始化状态
      if ('${defaultUrl}'.trim()) {
        updateFavicon('${defaultUrl}');
        toggleClearBtn();
      }
    </script>
  </body>
  </html>`;
}