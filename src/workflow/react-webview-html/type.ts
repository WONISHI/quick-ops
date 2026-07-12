import * as vscode from 'vscode';

export interface ReactWebviewHtmlCreateOptions {
  /**
   * @description 插件根路径
   */
  extensionUri: vscode.Uri;

  /**
   * @description 当前 Webview 实例
   */
  webview: vscode.Webview;

  /**
   * @description React 路由名称
   *
   * 示例：
   * - /anchor
   * - /api-devtools
   */
  routeName: string;

  /**
   * @description webview-ui 构建产物目录
   *
   * 默认：
   * webview-ui/dist
   */
  distDir?: string[];

  /**
   * @description 入口 HTML 文件名
   *
   * 默认：
   * index.html
   */
  indexFileName?: string;
}
