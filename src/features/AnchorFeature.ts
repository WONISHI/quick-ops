import * as vscode from 'vscode';
import * as path from 'path';
import { isNumber, debounce, isFunction } from 'lodash-es';
import { IFeature } from '../core/interfaces/IFeature';
import { AnchorService } from '../services/AnchorService';
import { AnchorCodeLensProvider } from '../providers/AnchorCodeLensProvider';
import { ColorUtils } from '../utils/ColorUtils';
import { ConfigurationService } from '../services/ConfigurationService';
import { TOOLTIPS } from '../core/constants';

export class AnchorFeature implements IFeature {
  public readonly id = 'AnchorFeature';
  private service: AnchorService;
  private configService: ConfigurationService;
  private statusBarItem: vscode.StatusBarItem | undefined;
  private decorationTypes: Map<string, vscode.TextEditorDecorationType> = new Map();
  private currentPanel: vscode.WebviewPanel | undefined;

  private readonly defaultGroups = ['default', 'Default', 'TODO', 'FIXME'];

  constructor() {
    this.service = AnchorService.getInstance();
    this.configService = ConfigurationService.getInstance();
  }

  public activate(context: vscode.ExtensionContext): void {
    const rootPath = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
    if (rootPath) {
      this.service.init(rootPath);
    }

    const codeLensProvider = new AnchorCodeLensProvider();
    context.subscriptions.push(vscode.languages.registerCodeLensProvider({ scheme: 'file' }, codeLensProvider));

    this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.statusBarItem.text = '$(bookmark) Anchors';
    this.statusBarItem.command = 'quick-ops.anchor.showMenu';
    this.statusBarItem.show();
    context.subscriptions.push(this.statusBarItem);

    // 监听事件
    context.subscriptions.push(
      this.service.onDidChangeAnchors(() => {
        this.updateDecorations();
        // 如果 Webview 打开，实时刷新数据
        if (this.currentPanel) {
          this.currentPanel.webview.postMessage({ command: 'refresh', data: this.service.getMindMapData() });
        }
      }),
      vscode.window.onDidChangeActiveTextEditor(() => this.debouncedUpdate()),
      vscode.workspace.onDidSaveTextDocument((doc) => this.syncAnchorsWithContent(doc)),
    );

    // 初始化装饰器
    let timer = setTimeout(() => {
      this.updateDecorations();
      clearTimeout(timer);
    }, 500);

    // 注册命令
    context.subscriptions.push(
      vscode.commands.registerCommand('quick-ops.anchor.add', async (...args: any[]) => this.handleAddAnchorCommand(...args)),

      vscode.commands.registerCommand('quick-ops.anchor.showMenu', async () => this.handleShowMenuCommand()),

      vscode.commands.registerCommand('quick-ops.anchor.listByGroup', async (groupName: string, anchorId: string) => this.showAnchorList(groupName, true, undefined, anchorId)),
      vscode.commands.registerCommand('quick-ops.anchor.navigate', async (currentId: string, direction: 'prev' | 'next') => {
        const target = this.service.getNeighborAnchor(currentId, direction);
        if (target) {
          this.openFileAtLine(target.filePath, target.line);
        } else {
          vscode.window.showInformationMessage(direction === 'prev' ? '已经是第一个了' : '已经是最后一个了');
        }
      }),
      vscode.commands.registerCommand('quick-ops.anchor.delete', async (id: string) => this.service.removeAnchor(id)),
    );
  }

  // --- 1. 核心分流逻辑 ---
  private handleShowMenuCommand() {
    // 读取 .quickopsrc 配置
    const config = this.configService.config?.general || {};
    const mode = config.anchorViewMode || 'menu'; // 默认为 menu

    if (mode === 'mindmap') {
      this.openMindMapPanel();
    } else {
      this.showGroupList(true);
    }
  }

