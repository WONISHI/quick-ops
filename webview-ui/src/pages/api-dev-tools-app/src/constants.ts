import type { HttpMethod, RequestTab, ResponseTab } from '@/pages/api-dev-tools-app/src/type';

export const HTTP_METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

export const REQUEST_TABS: Array<{ key: RequestTab; label: string }> = [
  { key: 'params', label: 'Params' },
  { key: 'body', label: 'Body' },
  { key: 'headers', label: 'Headers' },
  { key: 'cookies', label: 'Cookies' },
  { key: 'auth', label: 'Auth' },
  { key: 'pre', label: '前置' },
  { key: 'post', label: '后置' },
];

export const RESPONSE_TABS: Array<{ key: ResponseTab; label: string }> = [
  { key: 'body', label: 'Body' },
  { key: 'headers', label: 'Headers' },
  { key: 'raw', label: 'Raw' },
];

export const BOTTOM_PANEL_COLLAPSED_SIZE = 0;
export const BOTTOM_PANEL_DEFAULT_SIZE = 0;
export const BOTTOM_PANEL_MAX_SIZE = 420;
export const RESPONSE_PANEL_RESERVED_SIZE = 110;
export const RESPONSE_HEAD_SIZE = 34;
export const RESPONSE_TABS_SIZE = 32;
export const BOTTOM_RESIZER_SIZE = 6;
export const WORKSPACE_PANE_DEFAULT_WIDTH = 218;
export const WORKSPACE_PANE_MIN_WIDTH = 0;
export const WORKSPACE_PANE_MAX_WIDTH = 380;
export const WORKSPACE_RESIZER_SIZE = 6;
