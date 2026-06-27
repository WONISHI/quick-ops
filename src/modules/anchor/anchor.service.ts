import * as vscode from 'vscode';
import * as path from 'path';
import { debounce, isFunction, isNumber } from 'lodash-es';
import { ExtensionContextProvider } from '@/common/providers/extension-context.provider';
import { AnchorCodeLensProvider } from './prooviders/anchor-code-lens.provider';
import { getReactWebviewHtml } from '@/utils/WebviewHelper';
import { ColorUtils } from '@/utils/ColorUtils';
import { ConfigurationService } from '@/common/services/configuration.service';
import type {
  AnchorChildCreateInput,
  AnchorConfig,
  AnchorCreateInput,
  AnchorData,
  AnchorDirection,
  AnchorEditorContext,
  AnchorInsertPosition,
  AnchorMindMapNode,
  AnchorMoveDirection,
  AnchorQuickPickItem,
  AnchorUpdateInput,
  AnchorWebviewMessage,
} from './anchor.type';

const ANCHOR_TOOLTIPS = {
  ADD_NOTE: '添加备注',
  UP: '上移',
  DOWN: '下移',
  DELETE: '删除',
  NEW_SUBGROUP: '由此创建新分组',
  VIEW_CHILDREN: '查看子级',
  INSERT_BEFORE: '在此项〖之前〗插入',
  INSERT_AFTER: '在此项〖之后〗插入',
} as const;

export class AnchorService {
  public static inject = [ConfigurationService];

  // 工作区存储的 Key
  private readonly stateKey = 'quickOps.workspaceAnchors';
  private readonly defaultGroups = ['default', 'Default', 'TODO', 'FIXME'];

  private context?: vscode.ExtensionContext;
  private currentPanel?: vscode.WebviewPanel;

  private anchors: AnchorData[] = [];
  private flotAnchors: AnchorData[] = [];
  private groups: string[] = ['Default'];
  private itemGroups: string[] = [];

  private readonly decorationTypes = new Map<string, vscode.TextEditorDecorationType>();

  private readonly changeEmitter = new vscode.EventEmitter<void>();
  public readonly onDidChangeAnchors = this.changeEmitter.event;

  private readonly debouncedSave = debounce(() => {
    void this.persist();
  }, 500);

  private readonly debouncedUpdate = debounce(() => {
    this.updateDecorations();
  }, 200);

  constructor(
    private readonly configurationService: ConfigurationService,
    private readonly extensionContextProvider: ExtensionContextProvider,
  ) {}

  /**
   * @description 服务初始化
   * @param context
   */
  public init(context: vscode.ExtensionContext): void {
    this.context = context;
    this.load();
  }

  public dispose(): void {
    this.debouncedSave.cancel();
    this.debouncedUpdate.cancel();

    this.currentPanel?.dispose();
    this.currentPanel = undefined;

    this.disposeDecorations();
    this.changeEmitter.dispose();
  }

  public createCodeLensProvider(): vscode.CodeLensProvider {
    return new AnchorCodeLensProvider(this, this.extensionContextProvider);
  }

  /**
   * @description 检查是否含有锚点
   */
  public checkContainsAnchor(): void {
    const allAnchors = this.getAnchors();
    const hasAnchors = allAnchors.length > 0;
    void vscode.commands.executeCommand('setContext', 'quickOps.hasAnchorsInProject', hasAnchors);
  }

  public updateDecorationsDebounced(): void {
    this.debouncedUpdate();
  }

  public updateDecorations(): void {
    this.disposeDecorations();
  }

  public refreshMindMapPanel(): void {
    if (!this.currentPanel) return;

    void this.currentPanel.webview.postMessage({
      command: 'refresh',
      data: this.getMindMapData(),
    });
  }

  public async handleShowMenuCommand(): Promise<void> {
    const config = this.configurationService.config?.general || {};
    const mode = config.anchorViewMode || 'menu';

    if (mode === 'mindmap') {
      await this.openMindMapPanel();
      return;
    }

    this.showGroupList(true);
  }

