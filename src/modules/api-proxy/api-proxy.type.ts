export type ApiProxyMatchType = 'exact' | 'regex';

export interface ApiProxyRule {
  id: string;
  name: string;
  enabled: boolean;
  matchType: ApiProxyMatchType;
  match: string;
  target: string;
  rewrite?: string;
  preserveQuery: boolean;
}

export interface ApiProxyLogItem {
  id: string;
  time: number;
  level: 'info' | 'success' | 'error';
  message: string;
  from?: string;
  to?: string;
}

export interface ApiProxyServerState {
  running: boolean;
  port: number;
  origin: string;
}

export interface ApiProxyWebviewState {
  rules: ApiProxyRule[];
  logs: ApiProxyLogItem[];
  server: ApiProxyServerState;
}

export interface ApiProxyWebviewMessage {
  type: string;
  rules?: ApiProxyRule[];
  port?: number;
  ruleId?: string;
}