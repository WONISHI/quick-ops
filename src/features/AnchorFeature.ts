import * as vscode from 'vscode';
import * as path from 'path';
import { isNumber, debounce } from 'lodash-es';
import { IFeature } from '../core/interfaces/IFeature';
import { AnchorService } from '../services/AnchorService';
import { AnchorCodeLensProvider } from '../providers/AnchorCodeLensProvider';
import { ColorUtils } from '../utils/ColorUtils';

export class AnchorFeature implements IFeature {
  public readonly id = 'AnchorFeature';
  private service: AnchorService;
  private statusBarItem: vscode.StatusBarItem | undefined;
  private decorationTypes: Map<string, vscode.TextEditorDecorationType> = new Map();
  private currentPanel: vscode.WebviewPanel | undefined;
  private readonly defaultGroups = ['default', 'Default', 'TODO', 'FIXME'];

  constructor() {
    this.service = AnchorService.getInstance();
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
    this.statusBarItem.command = 'quick-ops.anchor.showMindMap';
    this.statusBarItem.show();
    context.subscriptions.push(this.statusBarItem);

    context.subscriptions.push(
      this.service.onDidChangeAnchors(() => {
        this.updateDecorations();
        if (this.currentPanel) {
          this.currentPanel.webview.postMessage({ command: 'refresh', data: this.service.getMindMapData() });
        }
      }),
      vscode.window.onDidChangeActiveTextEditor(() => this.debouncedUpdate()),
      vscode.workspace.onDidSaveTextDocument((doc) => this.syncAnchorsWithContent(doc)),
    );

    let timer = setTimeout(() => {
      this.updateDecorations();
      clearTimeout(timer);
    }, 500);

    // --- 注册命令 ---
    context.subscriptions.push(
      vscode.commands.registerCommand('quick-ops.anchor.add', async (...args: any[]) => this.handleAddAnchorCommand(...args)),
      vscode.commands.registerCommand('quick-ops.anchor.showMenu', async () => this.showGroupList(true)),
      vscode.commands.registerCommand('quick-ops.anchor.showMindMap', async () => this.openMindMapPanel()),
      vscode.commands.registerCommand('quick-ops.anchor.listByGroup', async (groupName: string, anchorId: string) => this.showAnchorList(groupName, true, undefined, anchorId)),
      vscode.commands.registerCommand('quick-ops.anchor.navigate', async (currentId: string, direction: 'prev' | 'next') => {
        const target = this.service.getNeighborAnchor(currentId, direction);
        if (target) this.openFileAtLine(target.filePath, target.line);
        else vscode.window.showInformationMessage(direction === 'prev' ? '已经是第一个了' : '已经是最后一个了');
      }),
      vscode.commands.registerCommand('quick-ops.anchor.delete', async (id: string) => this.service.removeAnchor(id)),
    );
  }

  // ... syncAnchorsWithContent, debouncedUpdate, updateDecorations, getIconForFile, handleAddAnchorCommand, showGroupList, handleDeleteGroup
  // (这些辅助方法逻辑未变，请保持原样，为了篇幅省略)
  // 请务必保留它们！

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

