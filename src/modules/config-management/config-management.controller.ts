import * as vscode from 'vscode';
import type { OnModuleInit } from '../../core/lifecycle/lifecycle.interface';
import { ConfigurationService } from '../../common/services/configuration.service';

export class ConfigManagementController implements OnModuleInit {
  public static inject = [ConfigurationService];

  constructor(private readonly configurationService: ConfigurationService) {}

  public onModuleInit(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
      vscode.commands.registerCommand('quickOps.openSettings', async () => {
        await vscode.commands.executeCommand(
          'workbench.action.openSettings',
          '@ext:quick-ops.quick-ops',
        );
      }),
    );

    context.subscriptions.push(
      vscode.commands.registerCommand('quickOps.reloadConfiguration', async () => {
        await this.configurationService.reload?.();
        vscode.window.showInformationMessage('QuickOps 配置已刷新');
      }),
    );
  }
}