import * as vscode from 'vscode';
import * as path from 'path';
import WebviewWorkflow from '@/workflow/webview';
import ReactWebviewHtmlWorkflow from '@/workflow/react-webview-html';
import { debounce, isFunction, isNumber } from 'lodash-es';
import { ExtensionContextProvider } from '@common/providers/extension-context.provider';
import { AnchorCodeLensProvider } from '@modules/anchor/prooviders/anchor-code-lens.provider';
import { ColorUtils } from '@utils/ColorUtils';
import { ConfigurationService } from '@common/services/configuration.service';
import { ANCHOR_TOOLTIPS } from '@modules/anchor/constants/anchor.constant';
import type { WebviewEnhancerOptions } from '@plugins/webview-enhancer/type';
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
} from '@modules/anchor/anchor.type';

export class AnchorService {
  public static inject = [ConfigurationService, ExtensionContextProvider];

  // 工作区存储的 Key
  private readonly stateKey = 'quickOps.workspaceAnchors';
  private readonly defaultGroups = ['default', 'Default', 'TODO', 'FIXME'];

  private context?: vscode.ExtensionContext;
  private currentPanel?: vscode.WebviewPanel;
  private readonly webviewWorkflow = new WebviewWorkflow();
  private readonly reactWebviewHtmlWorkflow = new ReactWebviewHtmlWorkflow();

  private anchors: AnchorData[] = [];
  private flotAnchors: AnchorData[] = [];
  private groups: string[] = ['Default'];
  private itemGroups: string[] = [];

  private readonly changeEmitter = new vscode.EventEmitter<void>();
  public readonly onDidChangeAnchors = this.changeEmitter.event;

  private readonly debouncedSave = debounce(() => {
    void this.persist();
  }, 500);

  /**
   * @description 创建 AnchorService 实例
   *
   * @param configurationService 配置服务，用于读取锚点展示模式、思维导图位置等配置
   * @param extensionContextProvider VS Code 上下文适配器，用于获取工作区、文档路径和打开文件
   */
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

  /**
   * @description 释放锚点服务资源
   *
   * 会取消防抖保存任务、关闭思维导图面板，并释放锚点变化事件。
   */
  public dispose(): void {
    this.debouncedSave.cancel();
    this.currentPanel?.dispose();
    this.currentPanel = undefined;

    this.changeEmitter.dispose();
  }

  /**
   * @description 创建provider
   * @returns 返回AnchorCodeLensProvider的实例
   */
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

  /**
   * @description 刷新锚点思维导图面板
   */
  public refreshMindMapPanel(): void {
    if (!this.currentPanel) return;

    void this.currentPanel.webview.postMessage({
      command: 'refresh',
      data: this.getMindMapData(),
    });
  }

  /**
   * @description 执行查看锚点命令
   *
   * 根据配置决定打开思维导图面板或普通 QuickPick 分组列表。
   */
  public async executeShowAnchorMenuCommand(): Promise<void> {
    const config = this.configurationService.config?.general || {};
    const mode = config.anchorViewMode || 'menu';

    if (mode === 'mindmap') {
      await this.openMindMapPanel();
      return;
    }

    this.showGroupList(true);
  }

  /**
   * @description 注册新增锚点指令的回调
   * @param args
   * @returns
   */
  public async executeAddAnchorCommand(...args: any[]): Promise<void> {
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

  /**
   * @description 展示指定分组下的锚点列表
   *
   * @param groupName 分组名称
   * @param isPreviewMode 是否为预览模式
   * @param pinnedLineIndex 待插入的编辑器行索引
   * @param defaultAnchorId 默认选中的锚点 ID
   */
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

            vscode.window.showInformationMessage('备注已更新');
          }