  public async handleAddAnchorCommand(...args: any[]): Promise<void> {
    try {
      let argLineIndex: number | undefined;

      if (args.length > 0 && args[0] && isNumber(args[0].lineNumber)) {
        argLineIndex = args[0].lineNumber - 1;
      }
      const ctx = this.getEditorContext(argLineIndex);
      if (!ctx) return;
      const groups = this.getGroups();
      const items: vscode.QuickPickItem[] = groups.map((group) => ({
        label: group,
        iconPath: new vscode.ThemeIcon('symbol-folder'),
        description: ColorUtils.getEmoji(group),
      }));

      const quickPick = vscode.window.createQuickPick();
      const previewText = ctx.text.length > 20 ? `${ctx.text.substring(0, 20)}...` : ctx.text;
      quickPick.title = `添加锚点: 第 ${ctx.uiLineNumber} 行 [${previewText}]`;
      quickPick.placeholder = '输入新分组名称或从列表中选择';
      quickPick.items = items;

      quickPick.onDidChangeValue((value) => {
        if (value && !groups.includes(value)) {
          quickPick.items = [
            {
              label: value,
              description: '(新建分组)',
              iconPath: new vscode.ThemeIcon('add'),
            },
            ...items,
          ];
          return;
        }

        quickPick.items = items;
      });

      quickPick.onDidAccept(async () => {
        const selected = quickPick.selectedItems[0];
        const groupName = selected ? selected.label : quickPick.value;

        if (!groupName) {
          quickPick.hide();
          return;
        }

        this.addGroup(groupName);
        quickPick.hide();

        const existingAnchors = this.getAnchors().filter((anchor) => anchor.group === groupName);

        if (existingAnchors.length === 0) {
          this.addAnchor({
            filePath: ctx.relativePath,
            line: ctx.uiLineNumber,
            content: ctx.text,
            sort: 1,
            group: groupName,
          });

          vscode.window.showInformationMessage(`已直接添加到 [${groupName}]`);
          return;
        }

        await this.showAnchorList(groupName, false, ctx.lineIndex);
      });

      quickPick.show();
    } catch (error) {
      console.error(error);
      vscode.window.showErrorMessage(`添加锚点失败: ${this.toErrorMessage(error)}`);
    }
  }