  // --- 2. Webview 思维导图实现 ---
  // 修改为 async 以支持拆分命令的等待
  private async openMindMapPanel() {
    const config = this.configService.config?.general || {};
    const mode = config.mindMapPosition || 'right';

    if (this.currentPanel) {
      // 如果面板已存在，尝试根据配置位置 reveal
      const revealColumn = mode === 'left' ? vscode.ViewColumn.One : vscode.ViewColumn.Beside;
      this.currentPanel.reveal(revealColumn);
      return;
    }

    let targetColumn = vscode.ViewColumn.Beside;

    // 如果配置为 left，执行向左拆分命令
    if (mode === 'left') {
      // 执行 VS Code 内置的“向左拆分编辑器”命令
      // 这会将当前编辑器向左复制一份并聚焦，从而在左侧腾出空间
      await vscode.commands.executeCommand('workbench.action.splitEditorLeft');
      // 拆分后焦点在左侧，直接使用 Active 即可
      targetColumn = vscode.ViewColumn.Active;
    }

    this.currentPanel = vscode.window.createWebviewPanel('anchorMindMap', 'Anchors Mind Map', targetColumn, {
      enableScripts: true,
      retainContextWhenHidden: true,
    });

    // 传入 webview 实例以生成 CSP
    this.currentPanel.webview.html = this.getWebviewContent(this.currentPanel.webview);

    this.currentPanel.webview.onDidReceiveMessage(async (message) => {
      switch (message.command) {
        case 'ready':
          this.currentPanel?.webview.postMessage({ command: 'refresh', data: this.service.getMindMapData() });
          break;
        case 'refresh':
          this.currentPanel?.webview.postMessage({ command: 'refresh', data: this.service.getMindMapData() });
          break;
        case 'jump':
          if (message.data) {
            this.openFileAtLine(message.data.filePath, message.data.line);
          }
          break;
        // === 新增：处理全屏切换 ===
        case 'toggleFullscreen':
          // 旧命令: 'workbench.action.maximizeEditor' (已失效)
          // 新命令: 'workbench.action.toggleMaximizeEditorGroup' (1.84+ 版本)
          try {
            await vscode.commands.executeCommand('workbench.action.toggleMaximizeEditorGroup');
          } catch (e) {
            // 兼容性兜底：如果新命令不存在（极老版本），尝试使用 'workbench.action.minimizeOtherEditors'
            console.warn('Failed to toggle maximize, trying fallback...', e);
            await vscode.commands.executeCommand('workbench.action.minimizeOtherEditors');
          }
          break;
      }
    });

    this.currentPanel.onDidDispose(() => {
      this.currentPanel = undefined;
    });
  }

