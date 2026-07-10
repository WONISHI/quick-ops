import * as vscode from 'vscode';

export const WEBVIEW_CORE_EVENTS = {
  BEFORE_CREATE: 'webview:beforeCreate',
  CREATED: 'webview:created',
  BEFORE_DISPOSE: 'webview:beforeDispose',
  DISPOSED: 'webview:disposed',
  MESSAGE: 'webview:message',
} as const;

/**
 * @description Webview 图标配置
 *
 * 支持两种写法：
 * 1. string：普通图标，不区分深色 / 浅色主题
 * 2. object：区分 light / dark 图标
 */
export interface WebviewIconOptions {
  light: string;
  dark: string;
}

export type WebviewIcon = string | WebviewIconOptions;

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
   * @description 图标配置，给 WebviewAppearancePlugin 使用
   *
   * 示例一：不区分主题
   * icon: 'resources/icons/preview.svg'
   *
   * 示例二：区分浅色 / 深色主题
   * icon: {
   *   light: 'resources/icons/preview-light.svg',
   *   dark: 'resources/icons/preview-dark.svg'
   * }
   */
  icon?: WebviewIcon;

  /**
   * @description VSCode 原生 iconPath
   *
   * 保留这个字段是为了兼容原来的写法。
   * 如果你走 WebviewAppearancePlugin，建议优先用 icon。
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
  /**
   * @description Webview 缓存 key
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
   * @description 当前 WebviewPanel
   */
  panel?: vscode.WebviewPanel;

  /**
   * @description Webview 发送过来的消息
   *
   * 只在 webview:message 生命周期里有值。
   */
  message?: TMessage;

  /**
   * @description 当前 Webview 创建参数
   */
  options?: WebviewCreateOptions<TMessage>;

  /**
   * @description 所有调用 createWebview 时缓存下来的参数
   *
   * key 规则：
   * - 优先使用 options.key
   * - 没有 key 时使用 options.viewType
   *
   * 用途：
   * - Plugin 可以在生命周期里获取其他 Webview 的创建参数
   * - 比如 webview:created / webview:message / webview:disposed 中统一读取
   */
  createOptionsMap?: Map<string, WebviewCreateOptions<any>>;
}
