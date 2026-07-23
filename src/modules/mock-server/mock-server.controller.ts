import * as vscode from 'vscode';

import type { OnModuleInit } from '@core/lifecycle/lifecycle.interface';
import { ExtensionContextProvider } from '@common/providers/extension-context.provider';
import { ConfigurationService } from '@common/services/configuration.service';
import { MockServerService } from '@modules/mock-server/mock-server.service';

export class MockServerController implements OnModuleInit {
  public static inject = [ExtensionContextProvider, ConfigurationService, MockServerService];

  private readonly id = 'MockServerModule';

  constructor(
    private readonly extensionContextProvider: ExtensionContextProvider,
    private readonly configurationService: ConfigurationService,
    private readonly mockServerService: MockServerService,
  ) {}

  public onModuleInit(): void {
    this.registerWebviewProvider();
    this.registerCommands();
    this.registerConfigListener();
    this.registerWorkspaceListener();

    void this.mockServerService.handleWorkspaceFoldersChanged();
  }

  public dispose(): void {
    this.mockServerService.dispose();
  }

  private registerWebviewProvider(): void {
    this.extensionContextProvider.register(
      vscode.window.registerWebviewViewProvider('quickOps.mockView', this.mockServerService, {
        webviewOptions: {
          retainContextWhenHidden: true,
        },
      }),
    );
  }

  private registerCommands(): void {
    this.extensionContextProvider.register(
      vscode.commands.registerCommand('quick-ops.mock.start', async () => {
        await this.mockServerService.startAll();
      }),

      vscode.commands.registerCommand('quick-ops.mock.stop', async () => {
        await this.mockServerService.stopAll();
      }),
    );
  }

  private registerConfigListener(): void {
    this.configurationService.on('configChanged', () => {
      void this.mockServerService.syncServers();
    });
  }

  /**
   * @description 工作区全部关闭时停止所有 Mock 服务；
   * 重新打开工作区后恢复已启用的服务。
   */
  private registerWorkspaceListener(): void {
    this.extensionContextProvider.register(
      vscode.workspace.onDidChangeWorkspaceFolders(() => {
        void this.mockServerService.handleWorkspaceFoldersChanged();
      }),
    );
  }
}
