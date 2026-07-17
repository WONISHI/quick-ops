export const API_DEV_TOOLS_VIEW_TYPE = 'quickOpsApiDevTools';

export const API_DEV_TOOLS_WEBVIEW_ROUTE = '/api-fox';

export const API_DEV_TOOLS_STATE_KEY = 'quickOps.apiDevTools.state';

/**
 * @description API DevTools View 标题栏命令
 */
export const API_DEV_TOOLS_COMMANDS = {
  ADD_PROJECT: 'quickOps.apiDevTools.addProject',
  ADD_INTERFACE: 'quickOps.apiDevTools.addInterface',
  SAVE_INTERFACE: 'quickOps.apiDevTools.saveInterface',
  SHARE_DOCS: 'quickOps.apiDevTools.shareDocs',
  EXPORT_DOCS: 'quickOps.apiDevTools.exportDocs',
  SHOW_GLOBALS: 'quickOps.apiDevTools.showGlobals',
  CLEAR_ALL: 'quickOps.apiDevTools.clearAll',
  SEND_REQUEST: 'quickOps.apiDevTools.sendRequest',
} as const;

/**
 * @description Extension 通知 Webview 执行标题栏操作的消息类型
 */
export const API_DEV_TOOLS_VIEW_TITLE_ACTION_MESSAGE = 'apiDevToolsViewTitleAction';
