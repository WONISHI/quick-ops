import * as vscode from 'vscode';

export const WEBVIEW_CORE_EVENTS = {
  BEFORE_CREATE: 'webview:beforeCreate',
  CREATED: 'webview:created',
  BEFORE_DISPOSE: 'webview:beforeDispose',
  DISPOSED: 'webview:disposed',
  MESSAGE: 'webview:message',
} as const;

export interface WebviewCreateOptions<TMessage = any> {
  /**
   * @description Webview 唯一缓存 key
   *
   * 如果传了 key，同一个 key 的 Webview 会复用。
   */
  key?: string;

  /**
   * @description VSCode Webview viewType
   */
  viewType: string;

  /**
   * @description 面板标题
   */
  title: string;

  /**
   * @description 打开位置
   */
  column?: vscode.ViewColumn;

  /**
   * @description WebviewPanelOptions
   */
  options?: vscode.WebviewPanelOptions & vscode.WebviewOptions;

  /**
   * @description 直接传 html 字符串
   */
  html?: string;

  /**
   * @description 动态生成 html
   */
  htmlFactory?: (webview: vscode.Webview, panel: vscode.WebviewPanel) => string;

  /**
   * @description 图标
   */
  iconPath?:
    | vscode.Uri
    | {
        light: vscode.Uri;
        dark: vscode.Uri;
      };

  /**
   * @description 收到 Webview 消息
   */
  onDidReceiveMessage?: (message: TMessage, panel: vscode.WebviewPanel) => void | Promise<void>;

  /**
   * @description Webview 销毁时触发
   */
  onDidDispose?: (panel: vscode.WebviewPanel) => void | Promise<void>;

  /**
   * @description 如果面板已经存在，是否只 reveal
   *
   * 默认 true。
   */
  revealIfExists?: boolean;
}

export interface WebviewCoreEventContext<TMessage = any> {
  key?: string;
  viewType: string;
  title: string;
  panel?: vscode.WebviewPanel;
  message?: TMessage;
  options?: WebviewCreateOptions<TMessage>;
}