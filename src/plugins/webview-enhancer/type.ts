import * as vscode from 'vscode';
export interface WebviewIconOptions {
  light: string;
  dark: string;
}

/**
 * Webview 图标配置
 *
 * 支持两种写法：
 * 1. string：普通图标，不区分深色/浅色主题
 * 2. object：区分 light / dark 图标
 */
export type WebviewIcon = string | WebviewIconOptions;

export interface WebviewCreatedPayload {
  panel?: vscode.WebviewPanel;

  /**
   * Webview 创建时传入的配置
   */
  options?: {
    /**
     * 图标配置
     *
     * 字符串写法：
     * icon: "resources/icons/preview.svg"
     *
     * 黑白主题写法：
     * icon: {
     *   light: "resources/icons/preview-light.svg",
     *   dark: "resources/icons/preview-dark.svg"
     * }
     */
    icon?: WebviewIcon;
  };

  /**
   * 插件上下文
   */
  context: vscode.ExtensionContext;
}
