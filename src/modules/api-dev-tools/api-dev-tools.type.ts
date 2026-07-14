export interface ApiDevToolsRequestPayload {
  requestId: string;
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: string;
  timeout?: number;
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