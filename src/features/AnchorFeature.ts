import * as vscode from 'vscode';
import * as path from 'path';
import { IFeature } from '../core/interfaces/IFeature';
import { AnchorService } from '../services/AnchorService';
import { AnchorCodeLensProvider } from '../providers/AnchorCodeLensProvider';
import { ColorUtils } from '../utils/ColorUtils';

export class AnchorFeature implements IFeature {
  public readonly id = 'AnchorFeature';
  private service: AnchorService;
  private statusBarItem: vscode.StatusBarItem | undefined;
  private decorationTypes: Map<string, vscode.TextEditorDecorationType> = new Map();

  constructor() {
    this.service = AnchorService.getInstance();
  }

  public activate(context: vscode.ExtensionContext): void {
    const rootPath = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
    if (rootPath) {
      this.service.init(rootPath);
    }

    // 1. CodeLens Provider
    const codeLensProvider = new AnchorCodeLensProvider();
    context.subscriptions.push(vscode.languages.registerCodeLensProvider({ scheme: 'file' }, codeLensProvider));

    // 2. Status Bar Item
    this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.statusBarItem.text = '$(bookmark) Anchors';
    this.statusBarItem.command = 'quick-ops.anchor.showMenu';
    this.statusBarItem.show();
    context.subscriptions.push(this.statusBarItem);

    // 3. Decorations (保留监听，但 updateDecorations 内部只做清理)
    context.subscriptions.push(
      this.service.onDidChangeAnchors(() => this.updateDecorations()),
      vscode.window.onDidChangeActiveTextEditor(() => this.updateDecorations()),
      vscode.workspace.onDidSaveTextDocument(() => this.updateDecorations()),
    );

    // 初始化清理一次
    setTimeout(() => this.updateDecorations(), 500);

    // ---------------------- Commands ----------------------

    // Add Anchor
    context.subscriptions.push(
      vscode.commands.registerCommand('quick-ops.anchor.add', async (...args: any[]) => {
        this.handleAddAnchorCommand(...args);
      }),
    );

    // Show Menu
    context.subscriptions.push(
      vscode.commands.registerCommand('quick-ops.anchor.showMenu', async () => {
        this.showGroupList(true);
      }),
    );

    // List By Group
    context.subscriptions.push(
      vscode.commands.registerCommand('quick-ops.anchor.listByGroup', async (groupName: string) => {
        this.showAnchorList(groupName, true);
      }),
    );

    // Navigate
    context.subscriptions.push(
      vscode.commands.registerCommand('quick-ops.anchor.navigate', async (currentId: string, direction: 'prev' | 'next') => {
        const target = this.service.getNeighborAnchor(currentId, direction);
        if (target) {
          this.openFileAtLine(target.filePath, target.line);
        } else {
          vscode.window.showInformationMessage(direction === 'prev' ? '已经是第一个了' : '已经是最后一个了');
        }
      }),
    );

    // Delete
    context.subscriptions.push(
      vscode.commands.registerCommand('quick-ops.anchor.delete', async (id: string) => {
        this.service.removeAnchor(id);
      }),
    );

    console.log(`[${this.id}] Activated.`);
  }

  // -------------------------------------------------------------------------
  // Logic Methods
  // -------------------------------------------------------------------------

