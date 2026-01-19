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

    // 3. Decorations
    context.subscriptions.push(
      this.service.onDidChangeAnchors(() => this.updateDecorations()),
      vscode.window.onDidChangeActiveTextEditor(() => this.updateDecorations()),
      vscode.workspace.onDidSaveTextDocument(() => this.updateDecorations()),
    );

    setTimeout(() => this.updateDecorations(), 500);

    // ---------------------- Commands ----------------------

    // Add Anchor
    context.subscriptions.push(
      vscode.commands.registerCommand('quick-ops.anchor.add', async (...args: any[]) => {
        // ... (Add 命令逻辑保持不变，为了节省篇幅略去，请保留之前的代码) ...
        // 如果你需要这部分代码，请告诉我，我可以补全。核心改动在下面的 showAnchorList
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
        this.showAnchorList(groupName, false);
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

  // 把 add 命令逻辑抽离出来方便复用（保持之前的逻辑不变）
  private async handleAddAnchorCommand(...args: any[]) {
    try {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage('请先激活编辑器');
        return;
      }

      let targetLine: number;
      if (args.length > 0 && typeof args[0] === 'number') {
        targetLine = args[0];
      } else {
        targetLine = editor.selection.active.line;
      }

      const workspaceFolders = vscode.workspace.workspaceFolders;
      let rootPath = '';
      if (workspaceFolders && workspaceFolders.length > 0) {
        rootPath = workspaceFolders[0].uri.fsPath;
      } else {
        rootPath = path.dirname(editor.document.uri.fsPath);
        this.service.init(rootPath);
      }

      const doc = editor.document;
      const text = doc.lineAt(targetLine).text.trim();
      const relativePath = path.relative(rootPath, doc.uri.fsPath).replace(/\\/g, '/');

      const groups = this.service.getGroups();
      const items: vscode.QuickPickItem[] = groups.map((g) => ({
        label: g,
        iconPath: new vscode.ThemeIcon('symbol-folder'),
        description: ColorUtils.getEmoji(g),
      }));

      const quickPick = vscode.window.createQuickPick();
      quickPick.title = '选择或创建锚点分组';
      quickPick.placeholder = '输入新分组名称或从列表中选择';
      quickPick.items = items;

      quickPick.onDidChangeValue((value) => {
        if (value && !groups.includes(value)) {
          quickPick.items = [{ label: value, description: '(新建分组)', iconPath: new vscode.ThemeIcon('add') }, ...items];
        } else {
          quickPick.items = items;
        }
      });

      quickPick.onDidAccept(() => {
        const selected = quickPick.selectedItems[0];
        const groupName = selected ? selected.label : quickPick.value;
        const latestAnchors = this.service.getAnchors().filter((a) => a.group === groupName);
        if (groupName) {
          if (!latestAnchors.length) {
            this.service.addGroup(groupName);
            this.service.addAnchor({
              filePath: relativePath,
              line: targetLine,
              content: text,
              group: groupName,
            });
            vscode.window.showInformationMessage(`锚点已添加至 [${groupName}]`);
          }
          quickPick.hide();
          if (latestAnchors.length) {
            this.showAnchorList(groupName, false);
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

  // -------------------------------------------------------------------------
  // Decorations (Gutter Dots)
  // -------------------------------------------------------------------------
  private updateDecorations() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    this.decorationTypes.forEach((d) => d.dispose());
    this.decorationTypes.clear();

    const rootPath = vscode.workspace.workspaceFolders?.[0].uri.fsPath || '';
    const doc = editor.document;
    const relativePath = path.relative(rootPath, doc.uri.fsPath).replace(/\\/g, '/');
    const anchors = this.service.getAnchors(relativePath);

    if (anchors.length === 0) return;

    const rangesByGroup = new Map<string, vscode.Range[]>();

    anchors.forEach((anchor) => {
      if (anchor.content.includes('![endregion]')) return;

      const range = new vscode.Range(anchor.line, 0, anchor.line, 0);
      if (!rangesByGroup.has(anchor.group)) {
        rangesByGroup.set(anchor.group, []);
      }
      rangesByGroup.get(anchor.group)?.push(range);
    });
  }

  // ------------------------- UI Methods -------------------------

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

  // 🔥 核心修改：修复 showAnchorList 的按钮逻辑
  private async showAnchorList(groupName: string, isPreviewMode: boolean) {
    // 获取该组锚点 (Service 已经保证了顺序就是用户定义的顺序)
    const currentAnchors = this.service.getAnchors().filter((a) => a.group === groupName);

    if (currentAnchors.length === 0 && isPreviewMode) {
      vscode.window.showInformationMessage('该分组下暂无锚点记录');
      return;
    }

    // 封装获取 items 的逻辑，方便刷新
    const mapItems = () => {
      // 重新获取最新的顺序
      const latestAnchors = this.service.getAnchors().filter((a) => a.group === groupName);
      return latestAnchors.map((a) => {
        const item: vscode.QuickPickItem & { anchorId: string } = {
          label: `$(file) ${path.basename(a.filePath)} : ${a.line + 1}`,
          description: a.content,
          detail: a.filePath,
          anchorId: a.id,
          // 按钮定义
          buttons: isPreviewMode
            ? [{ iconPath: new vscode.ThemeIcon('trash'), tooltip: '删除' }]
            : [
                // 🔥 修改提示语，明确含义
                { iconPath: new vscode.ThemeIcon('arrow-up'), tooltip: '在此项【之前】插入当前光标' },
                { iconPath: new vscode.ThemeIcon('arrow-down'), tooltip: '在此项【之后】插入当前光标' },
                { iconPath: new vscode.ThemeIcon('trash'), tooltip: '删除' },
              ],
        };
        return item;
      });
    };

    const quickPick = vscode.window.createQuickPick<any>();
    quickPick.title = `${ColorUtils.getEmoji(groupName)} [${groupName}] 锚点列表 (自定义顺序)`;
    quickPick.items = mapItems();

    // 点击跳转
    quickPick.onDidAccept(() => {
      const selected = quickPick.selectedItems[0];
      if (selected) {
        const anchor = this.service.getAnchorById(selected.anchorId);
        if (anchor) {
          this.openFileAtLine(anchor.filePath, anchor.line);
        }
      }
    });

    // 按钮触发
    quickPick.onDidTriggerItemButton(async (e) => {
      const anchorId = e.item.anchorId;
      const tooltip = e.button.tooltip || '';

      // --- 删除 ---
      if (tooltip === '删除') {
        this.service.removeAnchor(anchorId);
        quickPick.items = mapItems();
        this.updateDecorations();
        if (quickPick.items.length === 0) quickPick.hide();
      }

      // --- 🔥 插入逻辑 ---
      else if (tooltip.includes('插入')) {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
          vscode.window.showWarningMessage('请先在编辑器中选中要插入的行');
          return;
        }

        const currentLine = editor.selection.active.line;
        const doc = editor.document;
        const text = doc.lineAt(currentLine).text.trim();

        const rootPath = vscode.workspace.workspaceFolders?.[0].uri.fsPath || '';
        const relativePath = path.relative(rootPath, doc.uri.fsPath).replace(/\\/g, '/');

        const newAnchorData = {
          filePath: relativePath,
          line: currentLine,
          content: text,
          group: groupName,
        };

        // 🔥 关键判断：是插在前面还是后面
        if (tooltip.includes('之前')) {
          // 上箭头：插在该项前面
          // 效果：列表变成 [新项, 选中项]。选中项点"上一个" -> 新项。
          this.service.insertAnchor(newAnchorData, anchorId, 'before');
        } else {
          // 下箭头：插在该项后面
          this.service.insertAnchor(newAnchorData, anchorId, 'after');
        }

        // 刷新 UI
        quickPick.items = mapItems();
        this.updateDecorations();

        vscode.window.showInformationMessage(`已插入新锚点 (行 ${currentLine + 1})`);
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
