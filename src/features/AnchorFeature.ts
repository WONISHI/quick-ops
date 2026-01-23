import * as vscode from 'vscode';
import * as path from 'path';
import { isNumber, isFunction } from 'lodash-es';
import { IFeature } from '../core/interfaces/IFeature';
import { AnchorService } from '../services/AnchorService';
import { AnchorCodeLensProvider } from '../providers/AnchorCodeLensProvider';
import { ColorUtils } from '../utils/ColorUtils';

export class AnchorFeature implements IFeature {
  public readonly id = 'AnchorFeature';
  private service: AnchorService;
  private statusBarItem: vscode.StatusBarItem | undefined;
  private decorationTypes: Map<string, vscode.TextEditorDecorationType> = new Map();

  // 定义默认分组
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

    context.subscriptions.push(
      this.service.onDidChangeAnchors(() => this.updateDecorations()),
      vscode.window.onDidChangeActiveTextEditor(() => this.updateDecorations()),
      vscode.workspace.onDidSaveTextDocument(() => this.updateDecorations()),
    );
    setTimeout(() => this.updateDecorations(), 500);

    // Commands
    context.subscriptions.push(
      vscode.commands.registerCommand('quick-ops.anchor.add', async (...args: any[]) => {
        this.handleAddAnchorCommand(...args);
      }),
      vscode.commands.registerCommand('quick-ops.anchor.showMenu', async () => {
        this.showGroupList(true);
      }),
      vscode.commands.registerCommand('quick-ops.anchor.listByGroup', async (groupName: string) => {
        this.showAnchorList(groupName, true);
      }),
      vscode.commands.registerCommand('quick-ops.anchor.navigate', async (currentId: string, direction: 'prev' | 'next') => {
        const target = this.service.getNeighborAnchor(currentId, direction);
        if (target) {
          this.openFileAtLine(target.filePath, target.line);
        } else {
          vscode.window.showInformationMessage(direction === 'prev' ? '已经是第一个了' : '已经是最后一个了');
        }
      }),
      vscode.commands.registerCommand('quick-ops.anchor.delete', async (id: string) => {
        this.service.removeAnchor(id);
      }),
    );

