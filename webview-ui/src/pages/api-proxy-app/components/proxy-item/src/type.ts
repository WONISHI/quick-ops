export type ApiProxyMatchType = 'exact' | 'regex';

export interface ProxyItemRule {
  id: string;
  name: string;
  enabled: boolean;
  matchType: ApiProxyMatchType;
  match: string;
  target: string;
  rewrite?: string;
  preserveQuery: boolean;
}

export interface ProxyItemProps {
  rule: ProxyItemRule;
  active?: boolean;
  running?: boolean;
  onStart?: (rule: ProxyItemRule) => void;
  onStop?: (rule: ProxyItemRule) => void;
  onEdit?: (rule: ProxyItemRule) => void;
  onDelete?: (rule: ProxyItemRule) => void;
}
