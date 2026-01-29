import * as vscode from 'vscode';
import * as path from 'path';
import { isNumber, debounce, isFunction } from 'lodash-es';
import { IFeature } from '../core/interfaces/IFeature';
import { AnchorService } from '../services/AnchorService';
import { AnchorCodeLensProvider } from '../providers/AnchorCodeLensProvider';
import { ColorUtils } from '../utils/ColorUtils';

// 常量定义，方便维护
const TOOLTIPS = {
  ADD_NOTE: '添加备注',
  UP: '上移',
  DOWN: '下移',
  DELETE: '删除',
  NEW_SUBGROUP: '由此创建新分组',
  INSERT_BEFORE: '在此项【之前】插入',
  INSERT_AFTER: '在此项【之后】插入',
  TRASH: '删除',
};

export class AnchorFeature implements IFeature {
  public readonly id = 'AnchorFeature';
  private service: AnchorService;
  private statusBarItem: vscode.StatusBarItem | undefined;
  private decorationTypes: Map<string, vscode.TextEditorDecorationType> = new Map();

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
    this.statusBarItem.command = 'quick-ops.anchor.showMenu';
    this.statusBarItem.show();
    context.subscriptions.push(this.statusBarItem);

    // 监听保存事件并执行同步校对
    context.subscriptions.push(
      this.service.onDidChangeAnchors(() => this.updateDecorations()),
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
      vscode.commands.registerCommand('quick-ops.anchor.showMenu', async () => this.showGroupList(true)),
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

  // --- 辅助方法：获取编辑器上下文 (核心复用逻辑) ---
  private getEditorContext(overrideLineNumber?: number) {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showWarningMessage('请先激活编辑器');
      return null;
    }

    const rootPath = vscode.workspace.workspaceFolders?.[0].uri.fsPath || path.dirname(editor.document.uri.fsPath);
    // 如果没有初始化，顺便初始化
    // this.service.init(rootPath);

    const doc = editor.document;
    // 确定使用的行号 (优先使用 override，否则取光标位)
    const lineIndex = overrideLineNumber !== undefined ? overrideLineNumber : editor.selection.active.line;
    const text = doc.lineAt(lineIndex).text.trim();
    const relativePath = path.relative(rootPath, doc.uri.fsPath).replace(/\\/g, '/');

    return {
      editor,
      doc,
      rootPath,
      relativePath,
      lineIndex, // 0-based index
      uiLineNumber: lineIndex + 1, // 1-based for display
      text,
    };
  }

  // --- 业务逻辑 ---

  private async syncAnchorsWithContent(doc: vscode.TextDocument) {
    const rootPath = vscode.workspace.workspaceFolders?.[0].uri.fsPath || '';
    const relativePath = path.relative(rootPath, doc.uri.fsPath).replace(/\\/g, '/');

    const fileAnchors = this.service.getAnchors().filter((a) => a.filePath === relativePath);
    if (fileAnchors.length === 0) return;

    let hasUpdates = false;

    for (const anchor of fileAnchors) {
      const oldIndex = anchor.line - 1;

      // 1. 原位置匹配，跳过
      if (oldIndex < doc.lineCount && doc.lineAt(oldIndex).text.trim() === anchor.content) {
        continue;
      }

      // 2. 原位置失效，全文搜索
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

      // 3. 全文未找到，更新内容以防止锚点死链
      if (!foundNewSelection) {
        const currentLineIndex = Math.min(anchor.line - 1, doc.lineCount - 1);
        const newContent = doc.lineAt(currentLineIndex).text.trim();
        if (newContent !== anchor.content) {
          this.service.updateAnchor(anchor.id, { content: newContent });
          hasUpdates = true;
        }
      }
    }

    if (hasUpdates) {
      this.updateDecorations();
    }
  }

  private debouncedUpdate = debounce(() => this.updateDecorations(), 200);

