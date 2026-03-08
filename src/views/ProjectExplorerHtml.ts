export function getLivePreviewHtml(defaultUrl: string): string {
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
      
      .toolbar { display: flex; padding: 6px 10px; background: var(--bg); border-bottom: 1px solid var(--border); gap: 6px; align-items: center; flex-shrink: 0; }
      .address-bar-wrapper { flex: 1; min-width: 150px; padding: 4px 8px; border: 1px solid var(--input-border); background: var(--input-bg); border-radius: 2px; display: flex; align-items: center; gap: 8px; transition: border-color 0.2s; position: relative; }
      .address-bar-wrapper:focus-within { border-color: var(--focus-border); }
      .address-bar { flex: 1; border: none; background: transparent; color: var(--input-fg); outline: none; font-family: var(--vscode-editor-font-family, monospace); font-size: 12px; padding: 0; min-width: 0; }
      
      .suggest-box { display: none; position: absolute; top: 100%; left: 0; width: 100%; margin-top: 4px; background: var(--menu-bg); border: 1px solid var(--menu-border); border-radius: 4px; box-shadow: 0 6px 16px rgba(0,0,0,0.4); z-index: 100000; flex-direction: column; max-height: 280px; overflow-y: auto; }
      .suggest-item { padding: 8px 12px; border-bottom: 1px solid var(--menu-border); cursor: pointer; display: flex; flex-direction: column; gap: 4px; transition: background 0.1s; }
      .suggest-item:last-child { border-bottom: none; }
      .suggest-item:hover, .suggest-item.selected { background: var(--menu-hover-bg); }
      .suggest-title { font-size: 13px; color: var(--fg); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500; }
      .suggest-url { font-size: 11px; color: var(--vscode-descriptionForeground); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .highlight-match { color: #5dade2; font-weight: bold; }

      .action-icon { color: var(--vscode-icon-foreground); cursor: pointer; font-size: 14px; padding: 0 4px; opacity: 0.7; transition: opacity 0.2s, color 0.2s; }
      .action-icon:hover { opacity: 1; color: var(--fg); }
      .clear-btn { display: none; }
      
      .icon-btn { background: transparent; color: var(--vscode-icon-foreground); border: none; padding: 4px 6px; border-radius: 4px; cursor: pointer; font-size: 14px; display: inline-flex; align-items: center; justify-content: center; outline: none; transition: 0.1s; }
      .icon-btn:hover { background: var(--btn-hover); color: var(--fg); }
      .icon-btn:disabled { opacity: 0.3; cursor: not-allowed; background: transparent !important; color: var(--vscode-icon-foreground) !important; }
      
      .vscode-select { background: var(--input-bg); color: var(--input-fg); border: 1px solid var(--input-border); padding: 4px; border-radius: 2px; outline: none; cursor: pointer; font-size: 12px; }
      .vscode-select:focus { border-color: var(--focus-border); }
      #deviceSelect { width: 125px; text-overflow: ellipsis; overflow: hidden; white-space: nowrap; }

      .divider { width: 1px; height: 18px; background: var(--border); margin: 0 2px; }
      .preview-container { flex: 1; overflow: auto; display: flex; justify-content: center; align-items: flex-start; padding: 20px; position: relative; transition: padding 0.3s ease; }
      .preview-container.no-padding { padding: 0 !important; }
      
      #deviceWrapper { display: ${hasUrl ? 'block' : 'none'}; background: #fff; transition: width 0.3s ease, height 0.3s ease; box-shadow: 0 4px 16px rgba(0,0,0,0.4); border-radius: 2px; overflow: hidden; position: relative; z-index: 2; }
      .device-responsive { width: 100%; height: 100%; box-shadow: none !important; border-radius: 0 !important; }
      .device-iphone-se { width: 375px; height: 667px; } .device-iphone-se.rotated { width: 667px; height: 375px; }
      .device-iphone-xr { width: 414px; height: 896px; } .device-iphone-xr.rotated { width: 896px; height: 414px; }
      .device-iphone-12-pro { width: 390px; height: 844px; } .device-iphone-12-pro.rotated { width: 844px; height: 390px; }
      .device-iphone-14-pro-max { width: 430px; height: 932px; } .device-iphone-14-pro-max.rotated { width: 932px; height: 430px; }
      .device-pixel-7 { width: 412px; height: 915px; } .device-pixel-7.rotated { width: 915px; height: 412px; }
      .device-galaxy-s8-plus { width: 360px; height: 740px; } .device-galaxy-s8-plus.rotated { width: 740px; height: 360px; }
      .device-galaxy-s20-ultra { width: 412px; height: 915px; } .device-galaxy-s20-ultra.rotated { width: 915px; height: 412px; }
      .device-ipad-mini { width: 768px; height: 1024px; } .device-ipad-mini.rotated { width: 1024px; height: 768px; }
      .device-ipad-air { width: 820px; height: 1180px; } .device-ipad-air.rotated { width: 1180px; height: 820px; }
      .device-ipad-pro { width: 1024px; height: 1366px; } .device-ipad-pro.rotated { width: 1366px; height: 1024px; }
      .device-surface-pro-7 { width: 912px; height: 1368px; } .device-surface-pro-7.rotated { width: 1368px; height: 912px; }
      
      iframe { width: 100%; height: 100%; border: none; background: #fff; display: block; }

      .welcome-page { display: ${hasUrl ? 'none' : 'flex'}; position: absolute; top: 0; left: 0; width: 100%; height: 100%; flex-direction: column; align-items: center; justify-content: center; background-color: var(--bg); z-index: 1; padding: 20px; box-sizing: border-box; }
      .welcome-icon { font-size: 56px; color: var(--vscode-descriptionForeground); margin-bottom: 24px; opacity: 0.5; }
      .welcome-title { font-size: 24px; font-weight: 300; margin-bottom: 12px; color: var(--fg); }
      .welcome-subtitle { font-size: 13px; color: var(--vscode-descriptionForeground); margin-bottom: 32px; text-align: center; max-width: 400px; line-height: 1.6; }
      
      .quick-links { display: flex; flex-direction: column; gap: 12px; width: 100%; max-width: 300px; }
      .quick-link-btn { display: flex; align-items: center; gap: 12px; padding: 10px 16px; background: var(--vscode-button-secondaryBackground, rgba(255,255,255,0.05)); color: var(--vscode-button-secondaryForeground, var(--fg)); border: 1px solid var(--border); border-radius: 4px; cursor: pointer; font-size: 13px; transition: all 0.15s; outline: none; text-align: left; }
      .quick-link-btn i { font-size: 16px; opacity: 0.8; width: 20px; text-align: center; }
      .quick-link-btn:hover { background: var(--vscode-button-secondaryHoverBackground, rgba(255,255,255,0.1)); border-color: var(--focus-border); }

      .context-menu { display: none; position: absolute; z-index: 9999; background: var(--menu-bg); border: 1px solid var(--menu-border); box-shadow: 0 2px 8px rgba(0,0,0,0.3); border-radius: 4px; padding: 4px 0; min-width: 180px; }
      .menu-item { padding: 6px 12px; font-size: 12px; color: var(--menu-fg); cursor: pointer; display: flex; align-items: center; gap: 8px; }
      .menu-item:hover { background: var(--menu-hover-bg); color: var(--menu-hover-fg); }
      .menu-divider { height: 1px; background: var(--menu-border); margin: 4px 0; }
      .has-submenu { position: relative; }
      .submenu { display: none; position: absolute; right: 100%; top: -5px; background: var(--menu-bg); border: 1px solid var(--menu-border); box-shadow: 0 2px 8px rgba(0,0,0,0.3); border-radius: 4px; padding: 4px 0; min-width: 170px; margin-right: 4px; }

      .fav-overlay { display: none; position: absolute; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.6); z-index: 100000; justify-content: center; align-items: center; }
      .fav-modal { background: var(--bg); width: 440px; max-height: 80vh; display: flex; flex-direction: column; border: 1px solid var(--border); border-radius: 6px; box-shadow: 0 10px 30px rgba(0,0,0,0.5); }
      .fav-header { padding: 12px 16px; border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center; }
      .fav-header h3 { margin: 0; font-size: 14px; font-weight: bold; color: var(--fg); display: flex; align-items: center; gap: 8px; }
      .fav-header-actions { display: flex; align-items: center; gap: 12px; }
      .fav-sort-select { background: var(--input-bg); color: var(--fg); border: 1px solid var(--input-border); padding: 2px 4px; border-radius: 2px; outline: none; font-size: 12px; cursor: pointer; }
      .fav-close { cursor: pointer; color: var(--vscode-icon-foreground); transition: 0.2s; font-size: 16px; }
      .fav-close:hover { color: #e74c3c; }
      .fav-form { display: none; padding: 12px 16px; background: var(--menu-bg); border-bottom: 1px solid var(--border); }
      .fav-input { width: 100%; box-sizing: border-box; border: 1px solid var(--input-border); background: var(--input-bg); color: var(--input-fg); padding: 6px 8px; margin-bottom: 8px; border-radius: 2px; outline: none; font-size: 12px; }
      .fav-input:focus { border-color: var(--focus-border); }
      .fav-form-btns { display: flex; justify-content: flex-end; gap: 8px; }
      .fav-btn { background: transparent; color: var(--fg); border: 1px solid var(--border); padding: 4px 12px; border-radius: 2px; cursor: pointer; font-size: 12px; }
      .fav-btn.primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; }
      .fav-btn:hover { opacity: 0.9; }
      .fav-list { flex: 1; overflow-y: auto; padding: 6px 0; }
      .fav-item { padding: 8px 16px; border-bottom: 1px solid var(--menu-border); display: flex; justify-content: space-between; align-items: center; cursor: pointer; gap: 12px; }
      .fav-item:hover { background: var(--menu-hover-bg); }
      .fav-item.current-history { border-left: 3px solid #3498db; background: rgba(255, 255, 255, 0.03); padding-left: 13px; }
      .fav-item-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
      .fav-actions { display: flex; gap: 8px; opacity: 0; transition: opacity 0.2s; }
      .fav-item:hover .fav-actions { opacity: 1; }
      .fav-action-btn { color: var(--vscode-icon-foreground); padding: 4px; border-radius: 4px; font-size: 13px; }
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
        <optgroup label="响应式"><option value="device-responsive">响应式铺满</option></optgroup>
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

    <script>
      (function() {
        const vscode = acquireVsCodeApi();
        
        // 你的其他 JavaScript 逻辑（变量声明、事件监听等）保持完全不变地放在这里。
        // 通过立即执行函数 (IIFE) 包裹，避免全局变量泄露。
        
        // 此处只做演示，实际请把你提供的全部内部 JS 代码原封不动贴在这里...
        
      })();
    </script>
  </body>
  </html>`;
}