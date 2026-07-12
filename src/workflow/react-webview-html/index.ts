import * as vscode from 'vscode';
import type { ReactWebviewHtmlCreateOptions } from '@workflow/react-webview-html/type';

import type { ETIRuntime, ETIRuntimeProvide } from '@core/eti/eti.type';

/**
 * @description React Webview HTML 工作流
 *
 * 用途：
 * - 统一读取 React Webview 构建后的 index.html
 * - 统一转换静态资源路径为 webview 可访问 URI
 * - 统一注入 React 路由变量
 *
 * 注意：
 * - 不使用 Node fs/path 模块
 * - 只使用 vscode.workspace.fs
 * - 独立于 WebviewWorkflow，不负责创建 WebviewPanel
 */
export default class ReactWebviewHtmlWorkflow implements ETIRuntime {
  /**
   * @description ReactWebviewHtmlWorkflow 单例实例
   *
   * 兼容外部多次 new ReactWebviewHtmlWorkflow()
   */
  private static instance: ReactWebviewHtmlWorkflow | null = null;

  public readonly runtimeId = 'reactWebviewHtml';

  private events: Record<string, Function[]> = {};

  constructor() {
    if (ReactWebviewHtmlWorkflow.instance) {
      return ReactWebviewHtmlWorkflow.instance;
    }

    ReactWebviewHtmlWorkflow.instance = this;
  }

  /**
   * @description 注册 Runtime
   *
   * 当前工作流只提供通用方法，不注册插件事件。
   * 保留 provide 是为了兼容 ETI Runtime 统一结构。
   */
  public provide(): ETIRuntimeProvide {
    return {
      runtimeId: this.runtimeId,
      register: [],
    };
  }

  /**
   * @description ETI 注入 Plugin 监听事件
   *
   * 当前工作流暂不使用 events，但保留以符合 Runtime 规范。
   */
  public inject(events: Record<string, Function[]>): void {
    this.events = events;
  }

  /**
   * @description 创建 React Webview HTML
   */
  public async createReactWebviewHtml(options: ReactWebviewHtmlCreateOptions): Promise<string> {
    const { extensionUri, webview, routeName, distDir = ['webview-ui', 'dist'], indexFileName = 'index.html' } = options;

    const indexUri = vscode.Uri.joinPath(extensionUri, ...distDir, indexFileName);

    const exists = await this.exists(indexUri);

    if (!exists) {
      return `<h1>React UI build not found. Please run 'npm run build:ui' in webview-ui folder</h1>`;
    }

    let html = await this.readTextFile(indexUri);

    html = this.rewriteResourcePaths({
      html,
      extensionUri,
      webview,
      distDir,
    });

    html = this.injectRoute(html, routeName);

    return html;
  }

  /**
   * @description 将普通资源路径转换成 Webview 可访问路径
   */
  public toWebviewUri(options: { extensionUri: vscode.Uri; webview: vscode.Webview; relativePath: string; distDir?: string[] }): string {
    const { extensionUri, webview, relativePath, distDir = ['webview-ui', 'dist'] } = options;

    const sanitizedPath = relativePath.startsWith('/') ? relativePath.slice(1) : relativePath;
    const localUri = vscode.Uri.joinPath(extensionUri, ...distDir, sanitizedPath);

    return webview.asWebviewUri(localUri).toString();
  }

  /**
   * @description 判断 Uri 是否存在
   */
  private async exists(uri: vscode.Uri): Promise<boolean> {
    try {
      await vscode.workspace.fs.stat(uri);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * @description 读取文本文件
   */
  private async readTextFile(uri: vscode.Uri): Promise<string> {
    const fileBuffer = await vscode.workspace.fs.readFile(uri);

    return new TextDecoder('utf-8').decode(fileBuffer);
  }

  /**
   * @description 重写 html 里面的 href/src 路径
   */
  private rewriteResourcePaths(options: { html: string; extensionUri: vscode.Uri; webview: vscode.Webview; distDir: string[] }): string {
    const { html, extensionUri, webview, distDir } = options;

    return html.replace(/(href|src)="([^"]*)"/g, (match, attrName: string, attrValue: string) => {
      if (this.shouldSkipResourceRewrite(attrValue)) {
        return match;
      }

      const webviewUri = this.toWebviewUri({
        extensionUri,
        webview,
        relativePath: attrValue,
        distDir,
      });

      return `${attrName}="${webviewUri}"`;
    });
  }

  /**
   * @description 注入 React Webview 路由
   */
  private injectRoute(html: string, routeName: string): string {
    const scriptInjection = `<script>window.__ROUTE__ = ${JSON.stringify(routeName)};</script>`;

    if (html.includes('</head>')) {
      return html.replace('</head>', `${scriptInjection}\n</head>`);
    }

    return `${scriptInjection}\n${html}`;
  }

  /**
   * @description 判断资源路径是否需要跳过重写
   */
  private shouldSkipResourceRewrite(resource: string): boolean {
    return (
      !resource ||
      resource.startsWith('http://') ||
      resource.startsWith('https://') ||
      resource.startsWith('data:') ||
      resource.startsWith('blob:') ||
      resource.startsWith('vscode-resource:') ||
      resource.startsWith('vscode-webview-resource:') ||
      resource.startsWith('#') ||
      resource.startsWith('mailto:') ||
      resource.startsWith('tel:')
    );
  }
}