  private getWebviewContent(webview: vscode.Webview) {
    const nonce = getNonce();
    // 允许的 CDN 列表
    const scriptSrc = `https://d3js.org https://cdn.jsdelivr.net`;
    const styleSrc = `https://cdnjs.cloudflare.com https://cdn.jsdelivr.net`;

    return `<!DOCTYPE html>
      <html lang="en">
      <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          
          <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline' ${styleSrc}; script-src 'nonce-${nonce}' ${scriptSrc}; img-src ${webview.cspSource} https:; font-src ${webview.cspSource} https:;">

          <script nonce="${nonce}" src="https://d3js.org/d3.v7.min.js" 
                  onerror="this.onerror=null;this.src='https://cdn.jsdelivr.net/npm/d3@7';"></script>
          
          <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" 
                onerror="this.onerror=null;this.href='https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css';">

          <style>
              :root {
                  --node-text-color: var(--vscode-editor-foreground);
                  --node-hover-bg: var(--vscode-list-hoverBackground);
                  --tooltip-bg: var(--vscode-editorHoverWidget-background);
                  --tooltip-border: var(--vscode-editorHoverWidget-border);
                  --code-bg: var(--vscode-textBlockQuote-background);
                  --accent-color: var(--vscode-textLink-foreground);
              }

              body { background-color: var(--vscode-editor-background); color: var(--vscode-editor-foreground); margin: 0; padding: 0; width: 100vw; height: 100vh; overflow: hidden; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; }
              
              #tree-container { width: 100%; height: 100%; cursor: grab; opacity: 0; transition: opacity 0.5s; }
              #tree-container:active { cursor: grabbing; }
              
              /* 加载中动画 */
              #loading {
                  position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
                  display: flex; flex-direction: column; align-items: center; gap: 10px;
                  color: var(--vscode-descriptionForeground);
              }
              .spinner {
                  width: 30px; height: 30px;
                  border: 3px solid var(--vscode-editor-background);
                  border-top: 3px solid var(--accent-color);
                  border-radius: 50%;
                  animation: spin 1s linear infinite;
              }
              @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }

              #error-message { display: none; position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); text-align: center; color: var(--vscode-errorForeground); }

              /* --- 节点样式 --- */
              .node { cursor: pointer; }
              
              /* 1. 圆点样式 */
              .node circle { transition: all 0.3s ease; }
              .node circle.outer { fill: transparent; stroke-width: 2px; opacity: 0; }
              .node circle.inner { stroke-width: 2px; fill: var(--vscode-editor-background); }
              .node:hover circle.outer { opacity: 0.5; stroke: var(--accent-color); }

              .node text.node-icon {
                  font-family: "Font Awesome 6 Free"; font-weight: 900; font-size: 14px; fill: var(--accent-color); pointer-events: none; 
              }

              .node text.label { 
                  font: 13px "Segoe UI", sans-serif; font-weight: 500; fill: var(--node-text-color); 
                  paint-order: stroke; stroke: var(--vscode-editor-background); stroke-width: 3px; stroke-linecap: round; stroke-linejoin: round;
              }
              .node:hover text.label { fill: var(--vscode-textLink-activeForeground); font-weight: 600; }

              .link { fill: none; stroke-width: 2px; stroke-opacity: 0.6; transition: all 0.5s; }
              .link:hover { stroke-opacity: 1; stroke-width: 2.5px; }
              
              .node text.badge { font: 10px sans-serif; fill: var(--vscode-descriptionForeground); font-weight: bold; pointer-events: none; }

              /* --- 控件 --- */
              #controls-top-right { 
                  position: absolute; top: 20px; right: 20px; z-index: 100; 
                  display: flex; gap: 10px;
                  opacity: 0; transition: opacity 0.5s; /* 初始隐藏，加载完显示 */
              }
              #controls-bottom { 
                  position: absolute; bottom: 40px; left: 50%; transform: translateX(-50%); z-index: 100; 
                  display: flex; gap: 12px; padding: 10px; 
                  opacity: 0; transition: opacity 0.5s; /* 初始隐藏，加载完显示 */
              }

              .icon-btn {
                  background-color: #ffffff; color: #444; border: none;
                  width: 36px; height: 36px; border-radius: 8px;
                  font-size: 15px; cursor: pointer; display: flex; align-items: center; justify-content: center;
                  box-shadow: 0 4px 12px rgba(0,0,0,0.15); transition: all 0.2s ease;
              }
              .icon-btn:hover { transform: translateY(-2px); background-color: #f0f0f0; color: #000; box-shadow: 0 6px 16px rgba(0,0,0,0.2); }
              .icon-btn:active { transform: translateY(0); box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
              
              /* --- Tooltip 样式 --- */
              .tooltip { 
                  position: absolute; pointer-events: none; opacity: 0; 
                  background: var(--tooltip-bg); border: 1px solid var(--tooltip-border); 
                  color: var(--vscode-editorHoverWidget-foreground); 
                  padding: 0; border-radius: 6px; font-size: 12px; z-index: 9999; 
                  box-shadow: 0 8px 24px rgba(0,0,0,0.25); 
                  transition: opacity 0.2s ease-in-out; 
                  min-width: 250px; max-width: 500px; 
              }
              .tooltip-header { 
                  background: var(--vscode-sideBarSectionHeader-background); 
                  padding: 8px 12px; font-weight: 600; border-bottom: 1px solid var(--vscode-panel-border);
                  display: flex; align-items: center; gap: 8px; font-size: 13px;
              }
              .tooltip-header i { color: var(--accent-color); }
              .tooltip-body { padding: 10px 12px; display: flex; flex-direction: column; gap: 8px; }
              .tooltip-row { display: flex; align-items: center; gap: 8px; color: var(--vscode-descriptionForeground); }
              .tooltip-row i { width: 16px; text-align: center; font-size: 11px; }
              .tooltip-val { color: var(--vscode-editor-foreground); word-break: break-all; }

              .code-block {
                  background: var(--code-bg); padding: 10px; border-radius: 4px;
                  font-family: var(--vscode-editor-font-family, 'Courier New', monospace);
                  border-left: 3px solid var(--accent-color);
                  white-space: pre-wrap; word-break: break-all; font-size: 11px; margin-top: 4px;
                  color: var(--vscode-editor-foreground); line-height: 1.4; max-height: 300px; overflow-y: auto;
              }
          </style>
      </head>
      <body>
          <div id="loading">
              <div class="spinner"></div>
              <div>Loading Resources...</div>
          </div>

          <div id="error-message">
              <h3><i class="fa-solid fa-triangle-exclamation"></i> 资源加载失败</h3>
              <p>请检查网络连接 (CDN)</p>
          </div>

          <div id="controls-top-right">
            <button id="fullscreen-btn" class="icon-btn" title="切换编辑器最大化 (Toggle Maximize)"><i class="fa-solid fa-expand"></i></button>
            <button id="refresh-btn" class="icon-btn" title="刷新"><i class="fa-solid fa-rotate-right"></i></button>
          </div>

          <div id="controls-bottom">
            <button id="zoom-out-btn" class="icon-btn" title="缩小"><i class="fa-solid fa-minus"></i></button>
            <button id="zoom-reset-btn" class="icon-btn" title="适应"><i class="fa-solid fa-compress"></i></button>
            <button id="zoom-in-btn" class="icon-btn" title="放大"><i class="fa-solid fa-plus"></i></button>
          </div>

          <div id="tree-container"></div>
          <div id="tooltip" class="tooltip"></div>

          <script nonce="${nonce}">
              const vscode = acquireVsCodeApi();
              vscode.postMessage({ command: 'ready' });

              function escapeHtml(text) {
                  if (!text) return "";
                  return text
                      .replace(/&/g, "&amp;")
                      .replace(/</g, "&lt;")
                      .replace(/>/g, "&gt;")
                      .replace(/"/g, "&quot;")
                      .replace(/'/g, "&#039;");
              }

              window.onload = function() {
                  // 2. 检查 D3 是否加载成功
                  if (typeof d3 === 'undefined') {
                      document.getElementById('loading').style.display = 'none';
                      document.getElementById('error-message').style.display = 'block';
                      return;
                  }
                  initD3();
              };

              let root, svg, g, zoom, tree;
              const width = window.innerWidth;
              const height = window.innerHeight;
              let colorScale; // 延迟初始化

              function getNodeColor(d) {
                  if(d.depth === 0) return "var(--vscode-editor-foreground)";
                  let ancestor = d;
                  while(ancestor.depth > 1) ancestor = ancestor.parent;
                  return colorScale(ancestor.id || ancestor.data.name);
              }

              function initD3() {
                  colorScale = d3.scaleOrdinal(d3.schemeSet2);
                  zoom = d3.zoom().scaleExtent([0.1, 4]).on("zoom", (e) => {
                      if(g) g.attr("transform", e.transform);
                  });

                  svg = d3.select("#tree-container").append("svg")
                      .attr("width", "100%")
                      .attr("height", "100%")
                      .call(zoom)
                      .on("dblclick.zoom", null);

                  g = svg.append("g");
                  tree = d3.tree().nodeSize([35, 260]); 
                  setupEvents();
              }

              function setupEvents() {
                  document.getElementById('refresh-btn').addEventListener('click', () => vscode.postMessage({ command: 'refresh' }));
                  document.getElementById('fullscreen-btn').addEventListener('click', toggleFullscreen);
                  document.getElementById('zoom-in-btn').addEventListener('click', () => svg.transition().call(zoom.scaleBy, 1.2));
                  document.getElementById('zoom-out-btn').addEventListener('click', () => svg.transition().call(zoom.scaleBy, 0.8));
                  document.getElementById('zoom-reset-btn').addEventListener('click', () => centerView(true));
              }

              function toggleFullscreen() {
                  vscode.postMessage({ command: 'toggleFullscreen' });
                  const btnIcon = document.querySelector('#fullscreen-btn i');
                  const btn = document.getElementById('fullscreen-btn');
                  if (btnIcon.classList.contains('fa-expand')) {
                      btnIcon.classList.remove('fa-expand');
                      btnIcon.classList.add('fa-compress');
                      btn.title = "恢复默认布局";
                  } else {
                      btnIcon.classList.remove('fa-compress');
                      btnIcon.classList.add('fa-expand');
                      btn.title = "切换编辑器最大化";
                  }
              }

              window.addEventListener('message', event => {
                  if (event.data.command === 'refresh' && typeof d3 !== 'undefined') {
                      initData(event.data.data);
                  }
              });

              function centerView(animate = false) {
                  if (!svg) return;
                  const initialTransform = d3.zoomIdentity.translate(120, height / 2).scale(1);
                  if (animate) svg.transition().duration(750).call(zoom.transform, initialTransform);
                  else svg.call(zoom.transform, initialTransform);
              }

              function initData(data) {
                  // 3. 数据到来，隐藏 Loading，显示图表和控件
                  document.getElementById('loading').style.display = 'none';
                  document.getElementById('tree-container').style.opacity = '1';
                  document.getElementById('controls-top-right').style.opacity = '1';
                  document.getElementById('controls-bottom').style.opacity = '1';

                  g.selectAll("*").remove(); 
                  if (!data || !data.children || data.children.length === 0) {
                      g.append("text").attr("x", 50).attr("y", 50).text("暂无数据").style("fill", "var(--vscode-descriptionForeground)");
                      return;
                  }
                  root = d3.hierarchy(data);
                  let i = 0;
                  root.descendants().forEach(d => { d.id = i++; });
                  update(root);
                  // 首次渲染居中
                  centerView(false);
              }

              function update(source) {
                  const nodes = root.descendants();
                  const links = root.links();

                  tree(root);

                  const node = g.selectAll(".node").data(nodes, d => d.id);

                  // --- Enter ---
                  const nodeEnter = node.enter().append("g")
                      .attr("class", "node")
                      .attr("transform", d => "translate(" + (source.y0 || source.y) + "," + (source.x0 || source.x) + ")");

                  nodeEnter.append("circle").attr("class", "outer").attr("r", 1e-6).style("stroke", d => getNodeColor(d)).on("click", clickToggle);
                  nodeEnter.append("circle").attr("class", "inner").attr("r", 1e-6).style("stroke", d => getNodeColor(d)).on("click", clickToggle);
                  
                  function clickToggle(e, d) { toggle(d); update(d); e.stopPropagation(); }
                  
                  nodeEnter.append("text")
                      .attr("class", "node-icon")
                      .attr("dy", 5).attr("x", 16).style("text-anchor", "middle")
                      .text(d => d.data.data ? "\\uf0c1" : "")
                      .on("click", (e, d) => {
                          if(d.data.data) vscode.postMessage({ command: 'jump', data: d.data.data });
                          e.stopPropagation();
                      });

                  nodeEnter.append("text")
                      .attr("class", "label")
                      .attr("dy", 5).attr("x", d => d.data.data ? 30 : 14).style("text-anchor", "start")
                      .text(d => d.data.data ? (d.data.data.description || d.data.name) : d.data.name)
                      .on("click", (e, d) => {
                          if(d.data.data) vscode.postMessage({ command: 'jump', data: d.data.data });
                          e.stopPropagation();
                      });

                  nodeEnter.append("text")
                      .attr("class", "badge")
                      .attr("dy", -8).attr("dx", 8).style("text-anchor", "middle")
                      .text(d => d._children ? d._children.length : "")
                      .style("opacity", 0);

                  const tooltip = d3.select("#tooltip");
                  nodeEnter.on("mouseover", (e, d) => {
                      if (!d.data.data) return;
                      const raw = d.data.data;
                      const content = raw.content ? escapeHtml(raw.content.trim()) : "";
                      const group = raw.group || "Default";
                      const file = raw.filePath ? raw.filePath.split('/').pop() : "Unknown File";
                      const line = raw.line || "?";
                      const desc = raw.description || "Anchor Point";
                      
                      const htmlContent = \`
                          <div class="tooltip-header"><i class="fa-solid fa-tag"></i> <span>\${desc}</span></div>
                          <div class="tooltip-body">
                             <div class="tooltip-row"><i class="fa-regular fa-folder-open"></i> <span class="tooltip-val">\${group}</span></div>
                             <div class="tooltip-row"><i class="fa-regular fa-file-code"></i> <span class="tooltip-val">\${file} : \${line}</span></div>
                             \${content ? \`<div class="code-block">\${content}</div>\` : ''}
                          </div>
                      \`;
                      tooltip.style("opacity", 1).html(htmlContent)
                             .style("left", (e.pageX + 20) + "px").style("top", (e.pageY + 10) + "px");
                  }).on("mouseout", () => tooltip.style("opacity", 0));

                  const nodeUpdate = nodeEnter.merge(node);
                  nodeUpdate.transition().duration(250).attr("transform", d => "translate(" + d.y + "," + d.x + ")");
                  
                  const isGroup = d => d.data.children && d.data.children.length > 0;
                  
                  nodeUpdate.select("circle.outer").attr("r", d => isGroup(d) ? 10 : 0).style("opacity", d => isGroup(d) ? 0 : 0);
                  nodeUpdate.select("circle.inner").attr("r", d => isGroup(d) ? 5 : 3).style("fill", d => isGroup(d) ? (d._children ? getNodeColor(d) : "var(--vscode-editor-background)") : getNodeColor(d));
                  nodeUpdate.select(".badge").text(d => d._children ? d._children.length : "").transition().duration(250).style("opacity", d => d._children ? 1 : 0);

                  const nodeExit = node.exit().transition().duration(250).attr("transform", d => "translate(" + source.y + "," + source.x + ")").remove();
                  nodeExit.selectAll("circle").attr("r", 1e-6);
                  nodeExit.select("text").style("fill-opacity", 1e-6);

                  const link = g.selectAll(".link").data(links, d => d.target.id);
                  const linkEnter = link.enter().insert("path", "g").attr("class", "link")
                      .style("stroke", d => getNodeColor(d.target))
                      .attr("d", d => {
                          const o = {x: source.x0 || source.x, y: source.y0 || source.y};
                          return d3.linkHorizontal().x(d => d.y).y(d => d.x)({source: o, target: o});
                      });
                  
                  const linkUpdate = linkEnter.merge(link);
                  linkUpdate.transition().duration(250).attr("d", d3.linkHorizontal().x(d => d.y).y(d => d.x)).style("stroke", d => getNodeColor(d.target));
                  link.exit().transition().duration(250).attr("d", d => {
                          const o = {x: source.x, y: source.y};
                          return d3.linkHorizontal().x(d => d.y).y(d => d.x)({source: o, target: o});
                      }).remove();

                  nodes.forEach(d => { d.x0 = d.x; d.y0 = d.y; });
              }

              function toggle(d) {
                  if (d.children) { d._children = d.children; d.children = null; } 
                  else { d.children = d._children; d._children = null; }
              }
          </script>
      </body>
      </html>`;
  }