  public async showAnchorList(groupName: string, isPreviewMode: boolean, pinnedLineIndex?: number, defaultAnchorId?: string): Promise<void> {
    const quickPick = vscode.window.createQuickPick<AnchorQuickPickItem>();

    const insertLineDisplay = pinnedLineIndex !== undefined ? pinnedLineIndex + 1 : '?';

    quickPick.title =
      pinnedLineIndex !== undefined && !isPreviewMode
        ? `${ColorUtils.getEmoji(groupName)} [${groupName}] (待插入: 第 ${insertLineDisplay} 行)`
        : `${ColorUtils.getEmoji(groupName)} [${groupName}] 列表`;

    const mapItems = (): AnchorQuickPickItem[] => {
      const latestAnchors = this.anchors.filter((anchor) => anchor.group === groupName);

      return latestAnchors.map((anchor, index) => {
        const icon = this.getIconForFile(anchor.filePath);
        const buttons = this.getAnchorButtons(anchor, index, latestAnchors.length, isPreviewMode, Boolean(defaultAnchorId));

        let detailText = anchor.filePath;

        if (anchor.description?.trim()) {
          detailText = anchor.description.length > 30 ? ` ${anchor.description.substring(0, 30)}...` : ` ${anchor.description}`;
        }

        return {
          label: `${anchor.items?.length ? '$(symbol-folder)' : icon} ${path.basename(anchor.filePath)} : ${anchor.line}`,
          description: anchor.content,
          detail: detailText,
          anchorId: anchor.id,
          buttons,
          rawDescription: anchor.description,
        };
      });
    };

    const refreshList = (targetAnchorId?: string): void => {
      const items = mapItems();

      quickPick.items = items;

      const idToSelect = targetAnchorId || (defaultAnchorId && !targetAnchorId ? defaultAnchorId : undefined);

      if (!idToSelect) return;

      const targetItem = items.find((item) => item.anchorId === idToSelect);

      if (targetItem) {
        quickPick.activeItems = [targetItem];
      }
    };

    refreshList();

    quickPick.onDidAccept(() => {
      const selected = quickPick.selectedItems[0];

      if (!selected?.anchorId) return;

      const anchor = this.getAnchorById(selected.anchorId);

      if (anchor) {
        void this.openFileAtLine(anchor.filePath, anchor.line);
      }
    });

    quickPick.onDidTriggerItemButton(async (event) => {
      const anchorId = event.item.anchorId;
      const tooltip = String(event.button.tooltip || '');

      if (!anchorId) return;

      switch (tooltip) {
        case ANCHOR_TOOLTIPS.ADD_NOTE: {
          const input = await vscode.window.showInputBox({
            title: '设置锚点备注',
            value: event.item.rawDescription || '',
            validateInput: (text) => (text.trim().length === 0 ? '备注不能为空' : null),
          });

          if (input !== undefined) {
            this.updateAnchor(anchorId, {
              description: input.trim(),
            });

            refreshList(anchorId);
            this.updateDecorations();

            vscode.window.showInformationMessage('备注已更新');
          }

          break;
        }

        case ANCHOR_TOOLTIPS.UP:
          this.moveAnchor(anchorId, 'up');
          refreshList(anchorId);
          this.updateDecorations();
          break;

        case ANCHOR_TOOLTIPS.DOWN:
          this.moveAnchor(anchorId, 'down');
          refreshList(anchorId);
          this.updateDecorations();
          break;

        case ANCHOR_TOOLTIPS.DELETE:
          this.removeAnchor(anchorId);
          refreshList();
          this.updateDecorations();

          if (quickPick.items.length === 0 && isPreviewMode) {
            quickPick.hide();
          }

          break;

        case ANCHOR_TOOLTIPS.VIEW_CHILDREN:
          await this.handleViewChildren(anchorId, pinnedLineIndex, isPreviewMode, defaultAnchorId);
          break;

        case ANCHOR_TOOLTIPS.NEW_SUBGROUP:
          await this.handleCreateSubGroup(anchorId, pinnedLineIndex);
          refreshList(anchorId);
          break;

        case ANCHOR_TOOLTIPS.INSERT_BEFORE:
        case ANCHOR_TOOLTIPS.INSERT_AFTER:
          await this.handleInsertAnchor(anchorId, tooltip === ANCHOR_TOOLTIPS.INSERT_BEFORE ? 'before' : 'after', groupName, pinnedLineIndex);

          refreshList();

          setTimeout(() => {
            quickPick.hide();
          }, 1000);

          break;
      }
    });

    quickPick.show();
  }

  public async navigateAnchor(currentId: string, direction: AnchorDirection): Promise<void> {
    const target = this.getNeighborAnchor(currentId, direction);

    if (target) {
      await this.openFileAtLine(target.filePath, target.line);
      return;
    }

    vscode.window.showInformationMessage(direction === 'prev' ? '已经是第一个了' : '已经是最后一个了');
  }

  public async syncAnchorsWithContent(doc: vscode.TextDocument): Promise<void> {
    const rootPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
    const relativePath = path.relative(rootPath, doc.uri.fsPath).replace(/\\/g, '/');

    const fileAnchors = this.getAnchors().filter((anchor) => anchor.filePath === relativePath);

    if (fileAnchors.length === 0) return;

    let hasUpdates = false;

    for (const anchor of fileAnchors) {
      const oldIndex = anchor.line - 1;

      if (oldIndex < doc.lineCount && doc.lineAt(oldIndex).text.trim() === anchor.content) {
        continue;
      }

      let foundNewSelection = false;

      for (let i = 0; i < doc.lineCount; i++) {
        const lineText = doc.lineAt(i).text.trim();

        if (lineText === anchor.content && lineText !== '') {
          this.updateAnchor(anchor.id, {
            line: i + 1,
          });

          foundNewSelection = true;
          hasUpdates = true;
          break;
        }
      }

      if (!foundNewSelection) {
        const currentLineIndex = Math.min(anchor.line - 1, doc.lineCount - 1);
        const newContent = doc.lineAt(currentLineIndex).text.trim();

        if (newContent !== anchor.content) {
          this.updateAnchor(anchor.id, {
            content: newContent,
          });

          hasUpdates = true;
        }
      }
    }

    if (hasUpdates) {
      this.updateDecorations();
    }
  }

