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

export interface ApiProxyServerState {
  running: boolean;
  port: number;
  origin: string;
}

export interface ApiProxyStateMessage {
  type: string;
  rules?: ApiProxyRule[];
  server?: ApiProxyServerState;
  activeRuleId?: string;
}