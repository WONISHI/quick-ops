import * as vscode from 'vscode';
import ColorLog from '../utils/ColorLog';
import { AppModule } from './app.module';
import { Container } from '../core/container/container';
import { TOKENS } from '../core/container/token';
import { ModuleRunner } from '../core/module/module-runner';

export class QuickOpsApplication {
  private readonly container: Container;
  private readonly moduleRunner: ModuleRunner;

  private started = false;
  private disposing = false;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.container = new Container();

    this.container.registerProvider({
      provide: TOKENS.ExtensionContext,
      useValue: context,
    });

    this.moduleRunner = new ModuleRunner(this.container, context);
  }

  public async start(): Promise<void> {
    if (this.started) return;

    this.started = true;

    try {
      ColorLog.black('[QuickOps]', 'Application Starting...');

      await this.moduleRunner.bootstrap(AppModule);

      this.setupGlobalDisposables();

      ColorLog.black('[QuickOps]', 'Application started successfully.');
    } catch (error) {
      this.started = false;
      console.error('[QuickOps] Application start failed:', error);
      throw error;
    }
  }

  public async dispose(): Promise<void> {
    if (!this.started || this.disposing) return;

    this.disposing = true;

    try {
      await this.moduleRunner.dispose();

      this.started = false;

      ColorLog.red('[QuickOps]', 'Application Disposed.');
    } catch (error) {
      console.error('[QuickOps] Application dispose failed:', error);
    } finally {
      this.disposing = false;
    }
  }

  /**
   * @description 注册应用级 Disposable。
   *
   * `context.subscriptions` 是 VSCode ExtensionContext 提供的资源回收数组。
   * 扩展被卸载、关闭、重载或禁用时，VSCode 会自动调用其中所有对象的 dispose() 方法。
   *
   * 常见可注册内容：
   * - 命令：vscode.commands.registerCommand(...)
   * - 事件监听：vscode.workspace.onDidSaveTextDocument(...)、vscode.window.onDidChangeActiveTextEditor(...)
   * - Webview：vscode.window.registerWebviewViewProvider(...)
   * - Provider：CompletionProvider、HoverProvider、CodeLensProvider、InlayHintsProvider
   * - 虚拟资源：TextDocumentContentProvider、FileSystemProvider
   * - 资源对象：FileSystemWatcher、StatusBarItem、OutputChannel、DiagnosticCollection、DecorationType
   * - 自定义清理逻辑：{ dispose: () => void }
   *
   * 这里注册一个自定义 Disposable，
   * 用于在扩展生命周期结束时统一调用 QuickOpsApplication.dispose()，
   * 释放模块、容器、Webview、事件监听、定时器等资源。
   */
  private setupGlobalDisposables(): void {
    this.context.subscriptions.push({
      dispose: () => {
        void this.dispose().catch((error) => {
          console.error('[QuickOpsApplication] dispose failed:', error);
        });
      },
    });
  }
}