  public getAnchors(filePath?: string): AnchorData[] {
    if (filePath) {
      const targetPath = this.normalizePath(filePath);

      return this.flotAnchors.filter((anchor) => this.normalizePath(anchor.filePath) === targetPath);
    }

    return this.flotAnchors;
  }

  public getGroups(): string[] {
    return this.groups;
  }

  public addGroup(group: string): void {
    if (!this.groups.includes(group)) {
      this.groups.push(group);
      this.save();
    }
  }

  public addChild(group: string): void {
    if (!this.itemGroups.includes(group)) {
      this.itemGroups.push(group);
      this.save();
    }
  }

  public removeGroup(group: string): void {
    this.groups = this.groups.filter((item) => item !== group);
    this.save();
  }

  public addAnchor(anchor: AnchorCreateInput): void {
    const newAnchor: AnchorData = {
      ...anchor,
      id: this.createId(),
      timestamp: Date.now(),
      items: [],
    };

    const groupAnchors = this.anchors.filter((item) => item.group === anchor.group);

    if (groupAnchors.length > 0) {
      const lastAnchor = groupAnchors[groupAnchors.length - 1];
      const lastSort = Number(lastAnchor.sort || 0);

      newAnchor.sort = Number.isNaN(lastSort) ? 1 : lastSort + 1;
    } else {
      newAnchor.sort = 1;
    }

    this.anchors.push(newAnchor);
    this.save();
  }

  public addChildAnchor(parentId: string, anchor: AnchorChildCreateInput): void {
    const parent = this.getAnchorById(parentId);

    if (!parent) return;

    const newAnchor: AnchorData = {
      ...anchor,
      id: this.createId(),
      timestamp: Date.now(),
      pid: parentId,
      items: [],
      sort: parent.items ? parent.items.length + 1 : 1,
    };

    if (!parent.items) {
      parent.items = [];
    }

    parent.items.push(newAnchor);
    this.save();
  }

  public insertAnchor(anchor: AnchorCreateInput, targetId: string, position: AnchorInsertPosition): void {
    const container = this.findContainerArray(targetId, this.anchors);

    if (!container) {
      this.addAnchor({
        ...anchor,
        sort: 1,
      });
      return;
    }

    const { list, index } = container;

    const newAnchor: AnchorData = {
      ...anchor,
      id: this.createId(),
      timestamp: Date.now(),
      items: [],
      sort: undefined,
    };

    const targetItem = list[index];

    if (targetItem.pid) {
      newAnchor.pid = targetItem.pid;
    }

    if (position === 'before') {
      list.splice(index, 0, newAnchor);
    } else {
      list.splice(index + 1, 0, newAnchor);
    }

    let sortCounter = 1;

    list.forEach((item) => {
      if (item.group === newAnchor.group) {
        item.sort = sortCounter++;
      }
    });

    this.save();
  }

  public removeAnchor(id: string): void {
    const container = this.findContainerArray(id, this.anchors);

    if (!container) return;

    container.list.splice(container.index, 1);
    container.list.forEach((item, index) => {
      item.sort = index + 1;
    });

    this.save();
  }

  public updateAnchor(id: string, updates: AnchorUpdateInput): void {
    const anchor = this.getAnchorById(id);

    if (!anchor) return;

    let changed = false;

    if (updates.line !== undefined && anchor.line !== updates.line) {
      anchor.line = updates.line;
      changed = true;
    }

    if (updates.content !== undefined && anchor.content !== updates.content) {
      anchor.content = updates.content;
      changed = true;
    }

    if (updates.description !== undefined && anchor.description !== updates.description) {
      anchor.description = updates.description;

      if (anchor.items?.length && anchor.description) {
        this.updateChildrenGroup(anchor.items, anchor.description);
      }

      changed = true;
    }

    if (changed) {
      this.save();
    }
  }

  public updateAnchorLine(id: string, newLine: number): void {
    this.updateAnchor(id, {
      line: newLine,
    });
  }