  private updateDecorations() {
    this.decorationTypes.forEach((d) => d.dispose());
    this.decorationTypes.clear();
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

  private async handleAddAnchorCommand(...args: any[]) {
    try {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage('请先激活编辑器');
        return;
      }
      let uiLineNumber = args[0] && isNumber(args[0].lineNumber) ? args[0].lineNumber : editor.selection.active.line + 1;
      const doc = editor.document;
      const targetText = doc.lineAt(uiLineNumber - 1).text.trim();
      const rootPath = vscode.workspace.workspaceFolders?.[0].uri.fsPath || path.dirname(editor.document.uri.fsPath);
      this.service.init(rootPath);
      const relativePath = path.relative(rootPath, doc.uri.fsPath).replace(/\\/g, '/');
      const groups = this.service.getGroups();
      const items: vscode.QuickPickItem[] = groups.map((g) => ({ label: g, iconPath: new vscode.ThemeIcon('symbol-folder'), description: ColorUtils.getEmoji(g) }));
      const quickPick = vscode.window.createQuickPick();
      const previewText = targetText.length > 20 ? targetText.substring(0, 20) + '...' : targetText;
      quickPick.title = `添加锚点: 第 ${uiLineNumber} 行 [${previewText}]`;
      quickPick.placeholder = '输入新分组名称或从列表中选择';
      quickPick.items = items;
      quickPick.onDidChangeValue((value) => {
        if (value && !groups.includes(value)) quickPick.items = [{ label: value, description: '(新建分组)', iconPath: new vscode.ThemeIcon('add') }, ...items];
        else quickPick.items = items;
      });
      quickPick.onDidAccept(async () => {
        const selected = quickPick.selectedItems[0];
        const groupName = selected ? selected.label : quickPick.value;
        if (groupName) {
          this.service.addGroup(groupName);
          quickPick.hide();
          const existingAnchors = this.service.getAnchors().filter((a) => a.group === groupName);
          if (existingAnchors.length === 0) {
            this.service.addAnchor({ filePath: relativePath, line: uiLineNumber, content: targetText, group: groupName });
            vscode.window.showInformationMessage(`已直接添加到 [${groupName}]`);
          } else {
            this.showAnchorList(groupName, false, uiLineNumber - 1);
          }
        } else {
          quickPick.hide();
        }
      });
      quickPick.show();
    } catch (e) {
      console.error(e);
      vscode.window.showErrorMessage(`Error: ${e}`);
    }
  }

  private showGroupList(isPreviewMode: boolean) {
    const getGroupItems = () =>
      this.service.getGroups().map((g) => ({
        label: g,
        iconPath: new vscode.ThemeIcon('symbol-folder'),
        description: ColorUtils.getEmoji(g),
        buttons: [{ iconPath: new vscode.ThemeIcon('trash', new vscode.ThemeColor('errorForeground')), tooltip: '删除分组' }],
      }));
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
    const selection = await vscode.window.showWarningMessage(isDefault ? `清空 [${groupName}]?` : `删除 [${groupName}]?`, '确认删除', '取消');
    if (selection === '确认删除') {
      const anchors = this.service.getAnchors().filter((a) => a.group === groupName);
      anchors.forEach((a) => this.service.removeAnchor(a.id));
      if (!isDefault) this.service.removeGroup(groupName);
      this.updateDecorations();
    }
  }

