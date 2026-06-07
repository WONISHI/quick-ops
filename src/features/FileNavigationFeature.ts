import * as vscode from 'vscode';
import * as path from 'path';
import { IFeature } from '../core/interfaces/IFeature';
import ColorLog from '../utils/ColorLog';
import { getReactWebviewHtml } from '../utils/WebviewHelper';
import { setupMarkdown } from '../plugins/markdown/setupMarkdown';
import markdownImagePlugin, { restoreMarkdownImagePaths } from '../plugins/markdown/markdownImagePlugin';

type ExternalPreviewType = 'markdown' | 'pdf' | 'excel' | 'word';

export class FileNavigationFeature implements IFeature {
  public readonly id = 'FileNavigationFeature';

  private activePanels: Map<string, vscode.WebviewPanel> = new Map();
  private markdownImageAssets = new Map<string, Record<string, string>>();

  public activate(context: vscode.ExtensionContext): void {
    // 定位文件
    const disposable = vscode.commands.registerCommand('quick-ops.revealInExplorer', async () => {
      const activeEditor = vscode.window.activeTextEditor;

      if (!activeEditor) {
        vscode.window.showInformationMessage('当前没有打开的文件');
        return;
      }

      const uri = activeEditor.document.uri;

      if (uri.scheme !== 'file' && uri.scheme !== 'vscode-remote') {
        vscode.window.setStatusBarMessage('Quick Ops: 该文件无法在资源管理器中定位', 3000);
        return;
      }

      try {
        await vscode.commands.executeCommand('revealInExplorer', uri);
      } catch (error) {
        console.warn('[QuickOps] Reveal failed:', error);
        vscode.window.showWarningMessage('无法在当前工作区找到该文件');
      }
    });

    const openInNewTab = vscode.commands.registerCommand('quick-ops.openInNewTab', async (uri: vscode.Uri) => {
      if (!uri) return;

      await vscode.window.showTextDocument(uri, {
        preview: false,
        viewColumn: vscode.ViewColumn.Active,
      });
    });

    const openExternalPreview = vscode.commands.registerCommand(
      'quick-ops.openExternalPreview',
      async (uri?: vscode.Uri) => {
        const targetUri = uri || vscode.window.activeTextEditor?.document.uri;

        if (!targetUri) {
          vscode.window.showInformationMessage('当前没有可打开的文件');
          return;
        }

        await this.openExternalPreview(context, targetUri);
      },
    );

    context.subscriptions.push(disposable, openInNewTab, openExternalPreview);

    ColorLog.black(`[${this.id}]`, 'Activated.');
  }

  private getExternalPreviewType(uri: vscode.Uri): ExternalPreviewType | null {
    const ext = path.extname(uri.fsPath || uri.path).toLowerCase();

    if (ext === '.md' || ext === '.markdown') {
      return 'markdown';
    }

    if (ext === '.pdf') {
      return 'pdf';
    }

    if (ext === '.xlsx' || ext === '.xls') {
      return 'excel';
    }

    if (ext === '.docx' || ext === '.doc') {
      return 'word';
    }

    return null;
  }

  private async openExternalPreview(context: vscode.ExtensionContext, uri: vscode.Uri) {
    if (uri.scheme !== 'file') {
      vscode.window.showWarningMessage('从外部添加打开暂只支持本地文件。');
      return;
    }

    const previewType = this.getExternalPreviewType(uri);

    if (!previewType) {
      vscode.window.showWarningMessage('当前文件类型暂不支持从外部添加打开。');
      return;
    }

    if (previewType === 'markdown') {
      await this.openMarkdownPanel(context, uri);
      return;
    }

    if (previewType === 'pdf') {
      await this.openPdfPanel(context, uri);
      return;
    }

    if (previewType === 'excel') {
      await this.openExcelPanel(context, uri);
      return;
    }

    if (previewType === 'word') {
      await this.openDocPanel(context, uri);
    }
  }

  private getProjectName(uri: vscode.Uri) {
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);

