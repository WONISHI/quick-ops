import * as vscode from 'vscode';
import * as path from 'path';
import { isNumber, isFunction, debounce } from 'lodash-es';
import { IFeature } from '../core/interfaces/IFeature';
import { AnchorService } from '../services/AnchorService';
import { AnchorCodeLensProvider } from '../providers/AnchorCodeLensProvider';
import { ColorUtils } from '../utils/ColorUtils';

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

    // 核心改进：监听保存事件并执行同步校对
    context.subscriptions.push(
      this.service.onDidChangeAnchors(() => this.updateDecorations()),
      vscode.window.onDidChangeActiveTextEditor(() => this.debouncedUpdate()),
      vscode.workspace.onDidSaveTextDocument((doc) => this.syncAnchorsWithContent(doc)),
    );

    let timer = setTimeout(() => {
      this.updateDecorations();
      clearTimeout(timer);
    }, 500);

    context.subscriptions.push(
      vscode.commands.registerCommand('quick-ops.anchor.add', async (...args: any[]) => {
        this.handleAddAnchorCommand(...args);
      }),
      vscode.commands.registerCommand('quick-ops.anchor.showMenu', async () => {
        this.showGroupList(true);
      }),
      vscode.commands.registerCommand('quick-ops.anchor.listByGroup', async (groupName: string, anchorId: string) => {
        this.showAnchorList(groupName, true, undefined, anchorId);
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
  }

  /**
   * 核心逻辑：自动校对锚点位置
   */
  private async syncAnchorsWithContent(doc: vscode.TextDocument) {
    const rootPath = vscode.workspace.workspaceFolders?.[0].uri.fsPath || '';
    const relativePath = path.relative(rootPath, doc.uri.fsPath).replace(/\\/g, '/');

    const fileAnchors = this.service.getAnchors().filter((a) => a.filePath === relativePath);
    if (fileAnchors.length === 0) return;

    let hasUpdates = false;

    for (const anchor of fileAnchors) {
      const oldIndex = anchor.line - 1;

      // 1. 如果原位置内容匹配，则无需操作
      if (oldIndex < doc.lineCount && doc.lineAt(oldIndex).text.trim() === anchor.content) {
        continue;
      }

      // 2. 原位置没匹配上，说明行号变了。全文搜索原本的内容
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

      // 3. 全文也没找到原本的内容（说明内容也变了）
      // 此时保持行号，更新内容为该行当前的新内容，防止该锚点以后彻底失效
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
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage('请先激活编辑器');
        return;
      }

      let uiLineNumber: number;
      if (args.length > 0 && args[0] && isNumber(args[0].lineNumber)) {
        uiLineNumber = args[0].lineNumber;
      } else {
        uiLineNumber = editor.selection.active.line + 1;
      }

      const doc = editor.document;
      const targetText = doc.lineAt(uiLineNumber - 1).text.trim();

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
              line: uiLineNumber,
              content: targetText,
              group: groupName,
            });
            vscode.window.showInformationMessage(`已直接添加到 [${groupName}]`);
          } else {
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
        buttons: [{ iconPath: new vscode.ThemeIcon('trash', new vscode.ThemeColor('errorForeground')), tooltip: '删除分组' }],
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
    const selection = await vscode.window.showWarningMessage(confirmMessage, '确认删除', '取消');
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
          if (index > 0) {
            buttons.push({ iconPath: new vscode.ThemeIcon('arrow-up'), tooltip: '上移' });
          }
          if (index < latestAnchors.length - 1) {
            buttons.push({ iconPath: new vscode.ThemeIcon('arrow-down'), tooltip: '下移' });
          }
          buttons.push({ iconPath: new vscode.ThemeIcon('edit'), tooltip: '添加备注' });
          buttons.push({ iconPath: new vscode.ThemeIcon('trash', new vscode.ThemeColor('errorForeground')), tooltip: '删除' });
        } else if (isPreviewMode) {
          buttons.push({ iconPath: new vscode.ThemeIcon('edit'), tooltip: '添加备注' });
          buttons.push({ iconPath: new vscode.ThemeIcon('trash', new vscode.ThemeColor('errorForeground')), tooltip: '删除' });
        } else {
          buttons = [
            { iconPath: new vscode.ThemeIcon('arrow-up'), tooltip: '在此项【之前】插入' },
            { iconPath: new vscode.ThemeIcon('arrow-down'), tooltip: '在此项【之后】插入' },
            { iconPath: new vscode.ThemeIcon('trash', new vscode.ThemeColor('errorForeground')), tooltip: '删除' },
          ];
        }

        let detailText = a.filePath; // 默认展示路径
        if (a.description && a.description.trim()) {
          detailText = a.description.length > 30 ? `📝 ${a.description.substring(0, 30)}...` : `📝 ${a.description}`;
        }

        return {
          label: `${icon} ${path.basename(a.filePath)} : ${a.line}`,
          description: a.content,
          detail: detailText,
          anchorId: a.id,
          buttons: buttons,
          rawDescription: a.description,
        };
      });
    };

    const quickPick = vscode.window.createQuickPick<any>();

    if (pinnedLineIndex !== undefined && !isPreviewMode) {
      quickPick.title = `${ColorUtils.getEmoji(groupName)} [${groupName}] (待插入: 第 ${pinnedLineIndex + 1} 行)`;
    } else {
      quickPick.title = `${ColorUtils.getEmoji(groupName)} [${groupName}] 列表`;
    }

    const refreshList = (targetAnchorId?: string) => {
      const items = mapItems();
      quickPick.items = items;

      // 如果指定了要选中的 ID，则高亮它
      if (targetAnchorId) {
        const targetItem = items.find((item) => item.anchorId === targetAnchorId);
        if (targetItem) {
          quickPick.activeItems = [targetItem];
        }
      } else if (defaultAnchorId && !targetAnchorId) {
        // 初始化时如果有默认 ID，也高亮
        const targetItem = items.find((item) => item.anchorId === defaultAnchorId);
        if (targetItem) {
          quickPick.activeItems = [targetItem];
        }
      }
    };

    // 初始化显示
    refreshList();

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

      if (tooltip === '添加备注') {
        const currentDesc = e.item.rawDescription || '';

        // 弹出输入框
        const input = await vscode.window.showInputBox({
          title: '设置锚点备注',
          placeHolder: '例如：需要重构此逻辑 / 待修复的 Bug',
          value: currentDesc, // 回显已有备注
          validateInput: (text) => {
            return text.trim().length === 0 ? '备注内容不能为空' : null;
          },
        });

        if (input !== undefined) {
          // 用户没有按 Esc 取消
          // 更新 Service
          this.service.updateAnchor(anchorId, { description: input.trim() });
          // 刷新列表显示
          refreshList(anchorId);
          // 刷新编辑器内的 CodeLens
          this.updateDecorations();
          vscode.window.showInformationMessage('备注已更新');
        }
      } else if (tooltip === '上移') {
        this.service.moveAnchor(anchorId, 'up');
        // 移动后刷新，并保持聚焦在当前移动的条目上，方便连续移动
        refreshList(anchorId);
        this.updateDecorations();
      } else if (tooltip === '下移') {
        this.service.moveAnchor(anchorId, 'down');
        refreshList(anchorId);
        this.updateDecorations();
      } else if (tooltip === '删除') {
        this.service.removeAnchor(anchorId);
        refreshList(); // 删除后刷新
        this.updateDecorations();
        if (quickPick.items.length === 0 && isPreviewMode) quickPick.hide();
      } else if (tooltip.includes('插入')) {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
          vscode.window.showWarningMessage('请先激活编辑器');
          return;
        }

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
          line: lineToUseIndex + 1,
          content: text,
          group: groupName,
        };

        if (tooltip.includes('之前')) {
          this.service.insertAnchor(newAnchorData, anchorId, 'before');
        } else {
          this.service.insertAnchor(newAnchorData, anchorId, 'after');
        }

        refreshList();
        this.updateDecorations();
        vscode.window.showInformationMessage(`已插入第 ${lineToUseIndex + 1} 行`);
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