  public moveAnchor(id: string, direction: AnchorMoveDirection): void {
    const container = this.findContainerArray(id, this.anchors);

    if (!container) return;

    const { list, index } = container;

    let targetIndex = -1;

    if (direction === 'up') {
      if (index > 0) {
        targetIndex = index - 1;
      }
    } else if (index < list.length - 1) {
      targetIndex = index + 1;
    }

    if (targetIndex === -1) return;

    [list[index], list[targetIndex]] = [list[targetIndex], list[index]];

    list.forEach((item, itemIndex) => {
      item.sort = itemIndex + 1;
    });

    this.save();
  }

  public getAnchorById(id: string): AnchorData | undefined {
    let found = this.flotAnchors.find((anchor) => anchor.id === id);

    if (!found) {
      this.refreshFlotAnchors();
      found = this.flotAnchors.find((anchor) => anchor.id === id);
    }

    return found;
  }

  public getNeighborAnchor(currentId: string, direction: AnchorDirection): AnchorData | undefined {
    const currentAnchor = this.getAnchorById(currentId);

    if (!currentAnchor) return undefined;

    const groupAnchors = this.flotAnchors.filter((anchor) => anchor.group === currentAnchor.group);

    const index = groupAnchors.findIndex((anchor) => anchor.id === currentId);

    if (index === -1) return undefined;

    if (direction === 'prev') {
      return index > 0 ? groupAnchors[index - 1] : undefined;
    }

    return index < groupAnchors.length - 1 ? groupAnchors[index + 1] : undefined;
  }

  public getMindMapData(): AnchorMindMapNode {
    const root: AnchorMindMapNode = {
      name: 'Anchors',
      children: [],
    };

    this.groups.forEach((groupName) => {
      const groupAnchors = this.anchors.filter((anchor) => anchor.group === groupName);

      const transform = (anchor: AnchorData): AnchorMindMapNode => {
        const fileName = anchor.filePath.split(/[/\\]/).pop() || anchor.filePath;

        return {
          name: anchor.description || fileName,
          id: anchor.id,
          data: anchor,
          children: anchor.items ? anchor.items.map(transform) : [],
        };
      };

      const groupNode: AnchorMindMapNode = {
        name: groupName,
        children: groupAnchors.map(transform),
      };

      if (groupNode.children?.length) {
        root.children?.push(groupNode);
      }
    });

    return root;
  }

  /**
   * @description 加载工作区的锚点
   * @returns
   */
  private load(): void {
    if (!this.context) return;

    try {
      const data = this.context.workspaceState.get<AnchorConfig>(this.stateKey);
      if (data) {
        this.anchors = data.anchors || [];
        this.groups = data.groups || ['Default'];
        this.itemGroups = data.children || [];
      } else {
        this.anchors = [];
        this.groups = ['Default'];
        this.itemGroups = [];
      }

      this.refreshFlotAnchors();
      // 主动通知所有监听了 onDidChangeAnchors 的地方：锚点数据发生变化了，你们该刷新了。
      this.changeEmitter.fire();
    } catch (error) {
      console.error('Failed to load anchors from workspace state', error);
    }
  }

  private save(): void {
    this.refreshFlotAnchors();
    this.changeEmitter.fire();
    this.debouncedSave();
  }

  private async persist(): Promise<void> {
    if (!this.context) return;
    const data: AnchorConfig = {
      groups: this.groups,
      children: this.itemGroups,
      anchors: this.anchors,
    };
    try {
      await this.context.workspaceState.update(this.stateKey, data);
    } catch (error) {
      vscode.window.showErrorMessage(`无法保存锚点到工作区状态: ${this.toErrorMessage(error)}`);
    }
  }

  /**
   * @description 树形锚点数据拍平成一维数组
   * getAnchors()、getAnchorById()、getNeighborAnchor() 都依赖 flotAnchors
   */
  private refreshFlotAnchors(): void {
    const allAnchors = new Set<AnchorData>();
    const traverse = (items: AnchorData[]): void => {
      items.forEach((item) => {
        allAnchors.add(item);
        if (item.items?.length) {
          traverse(item.items);
        }
      });
    };
    if (this.anchors.length) {
      traverse(this.anchors);
    }
    this.flotAnchors = Array.from(allAnchors);
  }

