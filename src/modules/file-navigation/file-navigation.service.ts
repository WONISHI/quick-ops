import * as vscode from 'vscode';
import * as path from 'path';

import WebviewWorkflow from '@/workflow/webview';
import MarkdownWorkflow from '@/workflow/markdown';
import ReactWebviewHtmlWorkflow from '@/workflow/react-webview-html';
import { restoreMarkdownImagePaths } from '@plugins/markdown/markdownImagePlugin';
import { ExtensionContextProvider } from '@common/providers/extension-context.provider';
import type { ExternalPreviewType, MarkdownImageAssets, WebviewMessage } from '@modules/file-navigation/file-navigation.type';

export class FileNavigationService {
  public static inject = [ExtensionContextProvider];

  private readonly activePanels = new Map<string, vscode.WebviewPanel>();
  private readonly markdownImageAssets = new Map<string, MarkdownImageAssets>();

  /**
   * @description WebviewPanel 工作流
   */
  private readonly webviewWorkflow = new WebviewWorkflow();

  /**
   * @description Markdown 内容处理工作流
   */
  private readonly markdownWorkflow = new MarkdownWorkflow();

  /**
   * @description React Webview HTML 工作流
   *
   * 统一负责：
   * - 读取 webview-ui/index.html
   * - 替换 Webview 静态资源路径
   * - 注入 Webview 路由
   */
  private readonly reactWebviewHtmlWorkflow = new ReactWebviewHtmlWorkflow();

  constructor(private readonly extensionContextProvider: ExtensionContextProvider) {}

  public async revealActiveFileInExplorer(): Promise<void> {
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
  }

  public async openInNewTab(uri?: vscode.Uri): Promise<void> {
    if (!uri) return;

    await vscode.window.showTextDocument(uri, {
      preview: false,
      viewColumn: vscode.ViewColumn.Active,
    });
  }

  public async openExternalPreview(uri?: vscode.Uri): Promise<void> {
    const targetUri = uri || vscode.window.activeTextEditor?.document.uri;

    if (!targetUri) {
      vscode.window.showInformationMessage('当前没有可打开的文件');
      return;
    }

    if (targetUri.scheme !== 'file') {
      vscode.window.showWarningMessage('从外部添加打开暂只支持本地文件。');
      return;
    }

    const previewType = this.getExternalPreviewType(targetUri);

    if (!previewType) {
      vscode.window.showWarningMessage('当前文件类型暂不支持从外部添加打开。');
      return;
    }

    if (previewType === 'markdown') {
      await this.openMarkdownPanel(targetUri);
      return;
    }

    if (previewType === 'pdf') {
      await this.openPdfPanel(targetUri);
      return;
    }

    if (previewType === 'excel') {
      await this.openExcelPanel(targetUri);
      return;
    }

    if (previewType === 'word') {
      await this.openDocPanel(targetUri);
    }
  }