  // 🔥 Webview 核心修复：添加 Zoom 支持 🔥
  private openMindMapPanel() {
    if (this.currentPanel) {
      this.currentPanel.reveal(vscode.ViewColumn.One);
      return;
    }

    this.currentPanel = vscode.window.createWebviewPanel('anchorMindMap', 'Anchors Mind Map', vscode.ViewColumn.One, { enableScripts: true, retainContextWhenHidden: true });

    this.currentPanel.webview.html = this.getWebviewContent();
    this.currentPanel.webview.onDidReceiveMessage((message) => {
      switch (message.command) {
        case 'ready':
          this.currentPanel?.webview.postMessage({ command: 'refresh', data: this.service.getMindMapData() });
          break;
        case 'jump':
          this.openFileAtLine(message.data.filePath, message.data.line);
          break;
        case 'refresh':
          this.currentPanel?.webview.postMessage({ command: 'refresh', data: this.service.getMindMapData() });
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
          <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline' https://d3js.org;">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <script src="https://d3js.org/d3.v7.min.js"></script>
          <style>
              body { background-color: var(--vscode-editor-background); color: var(--vscode-editor-foreground); margin: 0; padding: 0; width: 100vw; height: 100vh; overflow: hidden; }
              #tree-container { width: 100%; height: 100%; cursor: move; }
              .node circle { fill: var(--vscode-button-background); stroke: var(--vscode-button-foreground); stroke-width: 1.5px; cursor: pointer; }
              .node text { font: 12px sans-serif; fill: var(--vscode-editor-foreground); cursor: pointer; text-shadow: 0 1px 0 var(--vscode-editor-background); }
              .link { fill: none; stroke: var(--vscode-editor-lineHighlightBorder); stroke-width: 1.5px; }
              .tooltip {
                  position: absolute; pointer-events: none; opacity: 0; 
                  background: var(--vscode-editorHoverWidget-background);
                  border: 1px solid var(--vscode-editorHoverWidget-border);
                  color: var(--vscode-editorHoverWidget-foreground);
                  padding: 8px; border-radius: 4px; font-size: 12px;
                  z-index: 9999; box-shadow: 0 4px 6px rgba(0,0,0,0.3);
                  transition: opacity 0.2s;
              }
              #controls { position: absolute; top: 10px; right: 10px; z-index: 100; display: flex; gap: 8px; }
              button { padding: 6px 12px; cursor: pointer; background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; border-radius: 2px; }
              button:hover { background: var(--vscode-button-hoverBackground); }
          </style>
      </head>
      <body>
          <div id="controls">
            <button id="refresh-btn">刷新</button>
            <button id="center-btn">归位</button>
          </div>
          <div id="tree-container"></div>
          <div id="tooltip" class="tooltip"></div>
          <script>
              const vscode = acquireVsCodeApi();
              vscode.postMessage({ command: 'ready' });

              const width = window.innerWidth;
              const height = window.innerHeight;
              
              // Zoom Behavior
              const zoom = d3.zoom().on("zoom", (e) => {
                  g.attr("transform", e.transform);
              });

              const svg = d3.select("#tree-container").append("svg")
                  .attr("width", "100%")
                  .attr("height", "100%")
                  .call(zoom)
                  .on("dblclick.zoom", null); // Disable double click zoom

              const g = svg.append("g");
              
              const tree = d3.tree().nodeSize([30, 200]); // Fixed node size for better spacing

              document.getElementById('refresh-btn').addEventListener('click', () => vscode.postMessage({ command: 'refresh' }));
              document.getElementById('center-btn').addEventListener('click', () => {
                  svg.transition().duration(750).call(zoom.transform, d3.zoomIdentity.translate(100, height / 2));
              });

              window.addEventListener('message', event => {
                  if (event.data.command === 'refresh') update(event.data.data);
              });

              function update(data) {
                  g.selectAll("*").remove();
                  if (!data || !data.children || data.children.length === 0) {
                      g.append("text").attr("x", 100).attr("y", 100).text("暂无数据").style("fill", "var(--vscode-descriptionForeground)");
                      return;
                  }

                  const root = d3.hierarchy(data);
                  tree(root);

                  // Links
                  g.selectAll(".link").data(root.links()).enter().append("path")
                      .attr("class", "link")
                      .attr("d", d3.linkHorizontal().x(d => d.y).y(d => d.x));

                  // Nodes
                  const node = g.selectAll(".node").data(root.descendants()).enter().append("g")
                      .attr("class", "node")
                      .attr("transform", d => "translate(" + d.y + "," + d.x + ")");

                  node.append("circle").attr("r", 5).on("click", (e, d) => {
                      if(d.data.data) vscode.postMessage({ command: 'jump', data: d.data.data });
                  });

                  // Hover Logic
                  const tooltip = d3.select("#tooltip");
                  let timer;
                  node.on("mouseover", (e, d) => {
                      if (!d.data.data) return;
                      timer = setTimeout(() => {
                          tooltip.style("opacity", 1)
                                 .html("<strong>" + (d.data.data.description || "文件") + "</strong><br/>" + d.data.data.filePath)
                                 .style("left", (e.pageX + 15) + "px")
                                 .style("top", (e.pageY + 10) + "px");
                      }, 100);
                  }).on("mouseout", () => {
                      clearTimeout(timer);
                      tooltip.style("opacity", 0);
                  });

                  node.append("text")
                      .attr("dy", 3)
                      .attr("x", d => d.children ? -8 : 8)
                      .style("text-anchor", d => d.children ? "end" : "start")
                      .text(d => d.data.name);

                  // Auto Center
                  const bounds = g.node().getBBox();
                  const scale = 0.9;
                  // Initial translate
                  svg.call(zoom.transform, d3.zoomIdentity.translate(100, height/2 - (root.x ? 0 : 0))); 
              }
          </script>
      </body>
      </html>`;
  }

  // --- ShowAnchorList 逻辑修复 ---
  private async showAnchorList(groupName: string, isPreviewMode: boolean, pinnedLineIndex?: number, defaultAnchorId?: string, movingAnchorId?: string) {
    const isMoveMode = !!movingAnchorId;

    const mapItems = () => {
      // 筛选：完全匹配 OR 前缀匹配
      const latestAnchors = this.service.getAnchors().filter((a) => {
        return a.group === groupName || a.group.startsWith(groupName + '/');
      });

      return latestAnchors.map((a, index) => {
        const icon = this.getIconForFile(a.filePath);
        let buttons: any[] = [];

        if (isMoveMode) {
          // 移动模式
          buttons = [
            { iconPath: new vscode.ThemeIcon('arrow-up'), tooltip: '移动到此项【之前】' },
            { iconPath: new vscode.ThemeIcon('arrow-down'), tooltip: '移动到此项【之后】' },
          ];
        } else if (defaultAnchorId) {
          // 排序模式
          buttons.push({ iconPath: new vscode.ThemeIcon('sort-precedence'), tooltip: '循环调换顺序' });
          buttons.push({ iconPath: new vscode.ThemeIcon('new-folder'), tooltip: '由此创建新分组' }); // 🔥
          buttons.push({ iconPath: new vscode.ThemeIcon('edit'), tooltip: '添加备注' });
          buttons.push({ iconPath: new vscode.ThemeIcon('trash', new vscode.ThemeColor('errorForeground')), tooltip: '删除' });
        } else if (isPreviewMode) {
          // 预览模式
          buttons.push({ iconPath: new vscode.ThemeIcon('edit'), tooltip: '添加备注' });
          buttons.push({ iconPath: new vscode.ThemeIcon('trash', new vscode.ThemeColor('errorForeground')), tooltip: '删除' });
        } else {
          // 插入模式
          buttons = [
            { iconPath: new vscode.ThemeIcon('arrow-up'), tooltip: '在此项【之前】插入' },
            { iconPath: new vscode.ThemeIcon('arrow-down'), tooltip: '在此项【之后】插入' },
            { iconPath: new vscode.ThemeIcon('new-folder'), tooltip: '由此创建新分组' }, // 🔥
            { iconPath: new vscode.ThemeIcon('edit'), tooltip: '添加备注' },
            { iconPath: new vscode.ThemeIcon('trash', new vscode.ThemeColor('errorForeground')), tooltip: '删除' },
          ];
        }

        const displayLabel = a.group === groupName ? path.basename(a.filePath) : `[${a.group.split('/').pop()}] ${path.basename(a.filePath)}`;
        let detailText = a.filePath;
        if (a.description && a.description.trim()) detailText = `📝 ${a.description}`;

        return {
          label: `${icon} ${displayLabel} : ${a.line}`,
          detail: detailText,
          anchorId: a.id,
          anchorData: a,
          buttons: buttons,
          indexInGroup: index,
          rawDescription: a.description,
        };
      });
    };

    const quickPick = vscode.window.createQuickPick<any>();

    if (isMoveMode) {
      quickPick.title = `正在移动... 请在 [${groupName}] 选择位置`;
      quickPick.placeholder = '点击箭头选择插入位置';
    } else {
      quickPick.title = `${ColorUtils.getEmoji(groupName)} [${groupName}] 列表`;
    }

    const refreshList = (targetAnchorId?: string) => {
      const items = mapItems();
      quickPick.items = items;
      if (targetAnchorId) {
        const t = items.find((i) => i.anchorId === targetAnchorId);
        if (t) quickPick.activeItems = [t];
      } else if (defaultAnchorId && !targetAnchorId && !isMoveMode) {
        const t = items.find((i) => i.anchorId === defaultAnchorId);
        if (t) quickPick.activeItems = [t];
      }
    };

    refreshList();

    quickPick.onDidAccept(() => {
      const selected = quickPick.selectedItems[0];
      if (!selected) return;
      if (!isMoveMode && selected.anchorId) {
        const anchor = this.service.getAnchorById(selected.anchorId);
        if (anchor) this.openFileAtLine(anchor.filePath, anchor.line);
      }
    });

    quickPick.onDidTriggerItemButton(async (e) => {
      const anchorId = e.item.anchorId;
      const tooltip = e.button.tooltip || '';
      const anchorData = e.item.anchorData;

      if (isMoveMode && movingAnchorId) {
        if (tooltip.includes('之前')) this.service.moveAnchorToGroup(movingAnchorId, groupName, e.item.indexInGroup, 'before');
        else this.service.moveAnchorToGroup(movingAnchorId, groupName, e.item.indexInGroup, 'after');
        vscode.window.showInformationMessage('移动成功！');
        quickPick.hide();
        this.updateDecorations();
        return;
      }

      if (tooltip === '循环调换顺序') {
        this.service.cycleAnchorOrder(anchorId);
        refreshList(anchorId);
        this.updateDecorations();
      } else if (tooltip === '由此创建新分组') {
        // 🔥 核心逻辑：原地升级为分组
        // 1. 获取建议名称 (备注 > 文件名)
        const defaultSubName = anchorData.description || path.basename(anchorData.filePath);
        // 2. 构造新组名：CurrentGroup/SubName
        const newGroupPath = `${anchorData.group}/${defaultSubName}`;

        const input = await vscode.window.showInputBox({
          title: '创建新分组 (将当前记录移入其中)',
          value: newGroupPath, // 预填 Current/Name
          prompt: '确认新分组路径，当前记录将成为该分组的第一条',
        });

        if (input) {
          const finalGroupName = input.trim();
          this.service.addGroup(finalGroupName);
          // 将当前记录的 group 属性修改为新路径
          this.service.updateAnchor(anchorId, { ...anchorData, group: finalGroupName });

          vscode.window.showInformationMessage(`已升级为分组: ${finalGroupName}`);
          refreshList(); // 列表刷新后，该条目会显示为子级，或者你需要切换到新列表
          this.updateDecorations();
        }
      } else if (tooltip === '添加备注') {
        const input = await vscode.window.showInputBox({ title: '备注', value: e.item.rawDescription || '' });
        if (input !== undefined) {
          this.service.updateAnchor(anchorId, { description: input.trim() });
          refreshList(anchorId);
          this.updateDecorations();
        }
      } else if (tooltip === '删除') {
        this.service.removeAnchor(anchorId);
        refreshList();
        this.updateDecorations();
        if (quickPick.items.length === 0 && isPreviewMode) quickPick.hide();
      } else if (tooltip.includes('插入')) {
        const editor = vscode.window.activeTextEditor;
        if (!editor) return;
        let lineToUseIndex = pinnedLineIndex !== undefined ? pinnedLineIndex : editor.selection.active.line;
        const doc = editor.document;
        const text = doc.lineAt(lineToUseIndex).text.trim();
        const rootPath = vscode.workspace.workspaceFolders?.[0].uri.fsPath || '';
        const relativePath = path.relative(rootPath, doc.uri.fsPath).replace(/\\/g, '/');
        const newAnchorData = { filePath: relativePath, line: lineToUseIndex + 1, content: text, group: groupName };
        if (tooltip.includes('之前')) this.service.insertAnchor(newAnchorData, anchorId, 'before');
        else this.service.insertAnchor(newAnchorData, anchorId, 'after');
        refreshList();
        this.updateDecorations();
      }
    });

    quickPick.show();
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
