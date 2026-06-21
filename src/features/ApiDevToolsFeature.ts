import * as vscode from 'vscode';
import { IFeature } from '../core/interfaces/IFeature';
import ColorLog from '../utils/ColorLog';
import { ApiDevToolsWebviewProvider } from '../providers/ApiDevToolsWebviewProvider';

export class ApiDevToolsFeature implements IFeature {
  public readonly id = 'ApiDevToolsFeature';

  public activate(context: vscode.ExtensionContext): void {
    const provider = new ApiDevToolsWebviewProvider(context);

    const registration = vscode.window.registerWebviewViewProvider(
      ApiDevToolsWebviewProvider.viewType,
      provider,
      {
        webviewOptions: {
          retainContextWhenHidden: true,
        },
      }
    );

    context.subscriptions.push(registration);

    ColorLog.black(`[${this.id}]`, 'Activated.');
  }
}
