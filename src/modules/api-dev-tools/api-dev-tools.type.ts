/**
 * @description multipart/form-data 字段类型
 */
export type ApiDevToolsFormDataValueType = 'text' | 'file';

/**
 * @description multipart/form-data 字段
 */
export interface ApiDevToolsFormDataItemPayload {
  key: string;
  type: ApiDevToolsFormDataValueType;
  value?: string;
  fileName?: string;
  mimeType?: string;
  fileData?: string;
}

export interface ApiDevToolsRequestPayload {
  requestId: string;
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: string;
  formData?: ApiDevToolsFormDataItemPayload[];
  timeout?: number;
}

/**
 * @description 实际发送的 API 请求详情
 */
export interface ApiDevToolsRequestDetailPayload {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
  timeout: number;
}

export interface ApiDevToolsResponsePayload {
  requestId: string;
  ok: boolean;
  url: string;
  status: number;
  statusText: string;
  duration: number;
  size: number;
  headers: Record<string, string>;
  body: string;
  request: ApiDevToolsRequestDetailPayload;
  error?: string;
}

export interface ApiDocsPayload {
  html?: string;
  fileName?: string;
}

export interface ApiDocsSharePayload {
  url: string;
  urls: string[];
  port: number;
}

export interface ApiDocsExportPayload {
  path: string;
}

export interface ApiDevToolsWebviewMessage {
  type: string;
  state?: unknown;
  payload?: unknown;
}

export interface UndiciRequestCreateMessage {
  request?: {
    method?: string;
    origin?: string | URL;
    path?: string;
    headers?: Array<string | Buffer> | string;
    contentLength?: number | string | null;
  };
}

/**
 * @description API DevTools 原生 View 标题栏操作
 */
export type ApiDevToolsViewTitleAction = 'add-project' | 'add-interface' | 'save-interface' | 'share-docs' | 'export-docs' | 'show-globals' | 'clear-all' | 'send-request';