    return workspaceFolder?.name || 'Quick Ops';
  }

  private async closeExistingPreview(uri: vscode.Uri) {
    const key = uri.toString();

    if (this.activePanels.has(key)) {
      this.activePanels.get(key)?.dispose();
      this.activePanels.delete(key);
    }
  }

  private async openMarkdownPanel(context: vscode.ExtensionContext, uri: vscode.Uri) {
    try {
      await this.closeExistingPreview(uri);

      const fileName = path.basename(uri.path);
      const projectName = this.getProjectName(uri);
      const contentBytes = await vscode.workspace.fs.readFile(uri);
      const content = Buffer.from(contentBytes).toString('utf8');

      const mdDir = path.dirname(uri.fsPath);
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';

      const panel = vscode.window.createWebviewPanel(
        'vditorPreviewReact',
        `${projectName}: ${fileName}`,
        vscode.ViewColumn.Active,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: [
            context.extensionUri,
            vscode.Uri.file(mdDir),
            ...(workspaceRoot ? [vscode.Uri.file(workspaceRoot)] : []),
          ],
        },
      );

      this.activePanels.set(uri.toString(), panel);

      const markdownResult = await setupMarkdown({
        content,
        fsPath: uri.fsPath,
        workspaceRoot,
        webview: panel.webview,
      })
        .use(markdownImagePlugin)
        .end();

      this.markdownImageAssets.set(uri.fsPath, markdownResult.assets);

      panel.onDidDispose(() => {
        if (this.activePanels.get(uri.toString()) === panel) {
          this.activePanels.delete(uri.toString());
        }

        this.markdownImageAssets.delete(uri.fsPath);
      });

      panel.webview.onDidReceiveMessage(async (msg) => {
        if (msg.command === 'webviewLoaded') {
          panel.webview.postMessage({
            type: 'initVditorData',
            content: markdownResult.content,
            mode: 'read',
            fsPath: uri.toString(),
          });
          return;
        }

        if (msg.command === 'saveMarkdown') {
          const assets = this.markdownImageAssets.get(uri.fsPath) || {};
          const saveContent = restoreMarkdownImagePaths(msg.content || '', assets);

          await vscode.workspace.fs.writeFile(uri, Buffer.from(saveContent, 'utf8'));
          return;
        }

        if (msg.command === 'openExternal') {
          try {
            await vscode.env.openExternal(vscode.Uri.parse(msg.url));
          } catch {
            vscode.window.showErrorMessage('无法打开该外部链接。');
          }
          return;
        }

        if (msg.command === 'copyToClipboard') {
          vscode.env.clipboard.writeText(msg.text || '');
          vscode.window.showInformationMessage(`🔗 链接已复制: ${msg.text || ''}`);
        }
      });

      panel.iconPath = vscode.Uri.joinPath(context.extensionUri, 'resources', 'icons', 'markdown.svg');
      panel.webview.html = getReactWebviewHtml(context.extensionUri, panel.webview, '/Vditor?type=read');
    } catch (error: any) {
      vscode.window.showErrorMessage(`Markdown 预览打开失败: ${error?.message || String(error)}`);
    }
  }

  private async openPdfPanel(context: vscode.ExtensionContext, uri: vscode.Uri) {
    try {
      await this.closeExistingPreview(uri);

      const fileName = path.basename(uri.path);
      const projectName = this.getProjectName(uri);

      const panel = vscode.window.createWebviewPanel(
        'pdfPreviewReact',
        `${projectName}: ${fileName}`,
        vscode.ViewColumn.Active,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: [context.extensionUri],
        },
      );

      this.activePanels.set(uri.toString(), panel);

      panel.onDidDispose(() => {
        if (this.activePanels.get(uri.toString()) === panel) {
          this.activePanels.delete(uri.toString());
        }
      });

      panel.webview.onDidReceiveMessage(async (msg) => {
        if (msg.command !== 'webviewLoaded') return;

        try {
          const contentBytes = await vscode.workspace.fs.readFile(uri);
          const fileBase64 = Buffer.from(contentBytes).toString('base64');

          panel.webview.postMessage({
            type: 'initPdfData',
            contentBase64: fileBase64,
          });
        } catch (error: any) {
          panel.webview.postMessage({
            type: 'initLocalFileError',
            message: error?.message || 'PDF 文件读取失败',
          });
        }
      });

      panel.iconPath = vscode.Uri.joinPath(context.extensionUri, 'resources', 'icons', 'pdf.svg');
      panel.webview.html = getReactWebviewHtml(context.extensionUri, panel.webview, '/pdf?type=read');
    } catch (error: any) {
      vscode.window.showErrorMessage(`PDF 预览打开失败: ${error?.message || String(error)}`);
    }
  }

  private async openExcelPanel(context: vscode.ExtensionContext, uri: vscode.Uri) {
    try {
      await this.closeExistingPreview(uri);

      const fileName = path.basename(uri.path);
      const projectName = this.getProjectName(uri);
      const contentBytes = await vscode.workspace.fs.readFile(uri);
      const fileBase64 = Buffer.from(contentBytes).toString('base64');

      const panel = vscode.window.createWebviewPanel(
        'excelPreviewReact',
        `${projectName}: ${fileName}`,
        vscode.ViewColumn.Active,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: [context.extensionUri],
        },
      );

      this.activePanels.set(uri.toString(), panel);

      panel.onDidDispose(() => {
        if (this.activePanels.get(uri.toString()) === panel) {
          this.activePanels.delete(uri.toString());
        }
      });

      panel.webview.onDidReceiveMessage(async (msg) => {
        if (msg.command === 'webviewLoaded') {
          panel.webview.postMessage({
            type: 'initExcelData',
            fsPath: uri.toString(),
            fileName,
            contentBase64: fileBase64,
          });
        }
      });

      panel.iconPath = vscode.Uri.joinPath(context.extensionUri, 'resources', 'icons', 'table.svg');
      panel.webview.html = getReactWebviewHtml(context.extensionUri, panel.webview, '/xls?type=read');
    } catch (error: any) {
      vscode.window.showErrorMessage(`Excel 预览打开失败: ${error?.message || String(error)}`);
    }
  }

  private async openDocPanel(context: vscode.ExtensionContext, uri: vscode.Uri) {
    try {
      await this.closeExistingPreview(uri);

      const fileName = path.basename(uri.path);
      const projectName = this.getProjectName(uri);
      const ext = path.extname(uri.fsPath || uri.path).toLowerCase();

      const panel = vscode.window.createWebviewPanel(
        'docPreviewReact',
        `${projectName}: ${fileName}`,
        vscode.ViewColumn.Active,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: [context.extensionUri],
        },
      );

      this.activePanels.set(uri.toString(), panel);

      panel.onDidDispose(() => {
        if (this.activePanels.get(uri.toString()) === panel) {
          this.activePanels.delete(uri.toString());
        }
      });

      panel.webview.onDidReceiveMessage(async (msg) => {
        if (msg.command !== 'webviewLoaded') return;

        try {
          if (ext === '.doc') {
            panel.webview.postMessage({
              type: 'initDocError',
              fileName,
              message: '当前预览器暂不支持旧版 .doc 格式，请转换为 .docx 后再预览。',
            });
            return;
          }

          const contentBytes = await vscode.workspace.fs.readFile(uri);
          const fileBase64 = Buffer.from(contentBytes).toString('base64');

          panel.webview.postMessage({
            type: 'initDocData',
            fsPath: uri.toString(),
            fileName,
            extension: ext,
            contentBase64: fileBase64,
          });
        } catch (error: any) {
          panel.webview.postMessage({
            type: 'initDocError',
            fileName,
            message: error?.message || 'Word 文件读取失败',
          });
        }
      });

      panel.iconPath = vscode.Uri.joinPath(context.extensionUri, 'resources', 'icons', 'markdown.svg');
      panel.webview.html = getReactWebviewHtml(context.extensionUri, panel.webview, '/doc?type=read');
    } catch (error: any) {
      vscode.window.showErrorMessage(`Word 预览打开失败: ${error?.message || String(error)}`);
    }
  }
}