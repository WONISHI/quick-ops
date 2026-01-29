import * as vscode from 'vscode';
import * as path from 'path';
import { isNumber, debounce, isFunction } from 'lodash-es';
import { IFeature } from '../core/interfaces/IFeature';
import { AnchorService } from '../services/AnchorService';
import { AnchorCodeLensProvider } from '../providers/AnchorCodeLensProvider';
import { ColorUtils } from '../utils/ColorUtils';
import { ConfigurationService } from '../services/ConfigurationService';

// 常量定义，方便维护
const TOOLTIPS = {
  ADD_NOTE: '添加备注',
  UP: '上移',
  DOWN: '下移',
  DELETE: '删除',
  NEW_SUBGROUP: '由此创建新分组',
  VIEW_CHILDREN: '查看子级',
  INSERT_BEFORE: '在此项【之前】插入',
  INSERT_AFTER: '在此项【之后】插入',
  TRASH: '删除',
};

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
  private openMindMapPanel() {
    if (this.currentPanel) {
      this.currentPanel.reveal(vscode.ViewColumn.Beside);
      return;
    }

    this.currentPanel = vscode.window.createWebviewPanel(
      'anchorMindMap',
      'Anchors Mind Map',
      vscode.ViewColumn.Beside, // 默认右侧分屏
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      },
    );

    this.currentPanel.webview.html = this.getWebviewContent();

    this.currentPanel.webview.onDidReceiveMessage((message) => {
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
      }
    });

    this.currentPanel.onDidDispose(() => {
      this.currentPanel = undefined;
    });
  }

  private getWebviewContent() {
    return `<!DOCTYPE html>
      <html lang="en">
      <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          
          <script src="https://d3js.org/d3.v7.min.js" 
                  onerror="this.onerror=null;this.src='https://cdn.jsdelivr.net/npm/d3@7';"></script>
          
          <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" 
                onerror="this.onerror=null;this.href='https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css';">

          <style>
              body { background-color: var(--vscode-editor-background); color: var(--vscode-editor-foreground); margin: 0; padding: 0; width: 100vw; height: 100vh; overflow: hidden; font-family: var(--vscode-font-family); }
              #tree-container { width: 100%; height: 100%; cursor: grab; }
              #tree-container:active { cursor: grabbing; }
              
              /* 错误提示样式 */
              #error-message { display: none; position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); text-align: center; color: var(--vscode-errorForeground); }

              .node { cursor: default; }
              
              /* --- 圆点样式 --- */
              .node circle { transition: all 0.3s ease; cursor: pointer; }
              .node circle.outer { fill: transparent; stroke: var(--vscode-button-background); stroke-width: 1.5px; opacity: 0; }
              .node circle.inner { stroke: var(--vscode-button-background); stroke-width: 1.5px; }
              .node circle.inner.leaf { fill: var(--vscode-button-background); stroke: none; }
              .node circle.inner.expanded { fill: var(--vscode-editor-background); }
              .node circle.inner.collapsed { fill: var(--vscode-button-background); }

              /* --- 图标样式 (新添加) --- */
              .node text.node-icon {
                  font-family: "Font Awesome 6 Free"; /* 必须指定字体族 */
                  font-weight: 900; /* Solid 图标需要 900 */
                  font-size: 12px;
                  fill: var(--vscode-textLink-foreground); /* 使用链接色 */
                  cursor: pointer;
              }

              /* --- 文字样式 --- */
              .node text.label { 
                  font: 12px sans-serif; 
                  fill: var(--vscode-editor-foreground); 
                  text-shadow: 0 1px 0 var(--vscode-editor-background); 
                  cursor: pointer; 
              }
              .node text.label:hover { fill: var(--vscode-textLink-activeForeground); text-decoration: underline; }

              /* 徽标数字样式 */
              .node text.badge { font: 10px sans-serif; fill: var(--vscode-descriptionForeground); pointer-events: none; font-weight: bold; }

              .link { fill: none; stroke: var(--vscode-editor-lineHighlightBorder); stroke-width: 1.5px; transition: all 0.5s; }
              
              /* --- 控件样式 --- */
              #controls-top-right { position: absolute; top: 20px; right: 20px; z-index: 100; }
              #controls-bottom { 
                  position: absolute; bottom: 40px; left: 50%; transform: translateX(-50%); 
                  z-index: 100; display: flex; gap: 12px; 
                  padding: 10px; 
              }

              .icon-btn {
                  background-color: #ffffff; 
                  color: #555555; 
                  border: none;
                  width: 40px; height: 40px; border-radius: 50%;
                  font-size: 16px; cursor: pointer;
                  display: flex; align-items: center; justify-content: center;
                  box-shadow: 0 4px 6px rgba(0,0,0,0.1), 0 1px 3px rgba(0,0,0,0.06);
                  transition: all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1);
              }
              .icon-btn:hover { transform: translateY(-3px); box-shadow: 0 10px 20px rgba(0,0,0,0.15), 0 6px 6px rgba(0,0,0,0.1); color: #000; background-color: #ffffff; }
              .icon-btn:active { transform: translateY(0); box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
              
              /* Tooltip */
              .tooltip { position: absolute; pointer-events: none; opacity: 0; background: var(--vscode-editorHoverWidget-background); border: 1px solid var(--vscode-editorHoverWidget-border); color: var(--vscode-editorHoverWidget-foreground); padding: 6px 8px; border-radius: 3px; font-size: 12px; line-height: 1.2; z-index: 9999; box-shadow: 0 4px 6px rgba(0,0,0,0.3); transition: opacity 0.15s ease-in-out; max-width: 320px; word-wrap: break-word; }
              .tooltip-header { font-weight: 600; color: var(--vscode-textLink-foreground); margin-bottom: 3px; border-bottom: 1px solid var(--vscode-editorHoverWidget-border); padding-bottom: 3px; }
              .tooltip-row { display: flex; align-items: flex-start; gap: 6px; margin-bottom: 2px; }
              .tooltip-label { opacity: 0.7; min-width: 30px; }
              .tooltip-val { opacity: 1; word-break: break-all; }
          </style>
      </head>
      <body>
          <div id="error-message">
              <h3>资源加载失败</h3>
              <p>检测到 D3.js 或样式文件无法加载。<br>请检查您的网络连接。</p>
          </div>

          <div id="controls-top-right">
            <button id="refresh-btn" class="icon-btn" title="刷新数据"><i class="fa-solid fa-rotate-right"></i></button>
          </div>

          <div id="controls-bottom">
            <button id="zoom-out-btn" class="icon-btn" title="缩小"><i class="fa-solid fa-minus"></i></button>
            <button id="zoom-reset-btn" class="icon-btn" title="适应屏幕"><i class="fa-solid fa-compress"></i></button>
            <button id="zoom-in-btn" class="icon-btn" title="放大"><i class="fa-solid fa-plus"></i></button>
          </div>

          <div id="tree-container"></div>
          <div id="tooltip" class="tooltip"></div>

          <script>
              const vscode = acquireVsCodeApi();
              vscode.postMessage({ command: 'ready' });

              // --- 资源检查兜底逻辑 ---
              window.onload = function() {
                  if (typeof d3 === 'undefined') {
                      document.getElementById('tree-container').style.display = 'none';
                      document.getElementById('controls-bottom').style.display = 'none';
                      document.getElementById('controls-top-right').style.display = 'none';
                      document.getElementById('error-message').style.display = 'block';
                      return;
                  }
                  // 初始化布局变量
                  initD3();
              };

              let root, svg, g, zoom, tree;
              const width = window.innerWidth;
              const height = window.innerHeight;

              function initD3() {
                  zoom = d3.zoom().scaleExtent([0.1, 3]).on("zoom", (e) => {
                      if(g) g.attr("transform", e.transform);
                  });

                  svg = d3.select("#tree-container").append("svg")
                      .attr("width", "100%")
                      .attr("height", "100%")
                      .call(zoom)
                      .on("dblclick.zoom", null);

                  g = svg.append("g");
                  tree = d3.tree().nodeSize([25, 200]); 

                  setupEvents();
              }

              function setupEvents() {
                  document.getElementById('refresh-btn').addEventListener('click', () => vscode.postMessage({ command: 'refresh' }));
                  document.getElementById('zoom-in-btn').addEventListener('click', () => svg.transition().call(zoom.scaleBy, 1.2));
                  document.getElementById('zoom-out-btn').addEventListener('click', () => svg.transition().call(zoom.scaleBy, 0.8));
                  document.getElementById('zoom-reset-btn').addEventListener('click', () => centerView(true));
              }

              window.addEventListener('message', event => {
                  if (event.data.command === 'refresh') {
                      // 确保 D3 已加载
                      if (typeof d3 !== 'undefined') {
                          initData(event.data.data);
                      }
                  }
              });

              function centerView(animate = false) {
                  if (!svg) return;
                  const initialTransform = d3.zoomIdentity.translate(80, height / 2).scale(1);
                  if (animate) {
                      svg.transition().duration(750).call(zoom.transform, initialTransform);
                  } else {
                      svg.call(zoom.transform, initialTransform);
                  }
              }

              function initData(data) {
                  g.selectAll("*").remove(); 
                  
                  if (!data || !data.children || data.children.length === 0) {
                      g.append("text").attr("x", 50).attr("y", 50).text("暂无数据").style("fill", "var(--vscode-descriptionForeground)");
                      return;
                  }
                  root = d3.hierarchy(data);
                  let i = 0;
                  root.descendants().forEach(d => { d.id = i++; });
                  update(root);
                  centerView(false);
              }

              function update(source) {
                  const nodes = root.descendants();
                  const links = root.links();

                  tree(root);

                  const node = g.selectAll(".node").data(nodes, d => d.id);

                  // Enter
                  const nodeEnter = node.enter().append("g")
                      .attr("class", "node")
                      .attr("transform", d => "translate(" + (source.y0 || source.y) + "," + (source.x0 || source.x) + ")");

                  // 1. 外圈大圆
                  nodeEnter.append("circle")
                      .attr("class", "outer")
                      .attr("r", 1e-6)
                      .on("click", clickToggle);

                  // 2. 内圈小圆
                  nodeEnter.append("circle")
                      .attr("class", "inner")
                      .attr("r", 1e-6)
                      .on("click", clickToggle);

                  function clickToggle(e, d) {
                      toggle(d); 
                      update(d); 
                      e.stopPropagation(); 
                  }
                  
                  // --- 3. 新增: 节点图标 (Paperclip or Folder) ---
                  // 使用 FontAwesome Unicode (Paperclip: \uf0c1, Folder: \uf07b)
                  nodeEnter.append("text")
                      .attr("class", "node-icon")
                      .attr("dy", 3)
                      // 如果在右侧(叶子)，图标放在文字左边；如果在左侧(根/组)，图标放在文字右边
                      .attr("x", d => d.children || d._children ? -14 : 14) 
                      .style("text-anchor", d => d.children || d._children ? "end" : "start")
                      .text(d => {
                          if (d.data.data) {
                             return "\\uf0c1"; // 📎 Paperclip (可跳转)
                          }
                          return ""; // 纯分组节点暂时不加图标，或者可以用 "\\uf07b" (Folder)
                      })
                      .on("click", (e, d) => {
                          if(d.data.data) vscode.postMessage({ command: 'jump', data: d.data.data });
                          e.stopPropagation();
                      });

                  // 4. 文字 Label (位置需要调整，避开图标)
                  nodeEnter.append("text")
                      .attr("class", "label")
                      .attr("dy", 3)
                      // 这里的距离要比图标更远一点 (14 + 18 = 32)
                      .attr("x", d => {
                          const gap = d.data.data ? 32 : 14; // 如果有图标，偏移量更大
                          return d.children || d._children ? -gap : gap;
                      })
                      .style("text-anchor", d => d.children || d._children ? "end" : "start")
                      .text(d => {
                          if (d.data.data) {
                              return d.data.data.description || d.data.name; 
                          }
                          return d.data.name;
                      })
                      .on("click", (e, d) => {
                          if(d.data.data) {
                              vscode.postMessage({ command: 'jump', data: d.data.data });
                          }
                          e.stopPropagation();
                      });

                  // 5. 徽标数字
                  nodeEnter.append("text")
                      .attr("class", "badge")
                      .attr("dy", 3)
                      .attr("x", 16) // 组节点通常没有图标，所以位置保持不变，或者根据图标逻辑调整
                      .style("text-anchor", "start")
                      .text(d => d._children ? d._children.length : "")
                      .style("opacity", 0);

                  // Tooltip (逻辑保持不变)
                  const tooltip = d3.select("#tooltip");
                  nodeEnter.on("mouseover", (e, d) => {
                      if (!d.data.data) return;
                      const raw = d.data.data;
                      const content = raw.content ? raw.content.trim() : "No Content";
                      const group = raw.group || "Default";
                      const file = raw.filePath ? raw.filePath.split('/').pop() : "";
                      const line = raw.line || "?";
                      const desc = raw.description || "Anchor Point";
                      const htmlContent = \`
                          <div class="tooltip-header">\${desc}</div>
                          <div class="tooltip-row"><span class="tooltip-label">内容:</span><span class="tooltip-val">\${content}</span></div>
                          <div class="tooltip-row"><span class="tooltip-label">位置:</span><span class="tooltip-val">\${file}:\${line}</span></div>
                          <div class="tooltip-row"><span class="tooltip-label">分组:</span><span class="tooltip-val">\${group}</span></div>
                      \`;
                      tooltip.style("opacity", 1).html(htmlContent).style("left", (e.pageX + 15) + "px").style("top", (e.pageY + 10) + "px");
                  }).on("mouseout", () => tooltip.style("opacity", 0));

                  // Update
                  const nodeUpdate = nodeEnter.merge(node);

                  nodeUpdate.transition().duration(250)
                      .attr("transform", d => "translate(" + d.y + "," + d.x + ")");

                  // 样式逻辑
                  const isGroup = d => d.data.children && d.data.children.length > 0;

                  nodeUpdate.select("circle.outer")
                      .attr("r", d => isGroup(d) ? 8 : 0)
                      .style("opacity", d => isGroup(d) ? 1 : 0);

                  nodeUpdate.select("circle.inner")
                      .attr("r", 4)
                      .attr("class", d => {
                          if (isGroup(d)) {
                              return d._children ? "inner collapsed" : "inner expanded";
                          }
                          return "inner leaf";
                      });

                  nodeUpdate.select(".badge")
                      .text(d => d._children ? d._children.length : "")
                      .transition().duration(250)
                      .style("opacity", d => d._children ? 1 : 0);

                  // Exit
                  const nodeExit = node.exit().transition().duration(250)
                      .attr("transform", d => "translate(" + source.y + "," + source.x + ")")
                      .remove();

                  nodeExit.selectAll("circle").attr("r", 1e-6);
                  nodeExit.select("text").style("fill-opacity", 1e-6);

                  // Links
                  const link = g.selectAll(".link").data(links, d => d.target.id);
                  const linkEnter = link.enter().insert("path", "g")
                      .attr("class", "link")
                      .attr("d", d => {
                          const o = {x: source.x0 || source.x, y: source.y0 || source.y};
                          return d3.linkHorizontal().x(d => d.y).y(d => d.x)({source: o, target: o});
                      });
                  const linkUpdate = linkEnter.merge(link);
                  linkUpdate.transition().duration(250)
                      .attr("d", d3.linkHorizontal().x(d => d.y).y(d => d.x));
                  link.exit().transition().duration(250)
                      .attr("d", d => {
                          const o = {x: source.x, y: source.y};
                          return d3.linkHorizontal().x(d => d.y).y(d => d.x)({source: o, target: o});
                      })
                      .remove();

                  nodes.forEach(d => {
                      d.x0 = d.x;
                      d.y0 = d.y;
                  });
              }

              function toggle(d) {
                  if (d.children) {
                      d._children = d.children;
                      d.children = null;
                  } else {
                      d.children = d._children;
                      d._children = null;
                  }
              }
          </script>
      </body>
      </html>`;
  }

  // --- 3. 列表交互逻辑 (添加、插入、查看子级) ---

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
      const editor = await vscode.window.showTextDocument(doc);
      const lineIndex = Math.max(0, uiLine - 1);
      const pos = new vscode.Position(lineIndex, 0);
      editor.selection = new vscode.Selection(pos, pos);
      editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
    } catch (e) {
      vscode.window.showErrorMessage('无法打开文件: ' + filePath);
    }
  }
}