  private async handleAddAnchorCommand(...args: any[]) {
    try {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage('请先激活编辑器');
        return;
      }

      // 1. 锁定行号 (优先使用右键菜单传递的行号)
      let targetLine: number;
      if (args.length > 0 && args[0] && typeof args[0].lineNumber === 'number') {
        targetLine = args[0].lineNumber;
      } else if (args.length > 0 && typeof args[0] === 'number') {
        targetLine = args[0];
      } else {
        targetLine = editor.selection.active.line;
      }

      // 2. 锁定内容
      const doc = editor.document;
      const targetTextLine = targetLine - 1;
      const targetText = doc.lineAt(targetTextLine).text.trim();

      // 3. 计算路径
      const workspaceFolders = vscode.workspace.workspaceFolders;
      let rootPath = '';
      if (workspaceFolders && workspaceFolders.length > 0) {
        rootPath = workspaceFolders[0].uri.fsPath;
      } else {
        rootPath = path.dirname(editor.document.uri.fsPath);
        this.service.init(rootPath);
      }
      const relativePath = path.relative(rootPath, doc.uri.fsPath).replace(/\\/g, '/');

      // 4. UI 流程
      const groups = this.service.getGroups();
      const items: vscode.QuickPickItem[] = groups.map((g) => ({
        label: g,
        iconPath: new vscode.ThemeIcon('symbol-folder'),
        description: ColorUtils.getEmoji(g),
      }));

      const quickPick = vscode.window.createQuickPick();

      const previewText = targetText.length > 20 ? targetText.substring(0, 20) + '...' : targetText;
      quickPick.title = `添加锚点: 第 ${targetLine + 1} 行 [${previewText}]`;

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
            // 空组直接添加
            this.service.addAnchor({
              filePath: relativePath,
              line: targetLine,
              content: targetText,
              group: groupName,
            });
            vscode.window.showInformationMessage(`已直接添加到 [${groupName}]`);
          } else {
            // 非空组进入列表
            this.showAnchorList(groupName, false, targetLine);
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

  // 🔥 核心修改：这里只负责清理旧的装饰，不再创建新的
  private updateDecorations() {
    // 仅仅清理旧的，不画新的
    this.decorationTypes.forEach((d) => d.dispose());
    this.decorationTypes.clear();

    // 之前的 rangesByGroup.forEach 逻辑已彻底删除
  }

  private async showGroupList(isPreviewMode: boolean) {
    const groups = this.service.getGroups();
    const items = groups.map((g) => ({
      label: g,
      iconPath: new vscode.ThemeIcon('symbol-folder'),
      description: ColorUtils.getEmoji(g),
    }));

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: '选择要查看的锚点分组',
    });

    if (selected) {
      this.showAnchorList(selected.label, isPreviewMode);
    }
  }

  private async showAnchorList(groupName: string, isPreviewMode: boolean, pinnedLine?: number) {
    const mapItems = () => {
      const latestAnchors = this.service.getAnchors().filter((a) => a.group === groupName);

      const listItems: vscode.QuickPickItem[] = latestAnchors.map((a) => {
        return {
          label: `$(file) ${path.basename(a.filePath)} : ${a.line + 1}`,
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

      return listItems;
    };

    const quickPick = vscode.window.createQuickPick<any>();

    if (pinnedLine !== undefined && !isPreviewMode) {
      quickPick.title = `${ColorUtils.getEmoji(groupName)} [${groupName}] (待插入: 第 ${pinnedLine + 1} 行)`;
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

        let lineToUse: number;
        if (pinnedLine !== undefined) {
          lineToUse = pinnedLine;
        } else {
          lineToUse = editor.selection.active.line;
        }

        const doc = editor.document;
        const text = doc.lineAt(lineToUse).text.trim();

        const rootPath = vscode.workspace.workspaceFolders?.[0].uri.fsPath || '';
        const relativePath = path.relative(rootPath, doc.uri.fsPath).replace(/\\/g, '/');

        const newAnchorData = {
          filePath: relativePath,
          line: lineToUse,
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

        vscode.window.showInformationMessage(`已插入第 ${lineToUse + 1} 行`);
      }
    });

    quickPick.show();
  }

  private async openFileAtLine(filePath: string, line: number) {
    const rootPath = vscode.workspace.workspaceFolders?.[0].uri.fsPath || '';
    const absolutePath = path.join(rootPath, filePath);

    try {
      const doc = await vscode.workspace.openTextDocument(absolutePath);
      const editor = await vscode.window.showTextDocument(doc);

      const pos = new vscode.Position(line, 0);
      editor.selection = new vscode.Selection(pos, pos);
      editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
    } catch (e) {
      vscode.window.showErrorMessage('无法打开文件: ' + filePath);
    }
  }
}