  public dispose(): void {
    for (const panel of this.activePanels.values()) {
      panel.dispose();
    }

    this.activePanels.clear();
    this.markdownImageAssets.clear();
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

  private getProjectName(uri: vscode.Uri): string {
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
    return workspaceFolder?.name || 'Quick Ops';
  }

  private getPreviewKey(uri: vscode.Uri): string {
    return `file-navigation:${uri.toString()}`;
  }

  private async closeExistingPreview(uri: vscode.Uri): Promise<void> {
    const key = this.getPreviewKey(uri);

    await this.webviewWorkflow.disposePanel(key);
    this.activePanels.delete(key);
  }

  private getContext(): vscode.ExtensionContext {
    return this.extensionContextProvider.getContext();
  }

  private async openMarkdownPanel(uri: vscode.Uri): Promise<void> {
    try {
      await this.closeExistingPreview(uri);

      const context = this.getContext();
      const key = this.getPreviewKey(uri);
      const fileName = path.basename(uri.path);
      const projectName = this.getProjectName(uri);
      const contentBytes = await vscode.workspace.fs.readFile(uri);
      const content = Buffer.from(contentBytes).toString('utf8');
      const mdDir = path.dirname(uri.fsPath);
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';

      let markdownResult: Awaited<ReturnType<MarkdownWorkflow['setupMarkdown']>> | undefined;

      const panel = await this.webviewWorkflow.createWebview<WebviewMessage>({
        key,
        viewType: 'vditorPreviewReact',
        title: `${projectName}: ${fileName}`,
        column: vscode.ViewColumn.Active,
        iconPath: vscode.Uri.joinPath(context.extensionUri, 'resources', 'icons', 'markdown.svg'),
        options: {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: [context.extensionUri, vscode.Uri.file(mdDir), ...(workspaceRoot ? [vscode.Uri.file(workspaceRoot)] : [])],
        },
        htmlFactory: async (webview) => {
          markdownResult = await this.markdownWorkflow.setupMarkdown({
            content,
            fsPath: uri.fsPath,
            workspaceRoot,
            webview,
          });

          this.markdownImageAssets.set(uri.fsPath, markdownResult.assets);

          return this.reactWebviewHtmlWorkflow.createReactWebviewHtml({
            extensionUri: context.extensionUri,
            webview,
            routeName: '/Vditor?type=edit',
          });
        },
        onDidReceiveMessage: async (msg, currentPanel) => {
          if (msg.command === 'webviewLoaded') {
            if (!markdownResult) return;

            await currentPanel.webview.postMessage({
              type: 'initVditorData',
              content: markdownResult.content,
              mode: 'edit',
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
              if (!msg.url) return;

              await vscode.env.openExternal(vscode.Uri.parse(msg.url));
            } catch {
              vscode.window.showErrorMessage('无法打开该外部链接。');
            }

            return;
          }

          if (msg.command === 'copyToClipboard') {
            const text = msg.text || '';

            await vscode.env.clipboard.writeText(text);
            vscode.window.showInformationMessage(` 链接已复制: ${text}`);
          }
        },
        onDidDispose: () => {
          if (this.activePanels.get(key) === panel) {
            this.activePanels.delete(key);
          }

          this.markdownImageAssets.delete(uri.fsPath);
        },
      });

      this.activePanels.set(key, panel);
    } catch (error) {
      vscode.window.showErrorMessage(`Markdown 预览打开失败: ${this.toErrorMessage(error)}`);
    }
  }

  private async openPdfPanel(uri: vscode.Uri): Promise<void> {
    try {
      await this.closeExistingPreview(uri);

      const context = this.getContext();
      const key = this.getPreviewKey(uri);
      const fileName = path.basename(uri.path);
      const projectName = this.getProjectName(uri);

      const panel = await this.webviewWorkflow.createWebview<WebviewMessage>({
        key,
        viewType: 'pdfPreviewReact',
        title: `${projectName}: ${fileName}`,
        column: vscode.ViewColumn.Active,
        iconPath: vscode.Uri.joinPath(context.extensionUri, 'resources', 'icons', 'pdf.svg'),
        options: {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: [context.extensionUri],
        },
        htmlFactory: (webview) => {
          return this.reactWebviewHtmlWorkflow.createReactWebviewHtml({
            extensionUri: context.extensionUri,
            webview,
            routeName: '/pdf?type=read',
          });
        },
        onDidReceiveMessage: async (msg, currentPanel) => {
          if (msg.command !== 'webviewLoaded') return;

          try {
            const contentBytes = await vscode.workspace.fs.readFile(uri);

            const fileBase64 = Buffer.from(contentBytes).toString('base64');

            await currentPanel.webview.postMessage({
              type: 'initPdfData',
              contentBase64: fileBase64,
            });
          } catch (error) {
            await currentPanel.webview.postMessage({
              type: 'initLocalFileError',
              message: this.toErrorMessage(error) || 'PDF 文件读取失败',
            });
          }
        },
        onDidDispose: () => {
          if (this.activePanels.get(key) === panel) {
            this.activePanels.delete(key);
          }
        },
      });

      this.activePanels.set(key, panel);
    } catch (error) {
      vscode.window.showErrorMessage(`PDF 预览打开失败: ${this.toErrorMessage(error)}`);
    }
  }

  private async openExcelPanel(uri: vscode.Uri): Promise<void> {
    try {
      await this.closeExistingPreview(uri);

      const context = this.getContext();
      const key = this.getPreviewKey(uri);
      const fileName = path.basename(uri.path);
      const projectName = this.getProjectName(uri);
      const contentBytes = await vscode.workspace.fs.readFile(uri);
      const fileBase64 = Buffer.from(contentBytes).toString('base64');

      const panel = await this.webviewWorkflow.createWebview<WebviewMessage>({
        key,
        viewType: 'excelPreviewReact',
        title: `${projectName}: ${fileName}`,
        column: vscode.ViewColumn.Active,
        iconPath: vscode.Uri.joinPath(context.extensionUri, 'resources', 'icons', 'table.svg'),
        options: {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: [context.extensionUri],
        },
        htmlFactory: (webview) => {
          return this.reactWebviewHtmlWorkflow.createReactWebviewHtml({
            extensionUri: context.extensionUri,
            webview,
            routeName: '/xls?type=read',
          });
        },
        onDidReceiveMessage: async (msg, currentPanel) => {
          if (msg.command !== 'webviewLoaded') return;

          await currentPanel.webview.postMessage({
            type: 'initExcelData',
            fsPath: uri.toString(),
            fileName,
            contentBase64: fileBase64,
          });
        },
        onDidDispose: () => {
          if (this.activePanels.get(key) === panel) {
            this.activePanels.delete(key);
          }
        },
      });

      this.activePanels.set(key, panel);
    } catch (error) {
      vscode.window.showErrorMessage(`Excel 预览打开失败: ${this.toErrorMessage(error)}`);
    }
  }

  private async openDocPanel(uri: vscode.Uri): Promise<void> {
    try {
      await this.closeExistingPreview(uri);

      const context = this.getContext();
      const key = this.getPreviewKey(uri);
      const fileName = path.basename(uri.path);
      const projectName = this.getProjectName(uri);
      const ext = path.extname(uri.fsPath || uri.path).toLowerCase();

      const panel = await this.webviewWorkflow.createWebview<WebviewMessage>({
        key,
        viewType: 'docPreviewReact',
        title: `${projectName}: ${fileName}`,
        column: vscode.ViewColumn.Active,
        iconPath: vscode.Uri.joinPath(context.extensionUri, 'resources', 'icons', 'word.svg'),
        options: {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: [context.extensionUri],
        },
        htmlFactory: (webview) => {
          return this.reactWebviewHtmlWorkflow.createReactWebviewHtml({
            extensionUri: context.extensionUri,
            webview,
            routeName: '/doc?type=read',
          });
        },
        onDidReceiveMessage: async (msg, currentPanel) => {
          if (msg.command !== 'webviewLoaded') return;

          try {
            if (ext === '.doc') {
              await currentPanel.webview.postMessage({
                type: 'initDocError',
                fileName,
                message: '当前预览器暂不支持旧版 .doc 格式，请转换为 .docx 后再预览。',
              });

              return;
            }

            const contentBytes = await vscode.workspace.fs.readFile(uri);

            const fileBase64 = Buffer.from(contentBytes).toString('base64');

            await currentPanel.webview.postMessage({
              type: 'initDocData',
              fsPath: uri.toString(),
              fileName,
              extension: ext,
              contentBase64: fileBase64,
            });
          } catch (error) {
            await currentPanel.webview.postMessage({
              type: 'initDocError',
              fileName,
              message: this.toErrorMessage(error) || 'Word 文件读取失败',
            });
          }
        },
        onDidDispose: () => {
          if (this.activePanels.get(key) === panel) {
            this.activePanels.delete(key);
          }
        },
      });

      this.activePanels.set(key, panel);
    } catch (error) {
      vscode.window.showErrorMessage(`Word 预览打开失败: ${this.toErrorMessage(error)}`);
    }
  }

  private toErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }

    if (typeof error === 'string') {
      return error;
    }

    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }
}