    console.log(`[${this.id}] Activated.`);
  }

  // 🔥🔥🔥 核心修复：确保获取到的行号和存储的行号一致（UI行号）
  private async handleAddAnchorCommand(...args: any[]) {
    try {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage('请先激活编辑器');
        return;
      }

      // 1. 确定【UI行号】(即你眼睛看到的行号，从1开始)
      let uiLineNumber: number;

      // 这里的逻辑是：VS Code 右键菜单行为
      // 情况A：在编辑器内容区右键 -> 光标会自动移动到该行 -> 使用 selection (0-based) -> +1
      // 情况B：在左侧行号栏右键 -> 光标不动，args里有 lineNumber (通常是 1-based)

      if (args.length > 0 && args[0] && isNumber(args[0].lineNumber)) {
        // 来自行号栏右键：args[0].lineNumber 已经是 1-based (UI行号)
        uiLineNumber = args[0].lineNumber;
      } else {
        // 来自内容区右键或快捷键：使用光标位置 (0-based) -> 手动 +1
        uiLineNumber = editor.selection.active.line + 1;
      }

      // 2. 获取行内容 (读取文档内容需要 0-based 索引，所以要 -1)
      const doc = editor.document;
      const contentLineIndex = uiLineNumber - 1;
      const targetText = doc.lineAt(contentLineIndex).text.trim();

      const workspaceFolders = vscode.workspace.workspaceFolders;
      let rootPath = '';
      if (workspaceFolders && workspaceFolders.length > 0) {
        rootPath = workspaceFolders[0].uri.fsPath;
      } else {
        rootPath = path.dirname(editor.document.uri.fsPath);
        this.service.init(rootPath);
      }
      const relativePath = path.relative(rootPath, doc.uri.fsPath).replace(/\\/g, '/');

      const groups = this.service.getGroups();
      const items: vscode.QuickPickItem[] = groups.map((g) => ({
        label: g,
        iconPath: new vscode.ThemeIcon('symbol-folder'),
        description: ColorUtils.getEmoji(g),
      }));

      const quickPick = vscode.window.createQuickPick();
      const previewText = targetText.length > 20 ? targetText.substring(0, 20) + '...' : targetText;

      // 标题显示 UI 行号
      quickPick.title = `添加锚点: 第 ${uiLineNumber} 行 [${previewText}]`;
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
              filePath: relativePath,
              // 🔥 存入：UI 行号 (比如 25)
              line: uiLineNumber,
              content: targetText,
              group: groupName,
            });
            vscode.window.showInformationMessage(`已直接添加到 [${groupName}]`);
          } else {
            // 列表显示逻辑里会再处理，传入 0-based index 方便预览高亮
            this.showAnchorList(groupName, false, uiLineNumber - 1);
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
        buttons: [{ iconPath: new vscode.ThemeIcon('trash'), tooltip: '删除分组' }],
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
      const groupName = e.item.label;
      await this.handleDeleteGroup(groupName);
      quickPick.items = getGroupItems();
    });

    quickPick.show();
  }

  private async handleDeleteGroup(groupName: string) {
    const isDefault = this.defaultGroups.includes(groupName);
    const confirmMessage = isDefault ? `是否清空默认分组 [${groupName}] 下的所有记录？` : `确认要删除分组 [${groupName}] 及其下所有记录吗？`;
    const selection = await vscode.window.showWarningMessage(
      confirmMessage,
      '确认删除', // 第一个按钮
      '取消', // 第二个按钮
    );
    if (selection === '确认删除') {
      const anchorsToDelete = this.service.getAnchors().filter((a) => a.group === groupName);
      anchorsToDelete.forEach((anchor) => {
        this.service.removeAnchor(anchor.id);
      });

      if (!isDefault) {
        if (isFunction(this.service.removeGroup)) {
          this.service.removeGroup(groupName);
        }
      }
      this.updateDecorations();
      vscode.window.showInformationMessage(isDefault ? `已清空分组 [${groupName}]` : `已删除分组 [${groupName}]`);
    }
  }

  // pinnedLineIndex 是 0-based (用于高亮代码行)
  private async showAnchorList(groupName: string, isPreviewMode: boolean, pinnedLineIndex?: number) {
    const mapItems = () => {
      const latestAnchors = this.service.getAnchors().filter((a) => a.group === groupName);
      return latestAnchors.map((a) => {
        return {
          // 🔥 显示：直接显示存储的 UI 行号 (比如 25)
          label: `$(file) ${path.basename(a.filePath)} : ${a.line}`,
          description: a.content,
          detail: a.filePath,
          // @ts-ignore
          anchorId: a.id,
          buttons: isPreviewMode
            ? [{ iconPath: new vscode.ThemeIcon('trash'), tooltip: '删除' }]
            : [
                { iconPath: new vscode.ThemeIcon('arrow-up'), tooltip: '在此项【之前】插入' },
                { iconPath: new vscode.ThemeIcon('arrow-down'), tooltip: '在此项【之后】插入' },
                { iconPath: new vscode.ThemeIcon('trash'), tooltip: '删除' },
              ],
        };
      });
    };

    const quickPick = vscode.window.createQuickPick<any>();

    if (pinnedLineIndex !== undefined && !isPreviewMode) {
      quickPick.title = `${ColorUtils.getEmoji(groupName)} [${groupName}] (待插入: 第 ${pinnedLineIndex + 1} 行)`;
    } else {
      quickPick.title = `${ColorUtils.getEmoji(groupName)} [${groupName}] 列表`;
    }

    quickPick.items = mapItems();

    quickPick.onDidAccept(() => {
      const selected = quickPick.selectedItems[0];
      if (!selected) return;
      if (selected.anchorId) {
        const anchor = this.service.getAnchorById(selected.anchorId);
        if (anchor) {
          this.openFileAtLine(anchor.filePath, anchor.line);
        }
      }
    });

    quickPick.onDidTriggerItemButton(async (e) => {
      const anchorId = e.item.anchorId;
      const tooltip = e.button.tooltip || '';

      if (tooltip === '删除') {
        this.service.removeAnchor(anchorId);
        quickPick.items = mapItems();
        this.updateDecorations();
        if (quickPick.items.length === 0 && isPreviewMode) quickPick.hide();
      } else if (tooltip.includes('插入')) {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
          vscode.window.showWarningMessage('请先激活编辑器');
          return;
        }

        // 获取插入点的 0-based index
        let lineToUseIndex: number;
        if (pinnedLineIndex !== undefined) {
          lineToUseIndex = pinnedLineIndex;
        } else {
          lineToUseIndex = editor.selection.active.line;
        }

        const doc = editor.document;
        const text = doc.lineAt(lineToUseIndex).text.trim();
        const rootPath = vscode.workspace.workspaceFolders?.[0].uri.fsPath || '';
        const relativePath = path.relative(rootPath, doc.uri.fsPath).replace(/\\/g, '/');

        const newAnchorData = {
          filePath: relativePath,
          // 🔥 插入也存 UI 行号 (0-based + 1)
          line: lineToUseIndex + 1,
          content: text,
          group: groupName,
        };

        if (tooltip.includes('之前')) {
          this.service.insertAnchor(newAnchorData, anchorId, 'before');
        } else {
          this.service.insertAnchor(newAnchorData, anchorId, 'after');
        }

        quickPick.items = mapItems();
        this.updateDecorations();
        vscode.window.showInformationMessage(`已插入第 ${lineToUseIndex + 1} 行`);
      }
    });

    quickPick.show();
  }

  // 🔥 跳转：UI 行号 (25) -> 内部索引 (24)
  private async openFileAtLine(filePath: string, uiLine: number) {
    const rootPath = vscode.workspace.workspaceFolders?.[0].uri.fsPath || '';
    const absolutePath = path.join(rootPath, filePath);

    try {
      const doc = await vscode.workspace.openTextDocument(absolutePath);
      const editor = await vscode.window.showTextDocument(doc);

      // 减 1 才能对齐
      const lineIndex = Math.max(0, uiLine - 1);
      const pos = new vscode.Position(lineIndex, 0);
      editor.selection = new vscode.Selection(pos, pos);
      editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
    } catch (e) {
      vscode.window.showErrorMessage('无法打开文件: ' + filePath);
    }
  }
}
