import * as vscode from 'vscode';
import ColorLog from '@utils/ColorLog';
import { ExtensionContextProvider } from '@common/providers/extension-context.provider';
import { AnchorService } from '@modules/anchor/anchor.service';
import type { AnchorDirection } from '@modules/anchor/anchor.type';
import type { OnModuleInit } from '@core/lifecycle/lifecycle.interface';
import WorkspaceEventsWorkflow from '@workflow/workspace-events';
import { WORKSPACE_EVENTS } from '@workflow/workspace-events/type';

export class AnchorController implements OnModuleInit {
  public static inject = [ExtensionContextProvider, AnchorService];

  private readonly id = 'AnchorModule';

  private readonly workspaceEventsWorkflow = new WorkspaceEventsWorkflow();

  private readonly supportedDocumentExts = ['.vue', '.jsx', '.tsx', '.css', '.less', '.scss', '.html', '.js', '.ts'];

  constructor(
    private readonly extensionContextProvider: ExtensionContextProvider,
    private readonly anchorService: AnchorService,
  ) {}

  /**
   * @description 生命周期初始化
   *
   * 处理流程：
   * 1. 获取插件上下文
   * 2. 初始化 AnchorService
   * 3. 注册 CodeLensProvider
   * 4. 注册模块事件监听
   * 5. 注册模块命令
   * 6. 初始化插件上下文变量
   */
  public onModuleInit(): void {
    const context = this.extensionContextProvider.getContext();

    this.anchorService.init(context);

    // 注册provider
    this.registerCodeLensProvider();

    // 注册事件
    this.registerListeners();
    // 注册命令
    this.registerCommands();

    /**
     * @description 初始检查整个项目是否有锚点
     */
    this.anchorService.checkContainsAnchor();

    ColorLog.black(`[${this.id}]`, 'Activated.');
  }

  /**
   * @description 释放 Anchor 模块资源
   */
  public dispose(): void {
    this.anchorService.dispose();
    this.workspaceEventsWorkflow.dispose();
  }

    /**
   * @description 注册 Anchor CodeLensProvider
   *
   * CodeLensProvider 负责在编辑器中显示锚点行内提示。
   *
   * scheme: 'file' 表示只在真实本地文件中显示 CodeLens。
   * 不包含 untitled、Git diff、远程虚拟文档等非 file 文档。
   */
  private registerCodeLensProvider(): void {
    // 教程地址：https://juejin.cn/post/6976996315771174942
    // 注册可以生效的CodeLens
    /**
     * scheme: 'file' 意味着这个 CodeLens 提示只会在保存在本地磁盘上的真实物理文件中显示。
     * 它排除了其他类型的文件，比如还没保存的“无标题”文件（scheme: 'untitled'）、Git 历史对比文件、或者是通过网络打开的远程文件
     */
    const codeLensProvider = this.anchorService.createCodeLensProvider();

    this.extensionContextProvider.register(
      vscode.languages.registerCodeLensProvider(
        {
          scheme: 'file',
        },
        codeLensProvider,
      ),
    );
  }

  /**
   * @description 注册 Anchor 模块事件监听
   *
   * 当前保留两类监听：
   *
   * 1. AnchorService.onDidChangeAnchors
   *    - 锚点数据变化后，刷新插件上下文变量
   *    - 如果 MindMap 面板已打开，则同步刷新 MindMap 数据
   *
   * 2. vscode.workspace.onDidSaveTextDocument
   *    - 保存文件时，同步锚点行号和内容
   *
   * 注意：
   * decoration 相关能力已经删除，所以这里不再监听 activeTextEditor 变化。
   */
  private registerListeners(): void {
    const context = this.extensionContextProvider.getContext();

    this.workspaceEventsWorkflow.init(context);

    this.extensionContextProvider.register(
      this.anchorService.onDidChangeAnchors(() => {
        this.anchorService.checkContainsAnchor();
        this.anchorService.refreshMindMapPanel();
      }),

      this.workspaceEventsWorkflow.on(
        WORKSPACE_EVENTS.DID_SAVE_TEXT_DOCUMENT,
        (event) => {
          const doc = event.document;

          if (!doc) return;

          void this.anchorService.syncAnchorsWithContent(doc);
        },
        {
          extensions: this.supportedDocumentExts,
        },
      ),
    );
  }

  /**
   * @description 注册 Anchor 模块命令
   */
  private registerCommands(): void {
    this.extensionContextProvider.register(
      /**
       * @description 新增锚点
       */
      vscode.commands.registerCommand('quickOps.anchor.add', async (...args: any[]) => {
        await this.anchorService.executeAddAnchorCommand(...args);
      }),

      /**
       * @description 打开锚点菜单
       */
      vscode.commands.registerCommand('quickOps.anchor.showMenu', async () => {
        await this.anchorService.executeShowAnchorMenuCommand();
      }),

      /**
       * @description 查看指定分组下的锚点列表
       */
      vscode.commands.registerCommand('quickOps.anchor.listByGroup', async (groupName: string, anchorId: string) => {
        await this.anchorService.showAnchorList(groupName, true, undefined, anchorId);
      }),

      /**
       * @description 跳转到上一个或下一个锚点
       */
      vscode.commands.registerCommand('quickOps.anchor.navigate', async (currentId: string, direction: AnchorDirection) => {
        await this.anchorService.navigateAnchor(currentId, direction);
      }),

      /**
       * @description 删除锚点
       */
      vscode.commands.registerCommand('quickOps.anchor.delete', async (id: string) => {
        this.anchorService.removeAnchor(id);
      }),
    );
  }
}
