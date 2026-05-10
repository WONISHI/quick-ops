import * as vscode from 'vscode';
import * as path from 'path';
import { IFeature } from '../core/interfaces/IFeature';
import ColorLog from '../utils/ColorLog';
import { getReactWebviewHtml } from '../utils/WebviewHelper';

export class LivePreviewFeature implements IFeature {
  public readonly id = 'LivePreviewFeature';
  private panel: vscode.WebviewPanel | undefined;
  
  private pendingLocalFile: { fsPath: string, fileType: string } | null = null;

  public activate(context: vscode.ExtensionContext): void {
    const command = vscode.commands.registerCommand('quick-ops.openLivePreview', () => {
      this.showPreviewPanel(context);
    });

    context.subscriptions.push(command);
    ColorLog.black(`[${this.id}]`, 'Activated.');
  }

  private showPreviewPanel(context: vscode.ExtensionContext) {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Beside);
      return;
    }

    this.panel = vscode.window.createWebviewPanel('quickOpsLivePreview', '网页预览 (Preview)', vscode.ViewColumn.Beside, {
      enableScripts: true,
      retainContextWhenHidden: true,
      enableFindWidget: true,
      localResourceRoots: [context.extensionUri]
    });

    this.panel.iconPath = vscode.Uri.joinPath(context.extensionUri, 'icon.png');

    this.panel.onDidDispose(() => {
      this.panel = undefined;
    });

    const lastUrl = context.workspaceState.get<string>('quickOps.lastPreviewUrl') || '';
    const lastDevice = context.workspaceState.get<string>('quickOps.lastPreviewDevice') || 'device-responsive';

    this.panel.webview.html = getReactWebviewHtml(context.extensionUri, this.panel.webview, '/preview');

    setTimeout(() => {
      this.panel?.webview.postMessage({ type: 'init', device: lastDevice, url: lastUrl });
    }, 500);

    this.panel.webview.onDidReceiveMessage(async (message) => {
      if (message.type === 'ready') {
        this.panel?.webview.postMessage({ type: 'init', device: lastDevice, url: lastUrl });
      }
      else if (message.type === 'saveUrl') {
        await context.workspaceState.update('quickOps.lastPreviewUrl', message.url);
      } 
      else if (message.type === 'saveDevice') {
        await context.workspaceState.update('quickOps.lastPreviewDevice', message.device);
      } 
      else if (message.type === 'reqSyncFavorites') {
        const favs = context.globalState.get<any[]>('quickOps.globalFavorites') || [];
        this.panel?.webview.postMessage({ type: 'syncFavorites', favorites: favs });
      } 
      else if (message.type === 'saveAllFavorites') {
        await context.globalState.update('quickOps.globalFavorites', message.favorites);
        this.panel?.webview.postMessage({ type: 'syncFavorites', favorites: message.favorites });
      }
      else if (message.type === 'toggleFavorite') {
        let favs = context.globalState.get<any[]>('quickOps.globalFavorites') || [];
        const index = favs.findIndex(f => f.url === message.url);
        if (index > -1) {
          favs.splice(index, 1);
        } else {
          favs.push({ url: message.url, title: message.title, timestamp: Date.now() });
        }
        await context.globalState.update('quickOps.globalFavorites', favs);
        this.panel?.webview.postMessage({ type: 'syncFavorites', favorites: favs });
      }
      else if (message.type === 'openDevTools') {
        vscode.commands.executeCommand('workbench.action.webview.openDeveloperTools');
      } 
      else if (message.type === 'openExternalBrowser') {
        vscode.env.openExternal(vscode.Uri.parse(message.url));
      } 
      else if (message.type === 'setPendingLocalFile') {
        this.pendingLocalFile = { fsPath: message.fsPath, fileType: message.fileType };
      }
      else if (message.command === 'webviewLoaded') {
        if (this.pendingLocalFile) {
          const { fsPath, fileType } = this.pendingLocalFile;
          try {
            const fileUri = fsPath.includes('://') ? vscode.Uri.parse(fsPath) : vscode.Uri.file(fsPath);
            const contentBytes = await vscode.workspace.fs.readFile(fileUri);

            if (fileType === 'md') {
              const contentStr = Buffer.from(contentBytes).toString('utf8');
              this.panel?.webview.postMessage({ type: 'initVditorData', content: contentStr, mode: 'read', fsPath });
            } else if (fileType === 'pdf') {
              const fileBase64 = Buffer.from(contentBytes).toString('base64');
              // 🌟 核心修改：下发 PDF 数据时带上默认缩放比例 1.2 (120%)
              this.panel?.webview.postMessage({ 
                type: 'initPdfData', 
                contentBase64: fileBase64,
                initialScale: 0.8
              });
            } else if (fileType === 'excel') {
              const fileBase64 = Buffer.from(contentBytes).toString('base64');
              this.panel?.webview.postMessage({ type: 'initExcelData', fsPath, fileName: path.basename(fsPath), contentBase64: fileBase64 });
            }
          } catch (e) {
            vscode.window.showErrorMessage(`文件读取失败: ${fsPath}`);
          }
        }
      }
    });
  }
}