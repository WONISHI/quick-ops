export type ApiProxyMatchType = 'exact' | 'regex';

export interface ApiProxyMatchItem {
  id: string;
  match: string;
  target?: string;
}

export interface ApiProxyRule {
  id: string;
  name: string;
  enabled: boolean;
  matchType: ApiProxyMatchType;
  match: string;
  matches?: ApiProxyMatchItem[];
  target: string;
  rewrite?: string;
  preserveQuery: boolean;
  listenHost?: string;
  listenPort?: number | string;
  devServerOrigin?: string;
}

export interface ApiProxyGroup {
  id: string;
  name: string;
  collapsed?: boolean;
  ruleIds: string[];
}

export interface ApiProxyLogItem {
  id: string;
  time: number;
  level: 'info' | 'success' | 'error';
  message: string;
  from?: string;
  to?: string;
  ruleId?: string;
}

export interface ApiProxyServerState {
  running: boolean;
  port: number;
  origin: string;
  listenHost: string;
  listenHosts: string[];
  listenPort: number | string;
  devServerOrigin: string;
}

export interface ApiProxyStateMessage {
  type: string;
  rules?: ApiProxyRule[];
  groups?: ApiProxyGroup[];
  logs?: ApiProxyLogItem[];
  server?: ApiProxyServerState;
  activeRuleId?: string;
  validationRuleId?: string;
}
