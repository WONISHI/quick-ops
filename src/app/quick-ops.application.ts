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

  private setupGlobalDisposables(): void {
    this.context.subscriptions.push({
      dispose: () => {
        void this.dispose();
      },
    });
  }
}