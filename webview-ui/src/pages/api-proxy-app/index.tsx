import { useEffect, useMemo, useState } from 'react';
import { vscode } from '@utils/vscode';
import ProxyGroup from '@pages/api-proxy-app/components/proxy-group';
import ProxyItem from '@pages/api-proxy-app/components/proxy-item';
import styles from '@pages/api-proxy-app/index.module.css';

type ApiProxyMatchType = 'exact' | 'regex';

interface ApiProxyMatchItem {
  id: string;
  match: string;
  target?: string;
}

interface ApiProxyRule {
  id: string;
  name: string;
  enabled: boolean;
  matchType: ApiProxyMatchType;
  match: string;
  matches?: ApiProxyMatchItem[];
  target: string;
  rewrite?: string;
  preserveQuery: boolean;
}

interface ApiProxyGroup {
  id: string;
  name: string;
  collapsed?: boolean;
  ruleIds: string[];
}

interface ApiProxyVisibleGroup extends ApiProxyGroup {
  rules: ApiProxyRule[];
}

interface ApiProxyServerState {
  running: boolean;
  port: number;
  origin: string;
  listenHost: string;
  listenHosts?: string[];
  listenPort: number;
  devServerOrigin: string;
}

interface ApiProxyStateMessage {
  type: string;
  rules?: ApiProxyRule[];
  groups?: ApiProxyGroup[];
  server?: ApiProxyServerState;
  activeRuleId?: string;
}

const DEFAULT_SERVER: ApiProxyServerState = {
  running: false,
  port: 0,
  origin: '',
  listenHost: '127.0.0.1',
  listenHosts: ['127.0.0.1', '0.0.0.0'],
  listenPort: 57197,
  devServerOrigin: 'http://localhost:8081',
};

function getRuleMatchItems(rule: ApiProxyRule) {
  const matches = Array.isArray(rule.matches) && rule.matches.length > 0 ? rule.matches : [{ id: `${rule.id}-legacy`, match: rule.match, target: '' }];

  return matches.filter((item) => String(item.match || '').trim());
}

function sanitizeRuleForSave(rule: ApiProxyRule): ApiProxyRule {
  const matches = getRuleMatchItems(rule).map((item) => ({
    ...item,
    match: item.match.trim(),
    target: String(item.target || '').trim(),
  }));

  return {
    ...rule,
    name: rule.name.trim(),
    target: rule.target.trim(),
    rewrite: String(rule.rewrite || '').trim(),
    match: matches[0]?.match || '',
    matches,
  };
}

function getStartValidationMessage(rule: ApiProxyRule, server: ApiProxyServerState) {
  if (!String(server.listenHost || '').trim()) {
    return '请先选择监听地址。';
  }

  const listenPort = Number(server.listenPort);

  if (!Number.isFinite(listenPort) || listenPort <= 0 || listenPort > 65535) {
    return '请填写有效的监听端口。';
  }

  if (!String(server.devServerOrigin || '').trim()) {
    return '请填写前端服务地址。';
  }

  if (!String(rule.name || '').trim()) {
    return '请填写代理名称。';
  }

  if (!String(rule.target || '').trim()) {
    return '请填写公共转发目标。';
  }

  if (getRuleMatchItems(rule).length === 0) {
    return '请至少填写一个匹配地址。';
  }

  return '';
}