  private getEditorContext(overrideLineNumber?: number) {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showWarningMessage('请先激活编辑器');
      return null;
    }
    const rootPath = vscode.workspace.workspaceFolders?.[0].uri.fsPath || path.dirname(editor.document.uri.fsPath);
    const doc = editor.document;
    const lineIndex = overrideLineNumber !== undefined ? overrideLineNumber : editor.selection.active.line;
    const text = doc.lineAt(lineIndex).text.trim();
    const relativePath = path.relative(rootPath, doc.uri.fsPath).replace(/\\/g, '/');
    return { editor, doc, rootPath, relativePath, lineIndex, uiLineNumber: lineIndex + 1, text };
  }

  private async syncAnchorsWithContent(doc: vscode.TextDocument) {
    const rootPath = vscode.workspace.workspaceFolders?.[0].uri.fsPath || '';
    const relativePath = path.relative(rootPath, doc.uri.fsPath).replace(/\\/g, '/');
    const fileAnchors = this.service.getAnchors().filter((a) => a.filePath === relativePath);
    if (fileAnchors.length === 0) return;
    let hasUpdates = false;
    for (const anchor of fileAnchors) {
      const oldIndex = anchor.line - 1;
      if (oldIndex < doc.lineCount && doc.lineAt(oldIndex).text.trim() === anchor.content) continue;
      let foundNewSelection = false;
      for (let i = 0; i < doc.lineCount; i++) {
        const lineText = doc.lineAt(i).text.trim();
        if (lineText === anchor.content && lineText !== '') {
          this.service.updateAnchor(anchor.id, { line: i + 1 });
          foundNewSelection = true;
          hasUpdates = true;
          break;
        }
      }
      if (!foundNewSelection) {
        const currentLineIndex = Math.min(anchor.line - 1, doc.lineCount - 1);
        const newContent = doc.lineAt(currentLineIndex).text.trim();
        if (newContent !== anchor.content) {
          this.service.updateAnchor(anchor.id, { content: newContent });
          hasUpdates = true;
        }
      }
    }
    if (hasUpdates) this.updateDecorations();
  }

  private debouncedUpdate = debounce(() => this.updateDecorations(), 200);

  private async handleAddAnchorCommand(...args: any[]) {
    try {
      let argLineIndex: number | undefined;
      if (args.length > 0 && args[0] && isNumber(args[0].lineNumber)) {
        argLineIndex = args[0].lineNumber - 1;
      }
      const ctx = this.getEditorContext(argLineIndex);
      if (!ctx) return;
      this.service.init(ctx.rootPath);
      const groups = this.service.getGroups();
      const items: vscode.QuickPickItem[] = groups.map((g) => ({
        label: g,
        iconPath: new vscode.ThemeIcon('symbol-folder'),
        description: ColorUtils.getEmoji(g),
      }));
      const quickPick = vscode.window.createQuickPick();
      const previewText = ctx.text.length > 20 ? ctx.text.substring(0, 20) + '...' : ctx.text;
      quickPick.title = `添加锚点: 第 ${ctx.uiLineNumber} 行 [${previewText}]`;
      quickPick.placeholder = '输入新分组名称或从列表中选择';
      quickPick.items = items;
      quickPick.onDidChangeValue((value) => {
        if (value && !groups.includes(value)) {
          quickPick.items = [{ label: value, description: '(新建分组)', iconPath: new vscode.ThemeIcon('add') }, ...items];
        } else {
          quickPick.items = items;
        }
      });
      quickPick.onDidAccept(async () => {
        const selected = quickPick.selectedItems[0];
        const groupName = selected ? selected.label : quickPick.value;
        if (groupName) {
          this.service.addGroup(groupName);
          quickPick.hide();
          const existingAnchors = this.service.getAnchors().filter((a) => a.group === groupName);
          if (existingAnchors.length === 0) {
            this.service.addAnchor({
              filePath: ctx.relativePath,
              line: ctx.uiLineNumber,
              content: ctx.text,
              sort: 1,
              group: groupName,
            });
            vscode.window.showInformationMessage(`已直接添加到 [${groupName}]`);
          } else {
            this.showAnchorList(groupName, false, ctx.lineIndex);
          }
        } else {
          quickPick.hide();
        }
      });
      quickPick.show();
    } catch (error) {
      console.error(error);
      vscode.window.showErrorMessage(`添加锚点失败: ${error}`);
    }
  }

  private updateDecorations() {
    this.decorationTypes.forEach((d) => d.dispose());
    this.decorationTypes.clear();
  }

  private showGroupList(isPreviewMode: boolean) {
    const getGroupItems = () => {
      const groups = this.service.getGroups();
      return groups.map((g) => ({
        label: g,
        iconPath: new vscode.ThemeIcon('symbol-folder'),
        description: ColorUtils.getEmoji(g),
        buttons: [{ iconPath: new vscode.ThemeIcon('trash', new vscode.ThemeColor('errorForeground')), tooltip: TOOLTIPS.DELETE }],
      }));
    };
    const quickPick = vscode.window.createQuickPick();
    quickPick.items = getGroupItems();
    quickPick.placeholder = '选择要查看的锚点分组';
    quickPick.title = '锚点分组列表';
    quickPick.onDidAccept(() => {
      const selected = quickPick.selectedItems[0];
      if (selected) {
        quickPick.hide();
        this.showAnchorList(selected.label, isPreviewMode);
      }
    });
    quickPick.onDidTriggerItemButton(async (e) => {
      await this.handleDeleteGroup(e.item.label);
      quickPick.items = getGroupItems();
    });
    quickPick.show();
  }

  private async handleDeleteGroup(groupName: string) {
    const isDefault = this.defaultGroups.includes(groupName);
    const confirmMessage = isDefault ? `是否清空默认分组 [${groupName}] 下的所有记录？` : `确认要删除分组 [${groupName}] 及其下所有记录吗？`;
    const selection = await vscode.window.showWarningMessage(confirmMessage, '确认删除', '取消');
    if (selection === '确认删除') {
      const anchorsToDelete = this.service.getAnchors().filter((a) => a.group === groupName);
      anchorsToDelete.forEach((anchor) => this.service.removeAnchor(anchor.id));
      if (!isDefault && isFunction(this.service.removeGroup)) {
        this.service.removeGroup(groupName);
      }
      this.updateDecorations();
      vscode.window.showInformationMessage(`已${isDefault ? '清空' : '删除'}分组 [${groupName}]`);
    }
  }

  private getIconForFile(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    switch (ext) {
      case '.ts':
      case '.tsx':
      case '.js':
      case '.jsx':
        return '$(file-code)';
      case '.vue':
      case '.html':
        return '$(browser)';
      case '.css':
      case '.scss':
      case '.less':
        return '$(paintcan)';
      case '.json':
        return '$(json)';
      case '.md':
        return '$(markdown)';
      case '.png':
      case '.jpg':
      case '.svg':
        return '$(file-media)';
      default:
        return '$(file)';
    }
  }

  private async showAnchorList(groupName: string, isPreviewMode: boolean, pinnedLineIndex?: number, defaultAnchorId?: string) {
    const mapItems = () => {
      const latestAnchors = this.service.getAnchors().filter((a) => a.group === groupName);
      return latestAnchors.map((a, index) => {
        const icon = this.getIconForFile(a.filePath);
        let buttons: any[] = [];

        if (defaultAnchorId) {
          if (index > 0) buttons.push({ iconPath: new vscode.ThemeIcon('arrow-up'), tooltip: TOOLTIPS.UP });
          if (index < latestAnchors.length - 1) buttons.push({ iconPath: new vscode.ThemeIcon('arrow-down'), tooltip: TOOLTIPS.DOWN });
          if (a.items?.length) buttons.push({ iconPath: new vscode.ThemeIcon('file-symlink-directory'), tooltip: TOOLTIPS.VIEW_CHILDREN });
          buttons.push({ iconPath: new vscode.ThemeIcon('edit'), tooltip: TOOLTIPS.ADD_NOTE });
          buttons.push({ iconPath: new vscode.ThemeIcon('trash', new vscode.ThemeColor('errorForeground')), tooltip: TOOLTIPS.DELETE });
        } else if (isPreviewMode) {
          if (a.items?.length) buttons.push({ iconPath: new vscode.ThemeIcon('file-symlink-directory'), tooltip: TOOLTIPS.VIEW_CHILDREN });
          buttons.push({ iconPath: new vscode.ThemeIcon('edit'), tooltip: TOOLTIPS.ADD_NOTE });
          buttons.push({ iconPath: new vscode.ThemeIcon('trash', new vscode.ThemeColor('errorForeground')), tooltip: TOOLTIPS.DELETE });
        } else {
          // 插入模式：保持原样
          buttons = [
            { iconPath: new vscode.ThemeIcon('arrow-up'), tooltip: TOOLTIPS.INSERT_BEFORE },
            { iconPath: new vscode.ThemeIcon('arrow-down'), tooltip: TOOLTIPS.INSERT_AFTER },
            a.items?.length
              ? { iconPath: new vscode.ThemeIcon('file-symlink-directory'), tooltip: TOOLTIPS.VIEW_CHILDREN }
              : { iconPath: new vscode.ThemeIcon('new-folder'), tooltip: TOOLTIPS.NEW_SUBGROUP },
            { iconPath: new vscode.ThemeIcon('trash', new vscode.ThemeColor('errorForeground')), tooltip: TOOLTIPS.DELETE },
          ];
        }

        let detailText = a.filePath;
        if (a.description?.trim()) detailText = a.description.length > 30 ? `📝 ${a.description.substring(0, 30)}...` : `📝 ${a.description}`;
        return {
          label: `${a.items && a.items.length ? '$(symbol-folder)' : icon} ${path.basename(a.filePath)} : ${a.line}`,
          description: a.content,
          detail: detailText,
          anchorId: a.id,
          buttons: buttons,
          rawDescription: a.description,
        };
      });
    };

    const quickPick = vscode.window.createQuickPick<any>();
    const insertLineDisplay = pinnedLineIndex !== undefined ? pinnedLineIndex + 1 : '?';
    quickPick.title =
      pinnedLineIndex !== undefined && !isPreviewMode
        ? `${ColorUtils.getEmoji(groupName)} [${groupName}] (待插入: 第 ${insertLineDisplay} 行)`
        : `${ColorUtils.getEmoji(groupName)} [${groupName}] 列表`;

    const refreshList = (targetAnchorId?: string) => {
      const items = mapItems();
      quickPick.items = items;
      const idToSelect = targetAnchorId || (defaultAnchorId && !targetAnchorId ? defaultAnchorId : undefined);
      if (idToSelect) {
        const t = items.find((i) => i.anchorId === idToSelect);
        if (t) quickPick.activeItems = [t];
      }
    };
    refreshList();

    quickPick.onDidAccept(() => {
      const selected = quickPick.selectedItems[0];
      if (!selected?.anchorId) return;
      const anchor = this.service.getAnchorById(selected.anchorId);
      if (anchor) this.openFileAtLine(anchor.filePath, anchor.line);
    });

    quickPick.onDidTriggerItemButton(async (e) => {
      const anchorId = e.item.anchorId;
      const tooltip = e.button.tooltip || '';
      switch (tooltip) {
        case TOOLTIPS.ADD_NOTE:
          const input = await vscode.window.showInputBox({ title: '设置锚点备注', value: e.item.rawDescription || '', validateInput: (t) => (t.trim().length === 0 ? '备注不能为空' : null) });
          if (input !== undefined) {
            this.service.updateAnchor(anchorId, { description: input.trim() });
            refreshList(anchorId);
            this.updateDecorations();
            vscode.window.showInformationMessage('备注已更新');
          }
          break;
        case TOOLTIPS.UP:
          this.service.moveAnchor(anchorId, 'up');
          refreshList(anchorId);
          this.updateDecorations();
          break;
        case TOOLTIPS.DOWN:
          this.service.moveAnchor(anchorId, 'down');
          refreshList(anchorId);
          this.updateDecorations();
          break;
        case TOOLTIPS.DELETE:
          this.service.removeAnchor(anchorId);
          refreshList();
          this.updateDecorations();
          if (quickPick.items.length === 0 && isPreviewMode) quickPick.hide();
          break;
        case TOOLTIPS.VIEW_CHILDREN:
          const targetAnchor = this.service.getAnchorById(anchorId);
          if (targetAnchor) {
            let childGroupName = targetAnchor.description;
            if (targetAnchor.items && targetAnchor.items.length > 0) childGroupName = targetAnchor.items[0].group;
            if (childGroupName) {
              const ctx = this.getEditorContext(pinnedLineIndex);
              if (!ctx) return;
              if (defaultAnchorId || isPreviewMode) {
                const _defaultAnchorId = defaultAnchorId || targetAnchor.id;
                this.showAnchorList(childGroupName, true, undefined, _defaultAnchorId);
              } else {
                this.showAnchorList(childGroupName, false, ctx.uiLineNumber);
              }
            } else {
              vscode.window.showInformationMessage('此记录没有子分组');
            }
          }
          break;
        case TOOLTIPS.NEW_SUBGROUP:
          await this.handleCreateSubGroup(anchorId, pinnedLineIndex);
          refreshList(anchorId);
          break;
        case TOOLTIPS.INSERT_BEFORE:
        case TOOLTIPS.INSERT_AFTER:
          await this.handleInsertAnchor(anchorId, tooltip === TOOLTIPS.INSERT_BEFORE ? 'before' : 'after', groupName, pinnedLineIndex);
          refreshList();
          let timer = setTimeout(() => {
            quickPick.hide();
            clearTimeout(timer);
          }, 1000);
          break;
      }
    });
    quickPick.show();
  }

  private async handleCreateSubGroup(parentId: string, pinnedLineIndex?: number) {
    const parentAnchor = this.service.getAnchorById(parentId);
    if (!parentAnchor) return;
    let targetGroupName = parentAnchor.description;
    if (!targetGroupName) {
      const fileNameWithoutExt = path.parse(parentAnchor.filePath).name;
      const parentDir = path.basename(path.dirname(parentAnchor.filePath));
      const suggestion = path.join(parentDir, fileNameWithoutExt);
      const input = await vscode.window.showInputBox({ title: '创建新分组 (将当前记录作为子分组)', value: suggestion, prompt: '确认新分组路径' });
      if (!input) return;
      targetGroupName = input.trim();
    }
    this.service.addChild(targetGroupName);
    const ctx = this.getEditorContext(pinnedLineIndex);
    if (ctx) {
      this.service.addChildAnchor(parentAnchor.id, { filePath: ctx.relativePath, line: ctx.uiLineNumber, content: ctx.text, group: targetGroupName });
      vscode.window.showInformationMessage(`已创建子分组: ${targetGroupName}`);
      this.updateDecorations();
    } else {
      vscode.window.showInformationMessage(`已为记录创建子分组结构: ${targetGroupName}`);
    }
  }

  private async handleInsertAnchor(targetId: string, position: 'before' | 'after', groupName: string, pinnedLineIndex?: number) {
    const ctx = this.getEditorContext(pinnedLineIndex);
    if (!ctx) return;
    const newAnchorData = { filePath: ctx.relativePath, line: ctx.uiLineNumber, content: ctx.text, group: groupName, sort: 0 };
    this.service.insertAnchor(newAnchorData, targetId, position);
    this.updateDecorations();
    vscode.window.showInformationMessage(`已插入第 ${ctx.uiLineNumber} 行`);
  }

  private async openFileAtLine(filePath: string, uiLine: number) {
    const rootPath = vscode.workspace.workspaceFolders?.[0].uri.fsPath || '';
    const absolutePath = path.join(rootPath, filePath);
    try {
      const doc = await vscode.workspace.openTextDocument(absolutePath);

      let targetColumn = vscode.ViewColumn.Active;

      // 2. 检查思维导图是否打开且可见
      if (this.currentPanel && this.currentPanel.visible && this.currentPanel.viewColumn) {
        // 获取思维导图当前的实时列
        const mindMapColumn = this.currentPanel.viewColumn;

        if (mindMapColumn === vscode.ViewColumn.One) {
          targetColumn = vscode.ViewColumn.Two;
        } else {
          targetColumn = vscode.ViewColumn.One;
        }
      }

      // --- 动态互斥逻辑结束 ---

      const editor = await vscode.window.showTextDocument(doc, {
        viewColumn: targetColumn,
        preview: false,
      });

      const lineIndex = Math.max(0, uiLine - 1);
      const pos = new vscode.Position(lineIndex, 0);
      editor.selection = new vscode.Selection(pos, pos);
      editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
    } catch (e) {
      vscode.window.showErrorMessage('无法打开文件: ' + filePath);
    }
  }
}

// 辅助函数：生成 Nonce 随机字符串
function getNonce() {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
