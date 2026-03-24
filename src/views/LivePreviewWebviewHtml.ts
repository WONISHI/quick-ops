export function getLivePreviewHtml(defaultUrl: string): string {
  const hasUrl = !!defaultUrl;

  return `<!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src * 'unsafe-inline' 'unsafe-eval'; frame-src *; script-src * 'unsafe-inline' 'unsafe-eval'; style-src * 'unsafe-inline'; img-src * data: blob:;">
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
        position: relative; 
      }
      .address-bar-wrapper:focus-within { border-color: var(--focus-border); }
      
      .address-bar { 
        flex: 1; border: none; background: transparent; color: var(--input-fg); 
        outline: none; font-family: var(--vscode-editor-font-family, monospace); font-size: 12px; padding: 0; min-width: 0;
      }

      .suggest-box {
        display: none; position: absolute; top: 100%; left: 0; width: 100%; margin-top: 4px;
        background: var(--menu-bg); border: 1px solid var(--menu-border); border-radius: 4px;
        box-shadow: 0 6px 16px rgba(0,0,0,0.4); z-index: 100000; flex-direction: column;
        max-height: 280px; overflow-y: auto;
      }
      .suggest-item {
        padding: 8px 12px; border-bottom: 1px solid var(--menu-border); cursor: pointer;
        display: flex; flex-direction: column; gap: 4px; transition: background 0.1s;
      }
      .suggest-item:last-child { border-bottom: none; }
      .suggest-item:hover, .suggest-item.selected { background: var(--menu-hover-bg); }
      .suggest-title { font-size: 13px; color: var(--fg); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500; }
      .suggest-url { font-size: 11px; color: var(--vscode-descriptionForeground); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .highlight-match { color: #5dade2; font-weight: bold; }

      .action-icon {
        color: var(--vscode-icon-foreground); cursor: pointer; font-size: 14px; 
        padding: 0 4px; opacity: 0.7; transition: opacity 0.2s, color 0.2s;
      }
      .action-icon:hover { opacity: 1; color: var(--fg); }
      .clear-btn { display: none; }
      
      .icon-btn { 
        background: transparent; color: var(--vscode-icon-foreground); border: none; 
        padding: 4px 6px; border-radius: 4px; cursor: pointer; font-size: 14px; 
        display: inline-flex; align-items: center; justify-content: center; outline: none; transition: 0.1s;
      }
      .icon-btn:hover { background: var(--btn-hover); color: var(--fg); }
      .icon-btn:disabled { opacity: 0.3; cursor: not-allowed; background: transparent !important; color: var(--vscode-icon-foreground) !important; }
      
      .vscode-select {
        background: var(--input-bg); color: var(--input-fg); border: 1px solid var(--input-border);
        padding: 4px; border-radius: 2px; outline: none; cursor: pointer; font-size: 12px;
      }
      .vscode-select:focus { border-color: var(--focus-border); }

      #deviceSelect { width: 125px; text-overflow: ellipsis; overflow: hidden; white-space: nowrap; }

      .divider { width: 1px; height: 18px; background: var(--border); margin: 0 2px; }

      .preview-container { 
        flex: 1; overflow: auto; display: flex; justify-content: center; align-items: flex-start; padding: 20px; 
        position: relative; transition: padding 0.3s ease;
      }
      .preview-container.no-padding { padding: 0 !important; }
      
      #deviceWrapper { 
        display: ${hasUrl ? 'block' : 'none'}; 
        background: #fff; transition: width 0.3s ease, height 0.3s ease; 
        box-shadow: 0 4px 16px rgba(0,0,0,0.4); border-radius: 2px; overflow: hidden;
        position: relative; z-index: 2;
      }
      
      .device-responsive { width: 100%; height: 100%; box-shadow: none !important; border-radius: 0 !important; }
      .device-iphone-se { width: 375px; height: 667px; }
      .device-iphone-se.rotated { width: 667px; height: 375px; }
      .device-iphone-xr { width: 414px; height: 896px; }
      .device-iphone-xr.rotated { width: 896px; height: 414px; }
      .device-iphone-12-pro { width: 390px; height: 844px; }
      .device-iphone-12-pro.rotated { width: 844px; height: 390px; }
      .device-iphone-14-pro-max { width: 430px; height: 932px; }
      .device-iphone-14-pro-max.rotated { width: 932px; height: 430px; }
      .device-pixel-7 { width: 412px; height: 915px; }
      .device-pixel-7.rotated { width: 915px; height: 412px; }
      .device-galaxy-s8-plus { width: 360px; height: 740px; }
      .device-galaxy-s8-plus.rotated { width: 740px; height: 360px; }
      .device-galaxy-s20-ultra { width: 412px; height: 915px; }
      .device-galaxy-s20-ultra.rotated { width: 915px; height: 412px; }
      .device-ipad-mini { width: 768px; height: 1024px; }
      .device-ipad-mini.rotated { width: 1024px; height: 768px; }
      .device-ipad-air { width: 820px; height: 1180px; }
      .device-ipad-air.rotated { width: 1180px; height: 820px; }
      .device-ipad-pro { width: 1024px; height: 1366px; }
      .device-ipad-pro.rotated { width: 1366px; height: 1024px; }
      .device-surface-pro-7 { width: 912px; height: 1368px; }
      .device-surface-pro-7.rotated { width: 1368px; height: 912px; }
      
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
      
      .has-submenu { position: relative; }
      .submenu {
        display: none; position: absolute; right: 100%; top: -5px; 
        background: var(--menu-bg); border: 1px solid var(--menu-border);
        box-shadow: 0 2px 8px rgba(0,0,0,0.3); border-radius: 4px;
        padding: 4px 0; min-width: 170px; margin-right: 4px;
      }

      /* 弹窗通用样式 (收藏夹、历史记录共用) */
      .fav-overlay {
        display: none; position: absolute; top: 0; left: 0; width: 100%; height: 100%;
        background: rgba(0,0,0,0.6); z-index: 100000; justify-content: center; align-items: center;
      }
      .fav-modal {
        background: var(--bg); width: 440px; max-height: 80vh; display: flex; flex-direction: column;
        border: 1px solid var(--border); border-radius: 6px; box-shadow: 0 10px 30px rgba(0,0,0,0.5);
      }
      .fav-header {
        padding: 12px 16px; border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center;
      }
      .fav-header h3 { margin: 0; font-size: 14px; font-weight: bold; color: var(--fg); display: flex; align-items: center; gap: 8px; }
      .fav-header-actions { display: flex; align-items: center; gap: 12px; }
      .fav-sort-select { 
        background: var(--input-bg); color: var(--fg); border: 1px solid var(--input-border);
        padding: 2px 4px; border-radius: 2px; outline: none; font-size: 12px; cursor: pointer;
      }
      .fav-close { cursor: pointer; color: var(--vscode-icon-foreground); transition: 0.2s; font-size: 16px; }
      .fav-close:hover { color: #e74c3c; }
      .fav-form { display: none; padding: 12px 16px; background: var(--menu-bg); border-bottom: 1px solid var(--border); }
      .fav-input {
        width: 100%; box-sizing: border-box; border: 1px solid var(--input-border); background: var(--input-bg); 
        color: var(--input-fg); padding: 6px 8px; margin-bottom: 8px; border-radius: 2px; outline: none; font-size: 12px;
      }
      .fav-input:focus { border-color: var(--focus-border); }
      .fav-form-btns { display: flex; justify-content: flex-end; gap: 8px; }
      .fav-btn {
        background: transparent; color: var(--fg); border: 1px solid var(--border); padding: 4px 12px;
        border-radius: 2px; cursor: pointer; font-size: 12px;
      }
      .fav-btn.primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; }
      .fav-btn:hover { opacity: 0.9; }
      .fav-list { flex: 1; overflow-y: auto; padding: 6px 0; }
      
      /* 🌟 收藏列表项样式调整 */
      .fav-item {
        padding: 10px 16px; 
        border-bottom: 1px solid var(--vscode-panel-border); /* 加深底部的横线 */
        display: flex; 
        justify-content: space-between; align-items: center; cursor: pointer; gap: 12px;
      }
      .fav-item:last-child { border-bottom: none; }
      .fav-item:hover { background: var(--menu-hover-bg); }
      
      /* 历史记录当前项的高亮 */
      .fav-item.current-history { border-left: 3px solid #3498db; background: rgba(255, 255, 255, 0.03); padding-left: 13px; }
      
      .fav-item-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
      
      /* 🌟 标题加粗一点，文字再小一点（设定为 13px） */
      .fav-title { font-size: 13px; font-weight: 600; color: var(--fg); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      
      /* 🌟 下面的链接字体要小一点，颜色是灰色 */
      .fav-url { font-size: 11px; color: var(--vscode-descriptionForeground); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; opacity: 0.8; }
      
      .fav-actions { display: flex; gap: 8px; opacity: 0; transition: opacity 0.2s; align-items: center; }
      .fav-item:hover .fav-actions { opacity: 1; }
      .fav-action-btn { color: var(--vscode-icon-foreground); padding: 4px; border-radius: 4px; font-size: 13px; transition: 0.2s; }
      .fav-action-btn:hover { background: var(--btn-hover); color: var(--fg); }
      .fav-action-btn.delete:hover { color: #e74c3c; }
      .fav-empty { padding: 30px; text-align: center; color: var(--vscode-descriptionForeground); font-size: 13px; }
    </style>
  </head>
  <body>
    <div class="toolbar">
      <button class="icon-btn" id="backBtn" title="后退" disabled><i class="fa-solid fa-arrow-left"></i></button>
      <button class="icon-btn" id="refreshBtn" title="刷新页面"><i class="fa-solid fa-rotate-right"></i></button>
      
      <div class="address-bar-wrapper">
        <img id="siteFavicon" src="" style="display:none; width:14px; height:14px; border-radius:2px; object-fit:contain;" />
        <i id="defaultFavicon" class="fa-solid fa-globe" style="font-size:13px; color:var(--vscode-descriptionForeground);"></i>
        
        <input type="text" id="urlInput" class="address-bar" value="${defaultUrl}" placeholder="输入网址 或 搜索内容" autocomplete="off" spellcheck="false" />
        
        <i class="fa-solid fa-xmark action-icon clear-btn" id="clearBtn" title="清除"></i>
        <i class="fa-regular fa-star action-icon" id="favStarBtn" title="添加/取消收藏 (跨工作区同步)"></i>
        
        <div id="suggestBox" class="suggest-box"></div>
      </div>

      <button class="icon-btn" id="goBtn" title="访问 / 搜索"><i class="fa-solid fa-arrow-right"></i></button>
      
      <div class="divider"></div>

      <select id="deviceSelect" class="vscode-select" title="选择预览设备">
        <optgroup label="响应式">
          <option value="device-responsive">响应式铺满</option>
        </optgroup>
        <optgroup label="Apple">
          <option value="device-iphone-se">iPhone SE</option>
          <option value="device-iphone-xr">iPhone XR</option>
          <option value="device-iphone-12-pro">iPhone 12 Pro</option>
          <option value="device-iphone-14-pro-max">iPhone 14 Pro</option>
        </optgroup>
        <optgroup label="Android">
          <option value="device-pixel-7">Pixel 7</option>
          <option value="device-galaxy-s8-plus">Galaxy S8+</option>
          <option value="device-galaxy-s20-ultra">Galaxy S20</option>
        </optgroup>
        <optgroup label="平板电脑">
          <option value="device-ipad-mini">iPad Mini</option>
          <option value="device-ipad-air">iPad Air</option>
          <option value="device-ipad-pro">iPad Pro</option>
          <option value="device-surface-pro-7">Surface Pro</option>
        </optgroup>
      </select>
      
      <button class="icon-btn" id="rotateBtn" title="横屏/竖屏切换" disabled><i class="fa-solid fa-rotate"></i></button>

      <div class="divider"></div>
      <button class="icon-btn" id="externalBtn" title="在外部默认浏览器中打开" disabled><i class="fa-solid fa-arrow-up-right-from-square"></i></button>
      <button class="icon-btn" id="moreBtn" title="更多操作"><i class="fa-solid fa-ellipsis"></i></button>
    </div>
    
    <div class="preview-container" id="previewContainer">
      <div class="welcome-page" id="welcomePage">
        <i class="fa-solid fa-layer-group welcome-icon"></i>
        <h1 class="welcome-title">Live Preview</h1>
        <p class="welcome-subtitle">在上方地址栏输入您的本地开发服务器地址，或直接输入关键词进行搜索。<br/>您也可以点击下方快捷选项快速填入：</p>
        
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
        <iframe id="previewFrame" src="${defaultUrl}" sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads" allow="clipboard-read; clipboard-write;"></iframe>
      </div>
    </div>

    <div class="fav-overlay" id="favOverlay">
      <div class="fav-modal">
        <div class="fav-header">
          <h3><i class="fa-solid fa-star" style="color: #f1c40f;"></i> 我的收藏夹</h3>
          <div class="fav-header-actions">
            <select id="favSortSelect" class="fav-sort-select">
              <option value="time">按时间 (最新优先)</option>
              <option value="title">按标题 (A-Z)</option>
            </select>
            <i class="fa-solid fa-plus action-icon" id="favAddBtn" title="新增收藏" style="font-size: 15px;"></i>
            <div style="width: 1px; height: 14px; background: var(--border); margin: 0 4px;"></div>
            <i class="fa-solid fa-xmark fav-close" id="favCloseBtn" title="关闭"></i>
          </div>
        </div>
        
        <div class="fav-form" id="favForm">
          <input type="text" id="favFormTitle" class="fav-input" placeholder="输入网站标题" />
          <input type="text" id="favFormUrl" class="fav-input" placeholder="输入规范的网址 (如 https://...)" />
          <div class="fav-form-btns">
            <button class="fav-btn" id="favFormCancel">取消</button>
            <button class="fav-btn primary" id="favFormSave">保存</button>
          </div>
        </div>
        <div class="fav-list" id="favListContainer"></div>
      </div>
    </div>

    <div class="fav-overlay" id="historyOverlay">
      <div class="fav-modal">
        <div class="fav-header">
          <h3><i class="fa-solid fa-clock-rotate-left" style="color: #3498db;"></i> 历史记录</h3>
          <i class="fa-solid fa-xmark fav-close" id="historyCloseBtn" title="关闭"></i>
        </div>
        <div class="fav-list" id="historyListContainer"></div>
      </div>
    </div>

    <div id="actionMenu" class="context-menu">
      <div class="menu-item" id="actionMenuRefresh"><i class="fa-solid fa-rotate-right" style="width:16px;"></i> 刷新页面</div>
      <div class="menu-item" id="actionFavorites"><i class="fa-solid fa-star" style="width:16px; color:#f1c40f;"></i> 打开收藏夹</div>
      <div class="menu-item" id="actionHistory"><i class="fa-solid fa-clock-rotate-left" style="width:16px;"></i> 历史记录</div>
      
      <div class="menu-divider"></div>
      <div class="menu-item has-submenu" id="cacheMenuParent">
        <i class="fa-solid fa-broom" style="width:16px;"></i> 清理页面缓存
        <i class="fa-solid fa-chevron-right" style="margin-left:auto; font-size:10px; opacity:0.7;"></i>
        <div class="submenu" id="cacheSubmenu">
          <div class="menu-item" id="clearLocal"><i class="fa-solid fa-database" style="width:16px;"></i> 清理 LocalStorage</div>
          <div class="menu-item" id="clearSession"><i class="fa-solid fa-box-archive" style="width:16px;"></i> 清理 SessionStorage</div>
          <div class="menu-item" id="clearCookie"><i class="fa-solid fa-cookie-bite" style="width:16px;"></i> 清理 Cookie 数据</div>
        </div>
      </div>

      <div class="menu-divider"></div>
      <div class="menu-item" id="actionDevTools"><i class="fa-solid fa-terminal" style="width:16px;"></i> 开发者工具</div>
      <div class="menu-item" id="actionVConsole" style="color: #2ecc71;"><i class="fa-solid fa-bug" style="width:16px;"></i> 注入 vConsole</div>
    </div>

    <script>
      const vscode = acquireVsCodeApi();
      
      const urlInput = document.getElementById('urlInput');
      const clearBtn = document.getElementById('clearBtn');
      const backBtn = document.getElementById('backBtn');
      const favStarBtn = document.getElementById('favStarBtn');
      const rotateBtn = document.getElementById('rotateBtn'); 
      const externalBtn = document.getElementById('externalBtn'); 
      
      const previewContainer = document.getElementById('previewContainer');
      const previewFrame = document.getElementById('previewFrame');
      const goBtn = document.getElementById('goBtn');
      const refreshBtn = document.getElementById('refreshBtn');
      const deviceSelect = document.getElementById('deviceSelect');
      const deviceWrapper = document.getElementById('deviceWrapper');
      
      const siteFavicon = document.getElementById('siteFavicon');
      const defaultFavicon = document.getElementById('defaultFavicon');
      const welcomePage = document.getElementById('welcomePage');

      const moreBtn = document.getElementById('moreBtn');
      const actionMenu = document.getElementById('actionMenu');
      const actionMenuRefresh = document.getElementById('actionMenuRefresh');
      const actionFavorites = document.getElementById('actionFavorites');
      const actionHistory = document.getElementById('actionHistory');
      const actionDevTools = document.getElementById('actionDevTools');
      const actionVConsole = document.getElementById('actionVConsole');

      const favOverlay = document.getElementById('favOverlay');
      const favCloseBtn = document.getElementById('favCloseBtn');
      const favListContainer = document.getElementById('favListContainer');
      const favAddBtn = document.getElementById('favAddBtn');
      const favSortSelect = document.getElementById('favSortSelect');
      const favForm = document.getElementById('favForm');
      const favFormTitle = document.getElementById('favFormTitle');
      const favFormUrl = document.getElementById('favFormUrl');
      const favFormCancel = document.getElementById('favFormCancel');
      const favFormSave = document.getElementById('favFormSave');

      const historyOverlay = document.getElementById('historyOverlay');
      const historyCloseBtn = document.getElementById('historyCloseBtn');
      const historyListContainer = document.getElementById('historyListContainer');

      let globalFavorites = [];
      let isRotated = false;
      let editingOriginalUrl = null; 

      // ================= 🌟 历史记录栈逻辑 =================
      let historyStack = [];
      let currentHistoryIdx = -1;
      let isInternalNav = false;

      function getFrameTitleFromUrl(url) {
        try { return new URL(url).hostname; } 
        catch(e) { return url; }
      }

      function pushHistory(url) {
        if (isInternalNav) { isInternalNav = false; return; }
        if (currentHistoryIdx > -1 && historyStack[currentHistoryIdx].url === url) return;

        historyStack = historyStack.slice(0, currentHistoryIdx + 1);
        historyStack.push({ url: url, title: 'Navigating...', timestamp: Date.now() });
        currentHistoryIdx++;
        updateBackBtn();

        setTimeout(() => {
          try {
             const doc = previewFrame.contentDocument || previewFrame.contentWindow.document;
             if(doc && doc.title) historyStack[currentHistoryIdx].title = doc.title;
             else historyStack[currentHistoryIdx].title = getFrameTitleFromUrl(url);
          } catch(e) {
             historyStack[currentHistoryIdx].title = getFrameTitleFromUrl(url);
          }
        }, 100); 
      }

      function updateBackBtn() {
        if (currentHistoryIdx > 0) backBtn.removeAttribute('disabled');
        else backBtn.setAttribute('disabled', 'true');
      }

      function navigateToHistoryIndex(index) {
        if (index < 0 || index >= historyStack.length) return;
        currentHistoryIdx = index;
        isInternalNav = true;
        const targetUrl = historyStack[currentHistoryIdx].url;
        urlInput.value = targetUrl;
        updateBackBtn();
        toggleClearBtn();
        executeNavigation(targetUrl);
      }

      backBtn.addEventListener('click', () => {
        if (currentHistoryIdx > 0) {
          navigateToHistoryIndex(currentHistoryIdx - 1);
        }
      });

      // 历史记录弹窗渲染
      function renderHistoryList() {
        historyListContainer.innerHTML = '';
        if (historyStack.length === 0) {
          historyListContainer.innerHTML = '<div class="fav-empty">暂无历史记录</div>';
          return;
        }

        // 倒序渲染，最新的在最上面
        for (let i = historyStack.length - 1; i >= 0; i--) {
          const entry = historyStack[i];
          const div = document.createElement('div');
          div.className = 'fav-item';
          
          if (i === currentHistoryIdx) {
            div.classList.add('current-history');
          }
          
          div.innerHTML = \`
            <div class="fav-item-info">
              <div class="fav-title" title="\${entry.title}">\${entry.title} \${i === currentHistoryIdx ? '(当前)' : ''}</div>
              <div class="fav-url" title="\${entry.url}">\${entry.url}</div>
            </div>
          \`;

          div.addEventListener('click', () => {
            historyOverlay.style.display = 'none';
            if (i !== currentHistoryIdx) {
              navigateToHistoryIndex(i);
            }
          });
          
          historyListContainer.appendChild(div);
        }
      }

      actionHistory.addEventListener('click', () => {
        closeMenu();
        renderHistoryList();
        historyOverlay.style.display = 'flex';
      });

      historyCloseBtn.addEventListener('click', () => {
        historyOverlay.style.display = 'none';
      });


      // ================= 智能下拉联想逻辑 =================
      const suggestBox = document.getElementById('suggestBox');
      let selectedSuggestIndex = -1;
      let currentSuggestions = [];

      function escapeRegExp(string) { return string.replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\\\$&'); }
      function getHighlightedText(text, query) {
        if (!query) return text;
        const regex = new RegExp(\`(\${escapeRegExp(query)})\`, 'gi');
        return text.replace(regex, '<span class="highlight-match">$1</span>');
      }

      function closeSuggestBox() {
        suggestBox.style.display = 'none';
        currentSuggestions = [];
        selectedSuggestIndex = -1;
      }

      function updateSuggestSelection() {
        const items = suggestBox.querySelectorAll('.suggest-item');
        items.forEach((item, index) => {
          if (index === selectedSuggestIndex) {
            item.classList.add('selected');
            item.scrollIntoView({ block: 'nearest' }); 
          } else {
            item.classList.remove('selected');
          }
        });
      }

      function renderSuggestBox(query) {
        suggestBox.innerHTML = '';
        selectedSuggestIndex = -1;

        currentSuggestions.forEach((item, index) => {
          const div = document.createElement('div');
          div.className = 'suggest-item';
          div.innerHTML = \`
            <div class="suggest-title">\${getHighlightedText(item.title, query)}</div>
            <div class="suggest-url">\${getHighlightedText(item.url, query)}</div>
          \`;
          
          div.addEventListener('mouseenter', () => {
            selectedSuggestIndex = index;
            updateSuggestSelection();
          });

          div.addEventListener('click', () => {
            urlInput.value = item.url;
            toggleClearBtn();
            closeSuggestBox();
            loadUrl();
          });
          suggestBox.appendChild(div);
        });
        suggestBox.style.display = 'flex';
      }

      urlInput.addEventListener('input', () => {
        toggleClearBtn();
        const query = urlInput.value.trim().toLowerCase();
        if (!query || globalFavorites.length === 0) { closeSuggestBox(); return; }

        currentSuggestions = globalFavorites.filter(f => 
          f.title.toLowerCase().includes(query) || f.url.toLowerCase().includes(query)
        );
        if (currentSuggestions.length === 0) { closeSuggestBox(); return; }
        renderSuggestBox(query);
      });

      urlInput.addEventListener('keydown', (e) => { 
        if (e.isComposing || e.keyCode === 229) return;

        if (suggestBox.style.display === 'flex') {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            selectedSuggestIndex = (selectedSuggestIndex + 1) % currentSuggestions.length;
            updateSuggestSelection(); return;
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            selectedSuggestIndex = (selectedSuggestIndex - 1 + currentSuggestions.length) % currentSuggestions.length;
            updateSuggestSelection(); return;
          } else if (e.key === 'Escape') {
            e.preventDefault(); closeSuggestBox(); return;
          }
        }

        if (e.key === 'Enter') {
          e.preventDefault();
          if (suggestBox.style.display === 'flex' && selectedSuggestIndex > -1) {
            urlInput.value = currentSuggestions[selectedSuggestIndex].url;
          }
          toggleClearBtn();
          closeSuggestBox();
          loadUrl(); 
        }
      });


      // ================= 🌟 收藏夹增删改与列表渲染逻辑 =================
      function updateFavStarState() {
        const currentUrl = previewFrame.src;
        if (!currentUrl || currentUrl === 'about:blank') {
          favStarBtn.className = 'fa-regular fa-star action-icon';
          favStarBtn.style.color = ''; return;
        }
        const isFav = globalFavorites.some(f => f.url === currentUrl);
        if (isFav) {
          favStarBtn.className = 'fa-solid fa-star action-icon';
          favStarBtn.style.color = '#f1c40f'; 
        } else {
          favStarBtn.className = 'fa-regular fa-star action-icon';
          favStarBtn.style.color = ''; 
        }
      }

      favStarBtn.addEventListener('click', () => {
        const url = previewFrame.src;
        if (!url || url === 'about:blank') return;
        let title = url;
        try { title = previewFrame.contentDocument?.title || urlInput.value; } catch(e) {}
        vscode.postMessage({ type: 'toggleFavorite', url: url, title: title });
      });

      actionFavorites.addEventListener('click', () => {
        closeMenu();
        favForm.style.display = 'none';
        renderFavList();
        favOverlay.style.display = 'flex';
      });

      favCloseBtn.addEventListener('click', () => { favOverlay.style.display = 'none'; });
      favSortSelect.addEventListener('change', () => { renderFavList(); });

      favAddBtn.addEventListener('click', () => {
        editingOriginalUrl = null;
        favFormTitle.value = '';
        favFormUrl.value = '';
        favForm.style.display = 'block';
        favFormTitle.focus();
      });

      favFormCancel.addEventListener('click', () => { favForm.style.display = 'none'; });

      function isUrlLike(str) {
        return /^(https?:\\/\\/|file:\\/\\/)?(localhost|\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}|([a-zA-Z0-9-]+\\.)+[a-zA-Z]{2,})(:\\d+)?(\\/.*)?$/i.test(str);
      }

      favFormSave.addEventListener('click', () => {
        const t = favFormTitle.value.trim();
        let u = favFormUrl.value.trim();
        
        if (!t || !u) { vscode.postMessage({ type: 'showError', message: '标题和链接不能为空' }); return; }
        if (!isUrlLike(u)) { vscode.postMessage({ type: 'showError', message: '请输入有效的网址格式' }); return; }
        if (!u.startsWith('http://') && !u.startsWith('https://') && !u.startsWith('file://')) u = 'http://' + u;

        if (editingOriginalUrl) {
          const index = globalFavorites.findIndex(f => f.url === editingOriginalUrl);
          if (index > -1) {
            if (u !== editingOriginalUrl && globalFavorites.some(f => f.url === u)) {
              vscode.postMessage({ type: 'showError', message: '该链接已存在！' }); return;
            }
            globalFavorites[index].title = t;
            globalFavorites[index].url = u;
          }
        } else {
          if (globalFavorites.some(f => f.url === u)) {
            vscode.postMessage({ type: 'showError', message: '该链接已存在！' }); return;
          }
          globalFavorites.push({ url: u, title: t, timestamp: Date.now() });
        }
        vscode.postMessage({ type: 'saveAllFavorites', favorites: globalFavorites });
        favForm.style.display = 'none';
      });

      function renderFavList() {
        favListContainer.innerHTML = '';
        if (globalFavorites.length === 0) {
          favListContainer.innerHTML = '<div class="fav-empty">暂无收藏。点击右上角 + 号，或地址栏星号添加。</div>'; return;
        }
        
        let listToRender = [...globalFavorites].map(item => ({ ...item, timestamp: item.timestamp || 0 }));
        if (favSortSelect.value === 'time') listToRender.sort((a, b) => b.timestamp - a.timestamp);
        else if (favSortSelect.value === 'title') listToRender.sort((a, b) => a.title.localeCompare(b.title, 'zh-CN'));

        listToRender.forEach(item => {
          const div = document.createElement('div');
          div.className = 'fav-item';
          
          const infoDiv = document.createElement('div');
          infoDiv.className = 'fav-item-info';
          infoDiv.innerHTML = \`<div class="fav-title" title="\${item.title}">\${item.title}</div><div class="fav-url" title="\${item.url}">\${item.url}</div>\`;
          
          const actionsDiv = document.createElement('div');
          actionsDiv.className = 'fav-actions';
          // 🌟 增加复制按钮
          actionsDiv.innerHTML = \`
            <i class="fa-regular fa-copy fav-action-btn copy" title="复制链接"></i>
            <i class="fa-solid fa-pen fav-action-btn edit" title="编辑"></i>
            <i class="fa-solid fa-trash fav-action-btn delete" title="删除"></i>
          \`;

          // 点击整体跳转
          infoDiv.addEventListener('click', () => {
            favOverlay.style.display = 'none';
            urlInput.value = item.url;
            toggleClearBtn(); loadUrl();
          });
          
          // 🌟 复制按钮事件
          actionsDiv.querySelector('.copy').addEventListener('click', (e) => {
            e.stopPropagation();
            
            // 尝试使用剪贴板API，如果失败则使用后备方案
            const copyToClipboard = str => {
              if (navigator && navigator.clipboard && navigator.clipboard.writeText) {
                return navigator.clipboard.writeText(str);
              }
              return Promise.reject('The Clipboard API is not available.');
            };

            copyToClipboard(item.url).then(() => {
              // 复制成功，视觉反馈：变绿对勾
              const icon = e.target;
              icon.className = 'fa-solid fa-check fav-action-btn copy';
              icon.style.color = '#2ecc71';
              setTimeout(() => {
                icon.className = 'fa-regular fa-copy fav-action-btn copy';
                icon.style.color = '';
              }, 1500);
            }).catch(() => {
               // 降级方案
               const input = document.createElement('input');
               input.value = item.url;
               document.body.appendChild(input);
               input.select();
               document.execCommand('copy');
               document.body.removeChild(input);
               
               const icon = e.target;
               icon.className = 'fa-solid fa-check fav-action-btn copy';
               icon.style.color = '#2ecc71';
               setTimeout(() => {
                 icon.className = 'fa-regular fa-copy fav-action-btn copy';
                 icon.style.color = '';
               }, 1500);
            });
          });

          // 编辑按钮事件
          actionsDiv.querySelector('.edit').addEventListener('click', (e) => {
            e.stopPropagation();
            editingOriginalUrl = item.url;
            favFormTitle.value = item.title;
            favFormUrl.value = item.url;
            favForm.style.display = 'block';
            favFormTitle.focus();
          });

          // 删除按钮事件
          actionsDiv.querySelector('.delete').addEventListener('click', (e) => {
            e.stopPropagation();
            globalFavorites = globalFavorites.filter(f => f.url !== item.url);
            vscode.postMessage({ type: 'saveAllFavorites', favorites: globalFavorites });
          });

          div.appendChild(infoDiv); div.appendChild(actionsDiv);
          favListContainer.appendChild(div);
        });
      }


      // ================= 缓存清理与弹窗逻辑 =================
      const cacheMenuParent = document.getElementById('cacheMenuParent');
      const cacheSubmenu = document.getElementById('cacheSubmenu');
      let submenuTimer = null;

      cacheMenuParent.addEventListener('mouseenter', () => {
        clearTimeout(submenuTimer);
        cacheSubmenu.style.display = 'block';
      });

      cacheMenuParent.addEventListener('mouseleave', () => {
        submenuTimer = setTimeout(() => { cacheSubmenu.style.display = 'none'; }, 1000); 
      });

      function clearIframeStorage(type) {
        try {
          const win = previewFrame.contentWindow;
          if (!win) throw new Error("No Access");
          if (type === 'local') win.localStorage.clear();
          else if (type === 'session') win.sessionStorage.clear();
          else if (type === 'cookie') {
            const cookies = win.document.cookie.split(";");
            for (let i = 0; i < cookies.length; i++) {
              const cookie = cookies[i];
              const eqPos = cookie.indexOf("=");
              const name = eqPos > -1 ? cookie.substr(0, eqPos) : cookie;
              win.document.cookie = name + "=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/";
            }
          }
          vscode.postMessage({ type: 'showInfo', message: '✅ 缓存清理成功！' });
          doRefresh();
        } catch(e) {
          vscode.postMessage({ type: 'showWarning', message: '⚠️ 跨域安全限制，请在开发者工具中手动清理。' });
        }
        closeMenu();
      }

      document.getElementById('clearLocal').addEventListener('click', (e) => { e.stopPropagation(); clearIframeStorage('local'); });
      document.getElementById('clearSession').addEventListener('click', (e) => { e.stopPropagation(); clearIframeStorage('session'); });
      document.getElementById('clearCookie').addEventListener('click', (e) => { e.stopPropagation(); clearIframeStorage('cookie'); });

      rotateBtn.addEventListener('click', () => {
        isRotated = !isRotated;
        if(isRotated) { deviceWrapper.classList.add('rotated'); rotateBtn.style.color = '#3498db'; } 
        else { deviceWrapper.classList.remove('rotated'); rotateBtn.style.color = ''; }
      });

      function toggleClearBtn() {
        const val = urlInput.value;
        clearBtn.style.display = val.length > 0 ? 'block' : 'none';
        if (val.trim().length > 0) externalBtn.removeAttribute('disabled');
        else externalBtn.setAttribute('disabled', 'true');
      }
      
      clearBtn.addEventListener('click', () => {
        urlInput.value = '';
        toggleClearBtn(); closeSuggestBox(); urlInput.focus(); 
      });

      window.fillAndGo = function(targetUrl) {
        urlInput.value = targetUrl;
        toggleClearBtn(); closeSuggestBox(); loadUrl();
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
          welcomePage.style.display = 'flex'; deviceWrapper.style.display = 'none'; previewFrame.src = 'about:blank';
          updateFavicon(''); updateFavStarState(); vscode.postMessage({ type: 'saveUrl', url: '' }); return;
        }
        let finalUrl = rawInput;
        if (isUrlLike(rawInput)) {
          if (!rawInput.startsWith('http://') && !rawInput.startsWith('https://') && !rawInput.startsWith('file://')) {
            finalUrl = 'http://' + rawInput; urlInput.value = finalUrl;
          }
        } else {
          finalUrl = 'https://www.bing.com/search?q=' + encodeURIComponent(rawInput);
        }
        executeNavigation(finalUrl);
      }

      function executeNavigation(finalUrl) {
        welcomePage.style.display = 'none';
        deviceWrapper.style.display = 'block';
        previewFrame.src = finalUrl;
        updateFavicon(finalUrl); 
        pushHistory(finalUrl); 
        setTimeout(updateFavStarState, 100);
        vscode.postMessage({ type: 'saveUrl', url: finalUrl });
      }

      function doRefresh() {
        if (!urlInput.value.trim()) return; 
        const currentUrl = previewFrame.src;
        previewFrame.src = 'about:blank';
        setTimeout(() => { previewFrame.src = currentUrl; }, 10);
        closeMenu();
      }

      externalBtn.addEventListener('click', () => {
        let url = urlInput.value.trim();
        if (!url) return;
        if (isUrlLike(url)) { if (!url.startsWith('http://') && !url.startsWith('https://')) url = 'http://' + url; } 
        else url = 'https://www.bing.com/search?q=' + encodeURIComponent(url);
        vscode.postMessage({ type: 'openExternalBrowser', url: url });
      });

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
        } catch (e) { vscode.postMessage({ type: 'vConsoleFallback' }); }
        closeMenu();
      }

      function doOpenDevTools() { vscode.postMessage({ type: 'openDevTools' }); closeMenu(); }

      function openMenu(x, y) {
        actionMenu.style.display = 'block';
        const menuWidth = actionMenu.offsetWidth;
        if (x + menuWidth > window.innerWidth) actionMenu.style.left = (window.innerWidth - menuWidth - 10) + 'px';
        else actionMenu.style.left = x + 'px';
        actionMenu.style.top = y + 'px';
      }

      function closeMenu() { 
        actionMenu.style.display = 'none'; 
        cacheSubmenu.style.display = 'none';
        clearTimeout(submenuTimer);
      }

      moreBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (actionMenu.style.display === 'block') closeMenu();
        else { const rect = moreBtn.getBoundingClientRect(); openMenu(rect.left - 180, rect.bottom + 5); }
      });
      
      window.addEventListener('click', (e) => { 
        if (!e.target.closest('#actionMenu') && !e.target.closest('#moreBtn')) closeMenu(); 
        if (!e.target.closest('.address-bar-wrapper')) closeSuggestBox();
      });

      goBtn.addEventListener('click', () => { closeSuggestBox(); loadUrl(); });
      refreshBtn.addEventListener('click', doRefresh);
      actionMenuRefresh.addEventListener('click', doRefresh);
      actionDevTools.addEventListener('click', doOpenDevTools);
      actionVConsole.addEventListener('click', doInjectVConsole);

      deviceSelect.addEventListener('change', (e) => {
        deviceWrapper.className = e.target.value;
        if (isRotated && e.target.value !== 'device-responsive') deviceWrapper.classList.add('rotated');
        if (e.target.value === 'device-responsive') {
          previewContainer.classList.add('no-padding'); rotateBtn.setAttribute('disabled', 'true');
        } else {
          previewContainer.classList.remove('no-padding'); rotateBtn.removeAttribute('disabled');
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
              previewContainer.classList.add('no-padding'); rotateBtn.setAttribute('disabled', 'true');
            } else rotateBtn.removeAttribute('disabled');
          }
          if (urlInput.value.trim()) {
            updateFavicon(urlInput.value);
            pushHistory(urlInput.value.trim()); 
          }
          vscode.postMessage({ type: 'reqSyncFavorites' });
        }
        if (message.type === 'syncFavorites') {
          globalFavorites = message.favorites || [];
          updateFavStarState();
          if (favOverlay.style.display === 'flex') renderFavList(); 
          if (suggestBox.style.display === 'flex' && urlInput.value.trim()) urlInput.dispatchEvent(new Event('input'));
        }
      });
      
      if ('${defaultUrl}'.trim()) updateFavicon('${defaultUrl}');
      toggleClearBtn(); 
      
    </script>
  </body>
  </html>`;
}