export default function ApiProxyListApp() {
  const [rules, setRules] = useState<ApiProxyRule[]>([]);
  const [groups, setGroups] = useState<ApiProxyGroup[]>([]);
  const [server, setServer] = useState<ApiProxyServerState>(DEFAULT_SERVER);
  const [activeRuleId, setActiveRuleId] = useState('');

  useEffect(() => {
    const handleMessage = (event: MessageEvent<ApiProxyStateMessage>) => {
      const message = event.data;

      if (message?.type === 'apiProxyActiveRuleChanged') {
        setActiveRuleId(message.activeRuleId || '');
        return;
      }

      if (message?.type !== 'apiProxyState') return;

      setRules(Array.isArray(message.rules) ? message.rules : []);
      setGroups(Array.isArray(message.groups) ? message.groups : []);
      setServer(message.server || DEFAULT_SERVER);
      setActiveRuleId(message.activeRuleId || '');
    };

    window.addEventListener('message', handleMessage);
    vscode.postMessage({ type: 'apiProxyReady' });

    return () => {
      window.removeEventListener('message', handleMessage);
    };
  }, []);

  const enabledCount = useMemo(() => rules.filter((rule) => rule.enabled).length, [rules]);
  const visibleGroups = useMemo<ApiProxyVisibleGroup[]>(() => {
    if (rules.length === 0) return [];

    const ruleMap = new Map(rules.map((rule) => [rule.id, rule]));
    const usedRuleIds = new Set<string>();
    const normalizedGroups = groups
      .map((group) => {
        const groupRules = (group.ruleIds || []).map((ruleId) => ruleMap.get(ruleId)).filter((rule): rule is ApiProxyRule => !!rule);

        groupRules.forEach((rule) => usedRuleIds.add(rule.id));

        return {
          ...group,
          rules: groupRules,
        };
      })
      .filter((group) => group.rules.length > 0 || group.id !== 'default');

    const ungroupedRules = rules.filter((rule) => !usedRuleIds.has(rule.id));

    if (normalizedGroups.length === 0) {
      return [
        {
          id: 'default',
          name: '默认分组',
          collapsed: false,
          ruleIds: rules.map((rule) => rule.id),
          rules,
        },
      ];
    }

    if (ungroupedRules.length === 0) {
      return normalizedGroups;
    }

    return [
      ...normalizedGroups,
      {
        id: 'ungrouped',
        name: '未分组',
        collapsed: false,
        ruleIds: ungroupedRules.map((rule) => rule.id),
        rules: ungroupedRules,
      },
    ];
  }, [groups, rules]);

  const saveRules = (nextRules: ApiProxyRule[]) => {
    setRules(nextRules);

    vscode.postMessage({
      type: 'saveApiProxyRules',
      rules: nextRules,
    });
  };

  const saveGroups = (nextGroups: ApiProxyGroup[]) => {
    setGroups(nextGroups);

    vscode.postMessage({
      type: 'saveApiProxyGroups',
      groups: nextGroups,
    });
  };

  const toggleGroupCollapse = (groupId: string) => {
    if (groupId === 'ungrouped') return;

    const exists = groups.some((group) => group.id === groupId);

    if (!exists) {
      saveGroups([
        {
          id: groupId,
          name: '默认分组',
          collapsed: true,
          ruleIds: rules.map((rule) => rule.id),
        },
      ]);
      return;
    }

    saveGroups(
      groups.map((group) =>
        group.id === groupId
          ? {
              ...group,
              collapsed: !group.collapsed,
            }
          : group,
      ),
    );
  };

  const createProxyInGroup = (group: ApiProxyVisibleGroup) => {
    vscode.postMessage({
      type: 'createApiProxyInGroup',
      groupId: group.id,
      groupName: group.name,
      collapsed: !!group.collapsed,
      ruleIds: group.ruleIds || [],
    });
  };

  const renameGroup = (group: ApiProxyVisibleGroup) => {
    if (group.id === 'ungrouped') return;

    vscode.postMessage({
      type: 'renameApiProxyGroup',
      groupId: group.id,
      groupName: group.name,
      collapsed: !!group.collapsed,
      ruleIds: group.ruleIds || [],
    });
  };

  const deleteGroup = (group: ApiProxyVisibleGroup) => {
    if (group.id === 'ungrouped') return;
    if (!groups.some((item) => item.id === group.id)) return;

    vscode.postMessage({
      type: 'deleteApiProxyGroup',
      groupId: group.id,
      groupName: group.name,
    });
  };

  const startRule = (rule: ApiProxyRule) => {
    const sanitizedRule = sanitizeRuleForSave(rule);
    const validationMessage = getStartValidationMessage(sanitizedRule, server);

    if (validationMessage) {
      vscode.postMessage({
        type: 'showApiProxyValidationError',
        message: validationMessage,
        ruleId: rule.id,
      });
      return;
    }

    const nextRules = rules.map((item) =>
      item.id === rule.id
        ? {
            ...sanitizedRule,
            enabled: true,
          }
        : item,
    );

    saveRules(nextRules);

    vscode.postMessage({
      type: 'startApiProxyServer',
      rules: nextRules,
      listenHost: server.listenHost,
      listenPort: server.listenPort,
      devServerOrigin: server.devServerOrigin,
    });
  };

  const stopRule = (rule: ApiProxyRule) => {
    const nextRules = rules.map((item) =>
      item.id === rule.id
        ? {
            ...item,
            enabled: false,
          }
        : item,
    );

    saveRules(nextRules);

    if (!nextRules.some((item) => item.enabled)) {
      vscode.postMessage({
        type: 'stopApiProxyServer',
      });
    }
  };

  const editRule = (rule: ApiProxyRule) => {
    setActiveRuleId(rule.id);

    vscode.postMessage({
      type: 'openApiProxyEditor',
      ruleId: rule.id,
    });
  };

  const deleteRule = (rule: ApiProxyRule) => {
    vscode.postMessage({
      type: 'deleteApiProxyRule',
      ruleId: rule.id,
      ruleName: rule.name,
    });
  };

  return (
    <div className={styles['api-proxy-list']}>
      <header className={styles['header']}>
        <div className={styles['title']}>接口代理</div>

        <div className={styles['summary']}>
          <span>{rules.length} 个代理</span>
          <span>{enabledCount} 个启用</span>
        </div>
      </header>

      <main className={styles['list']}>
        {rules.length === 0 ? (
          <div className={styles['empty']}>暂无代理。</div>
        ) : (
          visibleGroups.map((group) => {
            const groupEnabledCount = group.rules.filter((rule) => rule.enabled).length;
            const canManageGroup = group.id !== 'ungrouped';
            const canDeleteGroup = canManageGroup && groups.some((item) => item.id === group.id);

            return (
              <ProxyGroup
                key={group.id}
                name={group.name}
                count={group.rules.length}
                enabledCount={groupEnabledCount}
                collapsed={!!group.collapsed}
                contextMenuProps={{
                  minWidth: 150,
                  density: 'compact',
                  items: [
                    {
                      key: 'create-proxy',
                      label: '新建代理',
                      icon: <span className="codicon codicon-add" />,
                      onSelect: () => createProxyInGroup(group),
                    },
                    {
                      type: 'separator',
                      key: 'group-separator',
                      hidden: !canManageGroup,
                    },
                    {
                      key: 'rename-group',
                      label: '分组重命名',
                      icon: <span className="codicon codicon-edit" />,
                      hidden: !canManageGroup,
                      onSelect: () => renameGroup(group),
                    },
                    {
                      key: 'delete-group',
                      label: '删除分组',
                      icon: <span className="codicon codicon-trash" />,
                      danger: true,
                      hidden: !canDeleteGroup,
                      onSelect: () => deleteGroup(group),
                    },
                  ],
                }}
                onToggle={() => toggleGroupCollapse(group.id)}
              >
                {group.rules.map((rule) => (
                  <ProxyItem
                    key={rule.id}
                    rule={rule}
                    active={activeRuleId === rule.id}
                    running={rule.enabled}
                    onStart={startRule}
                    onStop={stopRule}
                    onEdit={editRule}
                    onDelete={deleteRule}
                  />
                ))}
              </ProxyGroup>
            );
          })
        )}
      </main>
    </div>
  );
}
