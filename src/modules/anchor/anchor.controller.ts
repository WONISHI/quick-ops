import * as vscode from 'vscode';
import ColorLog from '@/utils/ColorLog';
import { ExtensionContextProvider } from '@/common/providers/extension-context.provider';
import { AnchorService } from './anchor.service';
import type { AnchorDirection } from './anchor.type';
import type { OnModuleInit } from '@/core/lifecycle/lifecycle.interface';

export class AnchorController implements OnModuleInit {
  public static inject = [ExtensionContextProvider, AnchorService];

  private readonly id = 'AnchorModule';

  constructor(
    private readonly extensionContextProvider: ExtensionContextProvider,
    private readonly anchorService: AnchorService,
  ) {}

  /**
   * @description 生命周期初始化
   */
  public onModuleInit(): void {
    /** 获取插件上下文对象 */
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

    // ？？？
    const timer = setTimeout(() => {
      this.anchorService.updateDecorations();
      clearTimeout(timer);
    }, 500);

    ColorLog.black(`[${this.id}]`, 'Activated.');
  }

  public dispose(): void {
    this.anchorService.dispose();
  }

  private registerCodeLensProvider(): void {
    // 教程地址：https://juejin.cn/post/6976996315771174942
    // 注册可以生效的CodeLens
    /**
     * scheme: 'file' 意味着这个 CodeLens 提示只会在保存在本地磁盘上的真实物理文件中显示。
     * 它排除了其他类型的文件，比如还没保存的“无标题”文件（scheme: 'untitled'）、Git 历史对比文件、或者是通过网络打开的远程文件
     */
    this.extensionContextProvider.register(vscode.languages.registerCodeLensProvider({ scheme: 'file' }, this.anchorService.createCodeLensProvider()));
  }

  private registerListeners(): void {
    this.extensionContextProvider.register(
      this.anchorService.onDidChangeAnchors(() => {
        this.anchorService.updateDecorations();
        this.anchorService.checkContainsAnchor();
        this.anchorService.refreshMindMapPanel();
      }),

      vscode.window.onDidChangeActiveTextEditor(() => {
        this.anchorService.updateDecorationsDebounced();
      }),

      vscode.workspace.onDidSaveTextDocument((doc) => {
        void this.anchorService.syncAnchorsWithContent(doc);
      }),
    );
  }

  /**
   * @description 注册命令
   */
  private registerCommands(): void {
    this.extensionContextProvider.register(
      vscode.commands.registerCommand('quick-ops.anchor.add', async (...args: any[]) => {
        await this.anchorService.handleAddAnchorCommand(...args);
      }),

      vscode.commands.registerCommand('quick-ops.anchor.showMenu', async () => {
        await this.anchorService.handleShowMenuCommand();
      }),

      vscode.commands.registerCommand('quick-ops.anchor.listByGroup', async (groupName: string, anchorId: string) => {
        await this.anchorService.showAnchorList(groupName, true, undefined, anchorId);
      }),

      vscode.commands.registerCommand('quick-ops.anchor.navigate', async (currentId: string, direction: AnchorDirection) => {
        await this.anchorService.navigateAnchor(currentId, direction);
      }),

      vscode.commands.registerCommand('quick-ops.anchor.delete', async (id: string) => {
        this.anchorService.removeAnchor(id);
      }),
    );
  }
}
