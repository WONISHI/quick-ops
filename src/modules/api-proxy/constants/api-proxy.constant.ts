import type { ApiProxyServerState } from '@modules/api-proxy/api-proxy.type';

export const API_PROXY_LIST_VIEW_TYPE = 'quickOpsApiProxyList';

export const API_PROXY_EDITOR_VIEW_TYPE = 'quickOpsApiProxyEditor';

export const API_PROXY_LIST_WEBVIEW_ROUTE = '/api-proxy';

export const API_PROXY_EDITOR_WEBVIEW_ROUTE = '/api-proxy-editor';

export const API_PROXY_RULES_STATE_KEY = 'quickOps.apiProxy.rules';

export const API_PROXY_STORAGE_KEY = 'quickOps.apiProxy.state';
export const API_PROXY_EDITOR_PANEL_TYPE = 'quickOps.apiProxyEditor';
export const API_PROXY_DEFAULT_PORT = 57197;
export const API_PROXY_DEFAULT_DEV_SERVER_ORIGIN = 'http://localhost:8081';

export const DEFAULT_SERVER: ApiProxyServerState = {
  running: false,
  port: 0,
  origin: '',
  listenHost: '127.0.0.1',
  listenHosts: ['127.0.0.1', '0.0.0.0'],
  listenPort: API_PROXY_DEFAULT_PORT,
  devServerOrigin: API_PROXY_DEFAULT_DEV_SERVER_ORIGIN,
};
