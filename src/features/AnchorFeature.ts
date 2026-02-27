import * as vscode from 'vscode';
import * as path from 'path';
import { isNumber, debounce, isFunction } from 'lodash-es';
import { IFeature } from '../core/interfaces/IFeature';
import { AnchorService } from '../services/AnchorService';
import { AnchorCodeLensProvider } from '../providers/AnchorCodeLensProvider';
import { ColorUtils } from '../utils/ColorUtils';
import { ConfigurationService } from '../services/ConfigurationService';
import { TOOLTIPS } from '../core/constants';
import { getAnchorMindMapHtml } from '../views/AnchorWebviewHtml';

export class AnchorFeature implements IFeature {
  public readonly id = 'AnchorFeature';
  private service: AnchorService;
  private configService: ConfigurationService;
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

    // 初始检查当前文件是否有锚点，以决定是否在右上角显示按钮
    this.updateEditorContextKey();

    // 监听事件
    context.subscriptions.push(
      this.service.onDidChangeAnchors(() => {
        this.updateDecorations();
        this.updateEditorContextKey(); // 🌟 数据变化时更新按钮显示状态
        
        // 如果 Webview 打开，实时刷新数据
        if (this.currentPanel) {
          this.currentPanel.webview.postMessage({ command: 'refresh', data: this.service.getMindMapData() });
        }
      }),
      vscode.window.onDidChangeActiveTextEditor(() => {
        this.debouncedUpdate();
        this.updateEditorContextKey(); // 🌟 切换文件时更新按钮显示状态
      }),
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

  // --- 🌟 核心：判断当前文件是否有锚点并控制右上角按钮显示 ---
  private updateEditorContextKey() {
    const editor = vscode.window.activeTextEditor;
    let hasAnchors = false;
    
    if (editor) {
      const rootPath = vscode.workspace.workspaceFolders?.[0].uri.fsPath || '';
      const docPath = editor.document.uri.fsPath;
      const relativePath = path.relative(rootPath, docPath).replace(/\\/g, '/');
      const fileAnchors = this.service.getAnchors().filter(a => a.filePath === relativePath);
      hasAnchors = fileAnchors.length > 0;
    }
    
    // 设置 context 变量，控制 package.json 中的 when 条件
    vscode.commands.executeCommand('setContext', 'quickOps.hasAnchorsInCurrentFile', hasAnchors);
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
  private async openMindMapPanel() {
    const config = this.configService.config?.general || {};
    const mode = config.mindMapPosition || 'right';

    if (this.currentPanel) {
      const revealColumn = mode === 'left' ? vscode.ViewColumn.One : vscode.ViewColumn.Beside;
      this.currentPanel.reveal(revealColumn);
      return;
    }

    let targetColumn = vscode.ViewColumn.Beside;

    if (mode === 'left') {
      await vscode.commands.executeCommand('workbench.action.splitEditorLeft');
      targetColumn = vscode.ViewColumn.Active;
    }

    this.currentPanel = vscode.window.createWebviewPanel('anchorMindMap', 'Anchors Mind Map', targetColumn, {
      enableScripts: true,
      retainContextWhenHidden: true,
    });

    this.currentPanel.webview.html = getAnchorMindMapHtml(this.currentPanel.webview);

    this.currentPanel.webview.onDidReceiveMessage(async (message) => {
      switch (message.command) {
        case 'ready':
        case 'refresh':
          this.currentPanel?.webview.postMessage({ command: 'refresh', data: this.service.getMindMapData() });
          break;
        case 'jump':
          if (message.data) {
            this.openFileAtLine(message.data.filePath, message.data.line);
          }
          break;
        case 'toggleFullscreen':
          try {
            await vscode.commands.executeCommand('workbench.action.toggleMaximizeEditorGroup');
          } catch (e) {
            console.warn('Failed to toggle maximize, trying fallback...', e);
            await vscode.commands.executeCommand('workbench.action.minimizeOtherEditors');
          }
          break;
        case 'anchorAction':
          if (message.action === 'delete') {
            this.service.removeAnchor(message.anchorId);
            vscode.window.showInformationMessage('锚点已删除');
          } else if (message.action === 'edit') {
            const anchor = this.service.getAnchorById(message.anchorId);
            if (anchor) {
                const input = await vscode.window.showInputBox({ 
                    title: '修改锚点备注', 
                    value: anchor.description || '', 
                    validateInput: (t) => (t.trim().length === 0 ? '备注不能为空' : null) 
                });
                if (input !== undefined) {
                    this.service.updateAnchor(message.anchorId, { description: input.trim() });
                    vscode.window.showInformationMessage('备注已更新');
                }
            }
          }
          break;
      }
    });

    this.currentPanel.onDidDispose(() => {
      this.currentPanel = undefined;
    });
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

      if (this.currentPanel && this.currentPanel.visible && this.currentPanel.viewColumn) {
        const mindMapColumn = this.currentPanel.viewColumn;

        if (mindMapColumn === vscode.ViewColumn.One) {
          targetColumn = vscode.ViewColumn.Two;
        } else {
          targetColumn = vscode.ViewColumn.One;
        }
      }

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