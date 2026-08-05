export const API_DEV_TOOLS_VIEW_TYPE = 'quickOpsApiDevTools';

export const API_DEV_TOOLS_WEBVIEW_ROUTE = '/api-fox';

export const API_DEV_TOOLS_STATE_KEY = 'quickOps.apiDevTools.state';

/**
 * @description API DevTools 请求加载状态上下文
 */
export const API_DEV_TOOLS_LOADING_CONTEXT = 'quickOps.apiDevTools.loading';

/**
 * @description API DevTools View 标题栏命令
 */

/**
 * @description API DevTools 浮动编辑器上下文
 */
export const API_DEV_TOOLS_FLOATING_CONTEXT = 'quickOps.apiDevTools.floating';

export const API_DEV_TOOLS_COMMANDS = {
  OPEN_FLOATING: 'quickOps.apiDevTools.openFloating',
  ADD_PROJECT: 'quickOps.apiDevTools.addProject',
  SAVE_INTERFACE: 'quickOps.apiDevTools.saveInterface',
  SHARE_DOCS: 'quickOps.apiDevTools.shareDocs',
  EXPORT_DOCS: 'quickOps.apiDevTools.exportDocs',
  SHOW_GLOBALS: 'quickOps.apiDevTools.showGlobals',
  CLEAR_ALL: 'quickOps.apiDevTools.clearAll',
  SEND_REQUEST: 'quickOps.apiDevTools.sendRequest',
  STOP_REQUEST: 'quickOps.apiDevTools.stopRequest',
} as const;

/**
 * @description Extension 通知 Webview 执行标题栏操作的消息类型
 */
export const API_DEV_TOOLS_VIEW_TITLE_ACTION_MESSAGE = 'apiDevToolsViewTitleAction';

/**
 * @description Extension 通知 Webview 当前是否为悬浮编辑窗口
 */
export const API_DEV_TOOLS_SET_FLOATING_MODE_MESSAGE = 'apiDevToolsSetFloatingMode';