  private async handleAddAnchorCommand(...args: any[]) {
    try {
      // 解析参数中的行号 (右键菜单传入)
      let argLineIndex: number | undefined;
      if (args.length > 0 && args[0] && isNumber(args[0].lineNumber)) {
        argLineIndex = args[0].lineNumber - 1; // 转为 0-based
      }

      const ctx = this.getEditorContext(argLineIndex);
      if (!ctx) return;

      this.service.init(ctx.rootPath);

      // 选择分组
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
            // Case A: 空分组 -> 直接添加
            this.service.addAnchor({
              filePath: ctx.relativePath,
              line: ctx.uiLineNumber,
              content: ctx.text,
              sort: 1,
              group: groupName,
            });
            vscode.window.showInformationMessage(`已直接添加到 [${groupName}]`);
          } else {
            // Case B: 有记录 -> 进入插入模式
            // 传入 0-based index 给 showAnchorList, 内部会用来获取 ctx
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

        // 按钮逻辑分流
        // 分组查看模式
        if (defaultAnchorId) {
          if (index > 0) buttons.push({ iconPath: new vscode.ThemeIcon('arrow-up'), tooltip: TOOLTIPS.UP });
          if (index < latestAnchors.length - 1) buttons.push({ iconPath: new vscode.ThemeIcon('arrow-down'), tooltip: TOOLTIPS.DOWN });
          buttons.push({ iconPath: new vscode.ThemeIcon('new-folder'), tooltip: TOOLTIPS.NEW_SUBGROUP });
          buttons.push({ iconPath: new vscode.ThemeIcon('edit'), tooltip: TOOLTIPS.ADD_NOTE });
          buttons.push({ iconPath: new vscode.ThemeIcon('trash', new vscode.ThemeColor('errorForeground')), tooltip: TOOLTIPS.DELETE });
        } else if (isPreviewMode) {
          // 全局预览模式
          buttons.push({ iconPath: new vscode.ThemeIcon('edit'), tooltip: TOOLTIPS.ADD_NOTE });
          buttons.push({ iconPath: new vscode.ThemeIcon('trash', new vscode.ThemeColor('errorForeground')), tooltip: TOOLTIPS.DELETE });
        } else {
          // 插入模式
          buttons = [
            { iconPath: new vscode.ThemeIcon('arrow-up'), tooltip: TOOLTIPS.INSERT_BEFORE },
            { iconPath: new vscode.ThemeIcon('arrow-down'), tooltip: TOOLTIPS.INSERT_AFTER },
            { iconPath: new vscode.ThemeIcon('new-folder'), tooltip: TOOLTIPS.NEW_SUBGROUP },
            { iconPath: new vscode.ThemeIcon('trash', new vscode.ThemeColor('errorForeground')), tooltip: TOOLTIPS.DELETE },
          ];
        }

        let detailText = a.filePath;
        if (a.description?.trim()) {
          detailText = a.description.length > 30 ? `📝 ${a.description.substring(0, 30)}...` : `📝 ${a.description}`;
        }

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

    // 如果是插入模式，显示行号提示
    const insertLineDisplay = pinnedLineIndex !== undefined ? pinnedLineIndex + 1 : '?';
    quickPick.title =
      pinnedLineIndex !== undefined && !isPreviewMode
        ? `${ColorUtils.getEmoji(groupName)} [${groupName}] (待插入: 第 ${insertLineDisplay} 行)`
        : `${ColorUtils.getEmoji(groupName)} [${groupName}] 列表`;

    const refreshList = (targetAnchorId?: string) => {
      const items = mapItems();
      quickPick.items = items;
      // 处理高亮
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
          const input = await vscode.window.showInputBox({
            title: '设置锚点备注',
            value: e.item.rawDescription || '',
            validateInput: (t) => (t.trim().length === 0 ? '备注不能为空' : null),
          });
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

        case TOOLTIPS.NEW_SUBGROUP:
          await this.handleCreateSubGroup(anchorId, pinnedLineIndex);
          // 可能需要刷新列表来反映变化，视具体业务逻辑而定
          refreshList(anchorId);
          break;

        case TOOLTIPS.INSERT_BEFORE:
        case TOOLTIPS.INSERT_AFTER:
          await this.handleInsertAnchor(anchorId, tooltip === TOOLTIPS.INSERT_BEFORE ? 'before' : 'after', groupName, pinnedLineIndex);
          refreshList(); // 插入后刷新
          break;
      }
    });

    quickPick.show();
  }

  // --- 拆分出来的交互逻辑 ---

  private async handleCreateSubGroup(parentId: string, pinnedLineIndex?: number) {
    const parentAnchor = this.service.getAnchorById(parentId);
    if (!parentAnchor) return;

    let targetGroupName = parentAnchor.description;

    // 如果没有备注作为组名，则通过文件名生成建议并询问用户
    if (!targetGroupName) {
      const fileNameWithoutExt = path.parse(parentAnchor.filePath).name;
      const parentDir = path.basename(path.dirname(parentAnchor.filePath));
      const suggestion = path.join(parentDir, fileNameWithoutExt);

      const input = await vscode.window.showInputBox({
        title: '创建新分组 (将当前记录作为子分组)',
        value: suggestion,
        prompt: '确认新分组路径',
      });

      if (!input) return; // 用户取消
      targetGroupName = input.trim();
    }

    // 执行创建逻辑
    this.service.addChild(targetGroupName);

    // 如果处于“插入模式”(有 pinnedLineIndex)，则同时把当前待插入的行作为第一条记录加进去
    const ctx = this.getEditorContext(pinnedLineIndex);
    if (ctx) {
      this.service.addChildAnchor(parentAnchor.id, {
        filePath: ctx.relativePath,
        line: ctx.uiLineNumber,
        content: ctx.text,
        group: targetGroupName,
      });
      vscode.window.showInformationMessage(`已创建子分组: ${targetGroupName}`);
      this.updateDecorations();
    } else {
      // 仅仅是创建结构，不添加额外记录
      vscode.window.showInformationMessage(`已为记录创建子分组结构: ${targetGroupName}`);
    }
  }

  private async handleInsertAnchor(targetId: string, position: 'before' | 'after', groupName: string, pinnedLineIndex?: number) {
    const ctx = this.getEditorContext(pinnedLineIndex);
    if (!ctx) return;

    const newAnchorData = {
      filePath: ctx.relativePath,
      line: ctx.uiLineNumber,
      content: ctx.text,
      group: groupName,
      sort: 0, // sort will be recalculated by service
    };

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
