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

    // 1. CodeLens
    const codeLensProvider = new AnchorCodeLensProvider();
    context.subscriptions.push(vscode.languages.registerCodeLensProvider({ scheme: 'file' }, codeLensProvider));

    // 2. Status Bar
    this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.statusBarItem.text = '$(bookmark) Anchors';
    this.statusBarItem.command = 'quick-ops.anchor.showMenu';
    this.statusBarItem.show();
    context.subscriptions.push(this.statusBarItem);

    // 3. Decorations (Gutter Dots)
    context.subscriptions.push(
      this.service.onDidChangeAnchors(() => this.updateDecorations()),
      vscode.window.onDidChangeActiveTextEditor(() => this.updateDecorations()),
      vscode.workspace.onDidSaveTextDocument(() => this.updateDecorations()),
    );

    setTimeout(() => this.updateDecorations(), 500);

    // ---------------------- Commands ----------------------

    context.subscriptions.push(
      vscode.commands.registerCommand('quick-ops.anchor.add', async (...args: any[]) => {
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

            if (groupName) {
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
          });

          quickPick.show();
        } catch (error) {
          console.error(error);
          vscode.window.showErrorMessage(`添加锚点失败: ${error}`);
        }
      }),
    );

    context.subscriptions.push(
      vscode.commands.registerCommand('quick-ops.anchor.showMenu', async () => {
        this.showGroupList(true);
      }),
    );

    context.subscriptions.push(
      vscode.commands.registerCommand('quick-ops.anchor.listByGroup', async (groupName: string) => {
        this.showAnchorList(groupName, false);
      }),
    );

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

    context.subscriptions.push(
      vscode.commands.registerCommand('quick-ops.anchor.delete', async (id: string) => {
        this.service.removeAnchor(id);
      }),
    );

    console.log(`[${this.id}] Activated.`);
  }

  // -------------------------------------------------------------------------
  // 🔥 核心逻辑：更新行号左侧的彩色圆点
  // -------------------------------------------------------------------------
  private updateDecorations() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    // 1. 清除旧装饰
    this.decorationTypes.forEach((d) => d.dispose());
    this.decorationTypes.clear();

    const rootPath = vscode.workspace.workspaceFolders?.[0].uri.fsPath || '';
    const doc = editor.document;
    const relativePath = path.relative(rootPath, doc.uri.fsPath).replace(/\\/g, '/');
    const anchors = this.service.getAnchors(relativePath);

    if (anchors.length === 0) return;

    const rangesByGroup = new Map<string, vscode.Range[]>();

    anchors.forEach((anchor) => {
      // 过滤掉 endregion
      if (anchor.content.includes('![endregion]')) return;

      // 🔥 关键：anchor.line 是 0-based。
      // 如果 JSON 里存的是 46，这里 range 就是第 47 行。
      // Decoration 会画在第 47 行的行号左边。
      const range = new vscode.Range(anchor.line, 0, anchor.line, 0);

      if (!rangesByGroup.has(anchor.group)) {
        rangesByGroup.set(anchor.group, []);
      }
      rangesByGroup.get(anchor.group)?.push(range);
    });

    rangesByGroup.forEach((ranges, groupName) => {
    //   const color = ColorUtils.getColor(groupName);
    //   const svgUri = ColorUtils.getSvgDotUri(color);

    //   const decorationType = vscode.window.createTextEditorDecorationType({
    //     gutterIconPath: svgUri,
    //     gutterIconSize: 'contain',
    //     // 🔥 修复 1: 彻底移除 overviewRulerColor，这样右侧滚动条就不会有小点了
    //     // overviewRulerColor: color,
    //     // overviewRulerLane: vscode.OverviewRulerLane.Right
    //   });

    //   this.decorationTypes.set(groupName, decorationType);
    //   editor.setDecorations(decorationType, ranges);
    });
  }

  // ------------------------- 辅助 UI 方法 -------------------------

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

  private async showAnchorList(groupName: string, isPreviewMode: boolean) {
    const anchors = this.service.getAnchors().filter((a) => a.group === groupName);

    if (anchors.length === 0) {
      vscode.window.showInformationMessage('该分组下暂无锚点记录');
      return;
    }

    const items = anchors.map((a) => {
      const item: vscode.QuickPickItem & { anchorId: string } = {
        label: `$(file) ${path.basename(a.filePath)} : ${a.line + 1}`,
        description: a.content,
        detail: a.filePath,
        anchorId: a.id,
        buttons: isPreviewMode
          ? [{ iconPath: new vscode.ThemeIcon('trash'), tooltip: '删除' }]
          : [
              { iconPath: new vscode.ThemeIcon('arrow-up'), tooltip: '上一个' },
              { iconPath: new vscode.ThemeIcon('arrow-down'), tooltip: '下一个' },
              { iconPath: new vscode.ThemeIcon('trash'), tooltip: '删除' },
            ],
      };
      return item;
    });

    const quickPick = vscode.window.createQuickPick<any>();
    quickPick.title = `${ColorUtils.getEmoji(groupName)} [${groupName}] 锚点列表`;
    quickPick.items = items;

    quickPick.onDidAccept(() => {
      const selected = quickPick.selectedItems[0];
      if (selected) {
        const anchor = this.service.getAnchorById(selected.anchorId);
        if (anchor) {
          this.openFileAtLine(anchor.filePath, anchor.line);
        }
      }
    });

    quickPick.onDidTriggerItemButton(async (e) => {
      const anchorId = e.item.anchorId;
      const tooltip = e.button.tooltip;

      if (tooltip === '删除') {
        this.service.removeAnchor(anchorId);
        quickPick.items = quickPick.items.filter((i) => i.anchorId !== anchorId);
        this.updateDecorations();
      } else if (tooltip === '上一个') {
        vscode.commands.executeCommand('quick-ops.anchor.navigate', anchorId, 'prev');
      } else if (tooltip === '下一个') {
        vscode.commands.executeCommand('quick-ops.anchor.navigate', anchorId, 'next');
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