  private findContainerArray(targetId: string, currentList: AnchorData[]): { list: AnchorData[]; index: number } | null {
    const index = currentList.findIndex((anchor) => anchor.id === targetId);

    if (index !== -1) {
      return {
        list: currentList,
        index,
      };
    }

    for (const item of currentList) {
      if (item.items?.length) {
        const found = this.findContainerArray(targetId, item.items);

        if (found) return found;
      }
    }

    return null;
  }

  private updateChildrenGroup(items: AnchorData[], newGroupName: string): void {
    items.forEach((child) => {
      child.group = newGroupName;

      if (child.items?.length) {
        this.updateChildrenGroup(child.items, newGroupName);
      }
    });
  }

  private async openMindMapPanel(): Promise<void> {
    if (!this.context) return;
    const config = this.configurationService.config?.general || {};
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
      localResourceRoots: [this.context.extensionUri],
    });
    this.currentPanel.webview.html = getReactWebviewHtml(this.context.extensionUri, this.currentPanel.webview, '/anchor');
    this.currentPanel.webview.onDidReceiveMessage(async (message: AnchorWebviewMessage) => {
      await this.handleMindMapMessage(message);
    });
    this.currentPanel.onDidDispose(() => {
      this.currentPanel = undefined;
    });
  }

  private async handleMindMapMessage(message: AnchorWebviewMessage): Promise<void> {
    switch (message.command) {
      case 'ready':
      case 'refresh':
        this.refreshMindMapPanel();
        break;

      case 'jump':
        if (message.data) {
          await this.openFileAtLine(message.data.filePath, message.data.line);
        }
        break;

      case 'toggleFullscreen':
        try {
          await vscode.commands.executeCommand('workbench.action.toggleMaximizeEditorGroup');
        } catch (error) {
          console.warn('Failed to toggle maximize, trying fallback...', error);
          await vscode.commands.executeCommand('workbench.action.minimizeOtherEditors');
        }
        break;

      case 'anchorAction':
        await this.handleMindMapAnchorAction(message);
        break;
    }
  }

  private async handleMindMapAnchorAction(message: AnchorWebviewMessage): Promise<void> {
    if (!message.anchorId) return;

    if (message.action === 'delete') {
      this.removeAnchor(message.anchorId);
      vscode.window.showInformationMessage('锚点已删除');
      return;
    }

    if (message.action === 'edit') {
      const anchor = this.getAnchorById(message.anchorId);

      if (!anchor) return;

      const input = await vscode.window.showInputBox({
        title: '修改锚点备注',
        value: anchor.description || '',
        validateInput: (text) => (text.trim().length === 0 ? '备注不能为空' : null),
      });

      if (input !== undefined) {
        this.updateAnchor(message.anchorId, {
          description: input.trim(),
        });

        vscode.window.showInformationMessage('备注已更新');
      }
    }
  }

  private getEditorContext(overrideLineNumber?: number): AnchorEditorContext | null {
    const editor = vscode.window.activeTextEditor;

    if (!editor) {
      vscode.window.showWarningMessage('请先激活编辑器');
      return null;
    }

    const rootPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || path.dirname(editor.document.uri.fsPath);

    const doc = editor.document;
    const lineIndex = overrideLineNumber !== undefined ? overrideLineNumber : editor.selection.active.line;

    const text = doc.lineAt(lineIndex).text.trim();
    const relativePath = path.relative(rootPath, doc.uri.fsPath).replace(/\\/g, '/');

    return {
      editor,
      doc,
      rootPath,
      relativePath,
      lineIndex,
      uiLineNumber: lineIndex + 1,
      text,
    };
  }

  private showGroupList(isPreviewMode: boolean): void {
    const getGroupItems = (): vscode.QuickPickItem[] => {
      const groups = this.getGroups();

      return groups.map((group) => ({
        label: group,
        iconPath: new vscode.ThemeIcon('symbol-folder'),
        description: ColorUtils.getEmoji(group),
        buttons: [
          {
            iconPath: new vscode.ThemeIcon('trash', new vscode.ThemeColor('errorForeground')),
            tooltip: ANCHOR_TOOLTIPS.DELETE,
          },
        ],
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
        void this.showAnchorList(selected.label, isPreviewMode);
      }
    });

    quickPick.onDidTriggerItemButton(async (event) => {
      await this.handleDeleteGroup(event.item.label);
      quickPick.items = getGroupItems();
    });

    quickPick.show();
  }

  private async handleDeleteGroup(groupName: string): Promise<void> {
    const isDefault = this.defaultGroups.includes(groupName);

    const confirmMessage = isDefault ? `是否清空默认分组 [${groupName}] 下的所有记录？` : `确认要删除分组 [${groupName}] 及其下所有记录吗？`;

    const selection = await vscode.window.showWarningMessage(confirmMessage, '确认删除', '取消');

    if (selection !== '确认删除') return;

    const anchorsToDelete = this.getAnchors().filter((anchor) => anchor.group === groupName);

    anchorsToDelete.forEach((anchor) => {
      this.removeAnchor(anchor.id);
    });

    if (!isDefault && isFunction(this.removeGroup)) {
      this.removeGroup(groupName);
    }

    this.updateDecorations();

    vscode.window.showInformationMessage(`已${isDefault ? '清空' : '删除'}分组 [${groupName}]`);
  }

  private getAnchorButtons(anchor: AnchorData, index: number, total: number, isPreviewMode: boolean, hasDefaultAnchorId: boolean): vscode.QuickInputButton[] {
    const buttons: vscode.QuickInputButton[] = [];

    if (hasDefaultAnchorId) {
      if (index > 0) {
        buttons.push({
          iconPath: new vscode.ThemeIcon('arrow-up'),
          tooltip: ANCHOR_TOOLTIPS.UP,
        });
      }

      if (index < total - 1) {
        buttons.push({
          iconPath: new vscode.ThemeIcon('arrow-down'),
          tooltip: ANCHOR_TOOLTIPS.DOWN,
        });
      }

      if (anchor.items?.length) {
        buttons.push({
          iconPath: new vscode.ThemeIcon('file-symlink-directory'),
          tooltip: ANCHOR_TOOLTIPS.VIEW_CHILDREN,
        });
      }

      buttons.push(
        {
          iconPath: new vscode.ThemeIcon('edit'),
          tooltip: ANCHOR_TOOLTIPS.ADD_NOTE,
        },
        {
          iconPath: new vscode.ThemeIcon('trash', new vscode.ThemeColor('errorForeground')),
          tooltip: ANCHOR_TOOLTIPS.DELETE,
        },
      );

      return buttons;
    }

    if (isPreviewMode) {
      if (anchor.items?.length) {
        buttons.push({
          iconPath: new vscode.ThemeIcon('file-symlink-directory'),
          tooltip: ANCHOR_TOOLTIPS.VIEW_CHILDREN,
        });
      }

      buttons.push(
        {
          iconPath: new vscode.ThemeIcon('edit'),
          tooltip: ANCHOR_TOOLTIPS.ADD_NOTE,
        },
        {
          iconPath: new vscode.ThemeIcon('trash', new vscode.ThemeColor('errorForeground')),
          tooltip: ANCHOR_TOOLTIPS.DELETE,
        },
      );

      return buttons;
    }

    return [
      {
        iconPath: new vscode.ThemeIcon('arrow-up'),
        tooltip: ANCHOR_TOOLTIPS.INSERT_BEFORE,
      },
      {
        iconPath: new vscode.ThemeIcon('arrow-down'),
        tooltip: ANCHOR_TOOLTIPS.INSERT_AFTER,
      },
      anchor.items?.length
        ? {
            iconPath: new vscode.ThemeIcon('file-symlink-directory'),
            tooltip: ANCHOR_TOOLTIPS.VIEW_CHILDREN,
          }
        : {
            iconPath: new vscode.ThemeIcon('new-folder'),
            tooltip: ANCHOR_TOOLTIPS.NEW_SUBGROUP,
          },
      {
        iconPath: new vscode.ThemeIcon('trash', new vscode.ThemeColor('errorForeground')),
        tooltip: ANCHOR_TOOLTIPS.DELETE,
      },
    ];
  }

  private async handleViewChildren(anchorId: string, pinnedLineIndex?: number, isPreviewMode?: boolean, defaultAnchorId?: string): Promise<void> {
    const targetAnchor = this.getAnchorById(anchorId);

    if (!targetAnchor) return;

    let childGroupName = targetAnchor.description;

    if (targetAnchor.items?.length) {
      childGroupName = targetAnchor.items[0].group;
    }

    if (!childGroupName) {
      vscode.window.showInformationMessage('此记录没有子分组');
      return;
    }

    const ctx = this.getEditorContext(pinnedLineIndex);

    if (!ctx) return;

    if (defaultAnchorId || isPreviewMode) {
      const resolvedDefaultAnchorId = defaultAnchorId || targetAnchor.id;
      await this.showAnchorList(childGroupName, true, undefined, resolvedDefaultAnchorId);
      return;
    }

    await this.showAnchorList(childGroupName, false, ctx.uiLineNumber);
  }

  private async handleCreateSubGroup(parentId: string, pinnedLineIndex?: number): Promise<void> {
    const parentAnchor = this.getAnchorById(parentId);

    if (!parentAnchor) return;

    let targetGroupName = parentAnchor.description;

    if (!targetGroupName) {
      const fileNameWithoutExt = path.parse(parentAnchor.filePath).name;
      const parentDir = path.basename(path.dirname(parentAnchor.filePath));
      const suggestion = path.join(parentDir, fileNameWithoutExt);

      const input = await vscode.window.showInputBox({
        title: '创建新分组 (将当前记录作为子分组)',
        value: suggestion,
        prompt: '确认新分组路径',
      });
      if (!input) return;
      targetGroupName = input.trim();
    }

    this.addChild(targetGroupName);
    const ctx = this.getEditorContext(pinnedLineIndex);
    if (ctx) {
      this.addChildAnchor(parentAnchor.id, {
        filePath: ctx.relativePath,
        line: ctx.uiLineNumber,
        content: ctx.text,
        group: targetGroupName,
      });
      vscode.window.showInformationMessage(`已创建子分组: ${targetGroupName}`);
      this.updateDecorations();
      return;
    }

    vscode.window.showInformationMessage(`已为记录创建子分组结构: ${targetGroupName}`);
  }

  private async handleInsertAnchor(targetId: string, position: AnchorInsertPosition, groupName: string, pinnedLineIndex?: number): Promise<void> {
    const ctx = this.getEditorContext(pinnedLineIndex);

    if (!ctx) return;

    this.insertAnchor(
      {
        filePath: ctx.relativePath,
        line: ctx.uiLineNumber,
        content: ctx.text,
        group: groupName,
        sort: 0,
      },
      targetId,
      position,
    );

    this.updateDecorations();

    vscode.window.showInformationMessage(`已插入第 ${ctx.uiLineNumber} 行`);
  }

  private async openFileAtLine(filePath: string, uiLine: number): Promise<void> {
    const rootPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
    const absolutePath = path.join(rootPath, filePath);

    try {
      const doc = await vscode.workspace.openTextDocument(absolutePath);

      let targetColumn = vscode.ViewColumn.Active;

      if (this.currentPanel?.visible && this.currentPanel.viewColumn) {
        const mindMapColumn = this.currentPanel.viewColumn;
        targetColumn = mindMapColumn === vscode.ViewColumn.One ? vscode.ViewColumn.Two : vscode.ViewColumn.One;
      }

      const editor = await vscode.window.showTextDocument(doc, {
        viewColumn: targetColumn,
        preview: false,
      });

      const lineIndex = Math.max(0, uiLine - 1);
      const pos = new vscode.Position(lineIndex, 0);

      editor.selection = new vscode.Selection(pos, pos);
      editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
    } catch {
      vscode.window.showErrorMessage(`无法打开文件: ${filePath}`);
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

  private disposeDecorations(): void {
    this.decorationTypes.forEach((decoration) => {
      decoration.dispose();
    });

    this.decorationTypes.clear();
  }

  private normalizePath(value: string): string {
    return value.replace(/\\/g, '/');
  }

  private createId(): string {
    return `${Date.now()}${Math.random().toString(36).slice(2, 7)}`;
  }

  private toErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }

    if (typeof error === 'string') {
      return error;
    }

    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }
}
