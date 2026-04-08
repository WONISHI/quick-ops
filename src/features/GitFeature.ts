import * as vscode from 'vscode';
import { IFeature } from '../core/interfaces/IFeature';
import { GitWebviewProvider } from '../providers/GitWebviewProvider';
import ColorLog from '../utils/ColorLog';

export class GitFeature implements IFeature {
  public readonly id = 'GitFeature';

  public activate(context: vscode.ExtensionContext): void {
    const gitProvider = new GitWebviewProvider(context.extensionUri);

    context.subscriptions.push(
      vscode.window.registerWebviewViewProvider(
        'quickOps.gitView', 
        gitProvider,
        {
          webviewOptions: {
            retainContextWhenHidden: true 
          }
        }
      )
    );

    ColorLog.black(`[${this.id}]`, 'Activated.');
  }
}