          break;
        }

        case ANCHOR_TOOLTIPS.UP:
          this.moveAnchor(anchorId, 'up');
          refreshList(anchorId);
          break;

        case ANCHOR_TOOLTIPS.DOWN:
          this.moveAnchor(anchorId, 'down');
          refreshList(anchorId);
          break;

        case ANCHOR_TOOLTIPS.DELETE:
          this.removeAnchor(anchorId);
          refreshList();

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

  /**
   * @description 跳转到同分组中的上一个或下一个锚点
   *
   * @param currentId 当前锚点 ID
   * @param direction 跳转方向
   */
  public async navigateAnchor(currentId: string, direction: AnchorDirection): Promise<void> {
    const target = this.getNeighborAnchor(currentId, direction);

    if (target) {
      await this.openFileAtLine(target.filePath, target.line);
      return;
    }

    vscode.window.showInformationMessage(direction === 'prev' ? '已经是第一个了' : '已经是最后一个了');
  }

  /**
   * @description 保存文档时同步锚点行号和文本内容
   *
   * @param doc 保存的 VS Code 文档
   */
  public async syncAnchorsWithContent(doc: vscode.TextDocument): Promise<void> {
    const relativePath = this.extensionContextProvider.getDocumentRelativePath(doc);
    const fileAnchors = this.getAnchors(relativePath);

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
    }
  }

  /**
   * @description 获取锚点列表
   *
   * 说明：
   * - 不传 filePath 时，返回所有扁平化锚点
   * - 传 filePath 时，只返回指定文件下的锚点
   */
  public getAnchors(filePath?: string): AnchorData[] {
    if (filePath) {
      const targetPath = this.extensionContextProvider.normalizePath(filePath);
      return this.flotAnchors.filter((anchor) => {
        return this.extensionContextProvider.normalizePath(anchor.filePath) === targetPath;
      });
    }
    return this.flotAnchors;
  }

  /**
   * @description 获取所有一级锚点分组
   *
   * @returns 分组名称数组
   */
  public getGroups(): string[] {
    return this.groups;
  }

  /**
   * @description 新增一级锚点分组
   *
   * @param group 分组名称
   */
  public addGroup(group: string): void {
    if (!this.groups.includes(group)) {
      this.groups.push(group);
      this.save();
    }
  }

  /**
   * @description 新增子分组名称记录
   *
   * @param group 子分组名称
   */
  public addChild(group: string): void {
    if (!this.itemGroups.includes(group)) {
      this.itemGroups.push(group);
      this.save();
    }
  }

  /**
   * @description 删除一级锚点分组
   *
   * @param group 分组名称
   */
  public removeGroup(group: string): void {
    this.groups = this.groups.filter((item) => item !== group);
    this.save();
  }

  /**
   * @description 新增一级锚点
   *
   * @param anchor 新增锚点输入数据
   */
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

  /**
   * @description 为指定父锚点新增子锚点
   *
   * @param parentId 父锚点 ID
   * @param anchor 子锚点输入数据
   */
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

  /**
   * @description 在目标锚点前后插入锚点
   *
   * @param anchor 待插入的锚点数据
   * @param targetId 目标锚点 ID
   * @param position 插入位置
   */
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

  /**
   * @description 删除指定锚点
   *
   * @param id 锚点 ID
   */
  public removeAnchor(id: string): void {
    const container = this.findContainerArray(id, this.anchors);

    if (!container) return;

    container.list.splice(container.index, 1);
    container.list.forEach((item, index) => {
      item.sort = index + 1;
    });

    this.save();
  }

  /**
   * @description 更新指定锚点
   *
   * @param id 锚点 ID
   * @param updates 更新字段
   */
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

  /**
   * @description 更新指定锚点的行号
   *
   * @param id 锚点 ID
   * @param newLine 新的 UI 行号，从 1 开始
   */
  public updateAnchorLine(id: string, newLine: number): void {
    this.updateAnchor(id, {
      line: newLine,
    });
  }

  /**
   * @description 上移或下移指定锚点
   *
   * @param id 锚点 ID
   * @param direction 移动方向
   */
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

  /**
   * @description 根据 ID 获取锚点
   *
   * @param id 锚点 ID
   * @returns 匹配到的锚点，没有则返回 undefined
   */
  public getAnchorById(id: string): AnchorData | undefined {
    let found = this.flotAnchors.find((anchor) => anchor.id === id);

    if (!found) {
      this.refreshFlotAnchors();
      found = this.flotAnchors.find((anchor) => anchor.id === id);
    }

    return found;
  }

  /**
   * @description 获取同分组中的相邻锚点
   *
   * @param currentId 当前锚点 ID
   * @param direction 相邻方向
   * @returns 相邻锚点，没有则返回 undefined
   */
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

  /**
   * @description 获取思维导图树形数据
   *
   * @returns 思维导图根节点
   */
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

  /**
   * @description 保存锚点内存状态
   */
  private save(): void {
    this.refreshFlotAnchors();
    this.changeEmitter.fire();
    this.debouncedSave();
  }

  /**
   * @description 将锚点数据持久化到 workspaceState
   */
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

  /**
   * @description 查找指定锚点所在的同级容器数组
   *
   * @param targetId 目标锚点 ID
   * @param currentList 当前递归查找的锚点数组
   * @returns 目标锚点所在数组和索引，找不到则返回 null
   */
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

  /**
   * @description 递归更新子锚点的 group 字段
   *
   * @param items 子锚点数组
   * @param newGroupName 新的分组名称
   */
  private updateChildrenGroup(items: AnchorData[], newGroupName: string): void {
    items.forEach((child) => {
      child.group = newGroupName;

      if (child.items?.length) {
        this.updateChildrenGroup(child.items, newGroupName);
      }
    });
  }

  /**
   * @description 打开或激活锚点思维导图面板
   */
  private async openMindMapPanel(): Promise<void> {
    if (!this.context) return;

    let targetColumn = vscode.ViewColumn.Beside;

    this.currentPanel = await this.webviewWorkflow.createWebview<AnchorWebviewMessage, WebviewEnhancerOptions>({
      key: 'anchorMindMap',
      viewType: 'anchorMindMap',
      title: 'Anchors Mind Map',
      column: targetColumn,
      extensionUri: this.context.extensionUri,

      /**
       * @description 给 Webview 外观增强插件使用
       *
       * 当前激活 tab 是 fullscreen: true 的 Webview 时，
       * quickOps.activeWebview.fullscreen 会被设置为 true，
       * editor/title 里的放大按钮才会显示。
       */
      fullscreen: true,

      /**
       * 如果你的 WebviewAppearancePlugin 使用的是 icon 字段，就用 icon。
       * 如果你的 WebviewWorkflow 仍然使用 iconPath，也可以保留 iconPath。
       */
      icon: 'resources/icons/anchor-mindmap.svg',

      options: {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [this.context.extensionUri],
      },

      htmlFactory: async (webview) => {
        return this.reactWebviewHtmlWorkflow.createReactWebviewHtml({
          extensionUri: this.context!.extensionUri,
          webview,
          routeName: '/anchor',
        });
      },

      onDidReceiveMessage: async (message) => {
        await this.handleMindMapMessage(message);
      },

      onDidDispose: () => {
        this.currentPanel = undefined;
      },
    });
  }

  /**
   * @description 处理思维导图 Webview 消息
   *
   * @param message Webview 消息
   */
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

      case 'anchorAction':
        await this.handleMindMapAnchorAction(message);
        break;
    }
  }

  /**
   * @description 处理思维导图中的锚点操作
   *
   * @param message Webview 锚点操作消息
   */
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

  /**
   * @description 获取当前编辑器上下文
   *
   * 用途：
   * - 添加锚点时获取当前文件、当前行、当前行文本
   * - pinnedLineIndex 有值时，优先使用指定行
   */
  private getEditorContext(overrideLineNumber?: number): AnchorEditorContext | null {
    const editor = vscode.window.activeTextEditor;

    if (!editor) {
      vscode.window.showWarningMessage('请先激活编辑器');
      return null;
    }

    const doc = editor.document;
    const workspacePath = this.extensionContextProvider.getWorkspacePathByUri(doc.uri) || path.dirname(doc.uri.fsPath);

    const lineIndex = overrideLineNumber !== undefined ? overrideLineNumber : editor.selection.active.line;

    const text = doc.lineAt(lineIndex).text.trim();
    const relativePath = this.extensionContextProvider.getDocumentRelativePath(doc);

    return {
      editor,
      doc,
      rootPath: workspacePath,
      relativePath,
      lineIndex,
      uiLineNumber: lineIndex + 1,
      text,
    };
  }

  /**
   * @description 展示一级锚点分组列表
   *
   * @param isPreviewMode 是否为预览模式
   */
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

  /**
   * @description 删除或清空指定分组
   *
   * @param groupName 分组名称
   */
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

    vscode.window.showInformationMessage(`已${isDefault ? '清空' : '删除'}分组 [${groupName}]`);
  }

  /**
   * @description 获取锚点 QuickPick 操作按钮
   *
   * @param anchor 锚点数据
   * @param index 当前锚点索引
   * @param total 当前列表总数
   * @param isPreviewMode 是否为预览模式
   * @param hasDefaultAnchorId 是否存在默认选中锚点
   * @returns QuickPick 按钮列表
   */
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

  /**
   * @description 查看指定锚点的子分组
   *
   * @param anchorId 锚点 ID
   * @param pinnedLineIndex 待插入行索引
   * @param isPreviewMode 是否为预览模式
   * @param defaultAnchorId 默认选中的锚点 ID
   */
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

  /**
   * @description 为指定锚点创建子分组
   *
   * @param parentId 父锚点 ID
   * @param pinnedLineIndex 待添加的行索引
   */
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
      return;
    }

    vscode.window.showInformationMessage(`已为记录创建子分组结构: ${targetGroupName}`);
  }

  /**
   * @description 处理插入锚点操作
   *
   * @param targetId 目标锚点 ID
   * @param position 插入位置
   * @param groupName 分组名称
   * @param pinnedLineIndex 待插入的行索引
   */
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

    vscode.window.showInformationMessage(`已插入第 ${ctx.uiLineNumber} 行`);
  }

  /**
   * @description 打开锚点所在文件，并跳转到指定行
   */
  private async openFileAtLine(filePath: string, uiLine: number): Promise<void> {
    try {
      let targetColumn = vscode.ViewColumn.Active;
      if (this.currentPanel?.visible && this.currentPanel.viewColumn) {
        const mindMapColumn = this.currentPanel.viewColumn;
        targetColumn = mindMapColumn === vscode.ViewColumn.One ? vscode.ViewColumn.Two : vscode.ViewColumn.One;
      }
      const editor = await this.extensionContextProvider.openWorkspaceTextDocumentAtLine(filePath, uiLine, {
        viewColumn: targetColumn,
        preview: false,
        revealType: vscode.TextEditorRevealType.InCenter,
      });

      if (!editor) {
        vscode.window.showErrorMessage(`无法打开文件: ${filePath}`);
      }
    } catch {
      vscode.window.showErrorMessage(`无法打开文件: ${filePath}`);
    }
  }

  /**
   * @description 根据文件扩展名获取 QuickPick 展示图标
   *
   * @param filePath 文件路径
   * @returns VS Code codicon 字符串
   */
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

  /**
   * @description 创建锚点 ID
   *
   * @returns 基于时间戳和随机字符串生成的 ID
   */
  private createId(): string {
    return `${Date.now()}${Math.random().toString(36).slice(2, 7)}`;
  }

  /**
   * @description 将未知错误转换为可展示的错误文本
   *
   * @param error 未知错误对象
   * @returns 错误消息字符串
   */
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
