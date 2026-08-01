import { useEffect, useMemo, useState } from 'react';
import { vscode } from '@utils/vscode';
import ProxyGroup from '@pages/api-proxy-app/components/proxy-group';
import ProxyItem from '@pages/api-proxy-app/components/proxy-item';
import styles from '@pages/api-proxy-app/index.module.css';

type ApiProxyMatchType = 'exact' | 'regex';

interface ApiProxyRule {
  id: string;
  name: string;
  enabled: boolean;
  matchType: ApiProxyMatchType;
  match: string;
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
}

interface ApiProxyStateMessage {
  type: string;
  rules?: ApiProxyRule[];
  groups?: ApiProxyGroup[];
  server?: ApiProxyServerState;
}

const DEFAULT_SERVER: ApiProxyServerState = {
  running: false,
  port: 0,
  origin: '',
};

const createApiProxyId = (prefix: string) => {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const createDefaultProxyRule = (name: string): ApiProxyRule => {
  return {
    id: createApiProxyId('proxy'),
    name,
    enabled: false,
    matchType: 'regex',
    match: '/ISAPI/(.*)',
    target: 'http://127.0.0.1:80',
    rewrite: '/ISAPI/$1',
    preserveQuery: true,
  };
};

export default function ApiProxyListApp() {
  const [rules, setRules] = useState<ApiProxyRule[]>([]);
  const [groups, setGroups] = useState<ApiProxyGroup[]>([]);
  const [server, setServer] = useState<ApiProxyServerState>(DEFAULT_SERVER);
  const [activeRuleId, setActiveRuleId] = useState('');

  useEffect(() => {
    const handleMessage = (event: MessageEvent<ApiProxyStateMessage>) => {
      const message = event.data;

      if (message?.type !== 'apiProxyState') return;

      setRules(Array.isArray(message.rules) ? message.rules : []);
      setGroups(Array.isArray(message.groups) ? message.groups : []);
      setServer(message.server || DEFAULT_SERVER);
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
    const name = window.prompt('请输入代理名称', '新建代理')?.trim();

    if (!name) return;

    const rule = createDefaultProxyRule(name);
    const nextRules = [...rules, rule];
    const exists = groups.some((item) => item.id === group.id);

    if (group.id !== 'ungrouped') {
      const nextGroups = exists
        ? groups.map((item) =>
            item.id === group.id
              ? {
                  ...item,
                  ruleIds: [...new Set([...(item.ruleIds || []), rule.id])],
                }
              : item,
          )
        : [
            ...groups,
            {
              id: group.id,
              name: group.name || '默认分组',
              collapsed: false,
              ruleIds: [...new Set([...(group.ruleIds || []), rule.id])],
            },
          ];

      saveGroups(nextGroups);
    }

    saveRules(nextRules);
    setActiveRuleId(rule.id);

    vscode.postMessage({
      type: 'openApiProxyEditor',
      ruleId: rule.id,
    });
  };

  const renameGroup = (group: ApiProxyVisibleGroup) => {
    if (group.id === 'ungrouped') return;

    const name = window.prompt('请输入新的分组名称', group.name || '默认分组')?.trim();

    if (!name || name === group.name) return;

    const exists = groups.some((item) => item.id === group.id);

    if (!exists) {
      saveGroups([
        ...groups,
        {
          id: group.id,
          name,
          collapsed: !!group.collapsed,
          ruleIds: group.ruleIds || [],
        },
      ]);
      return;
    }

    saveGroups(
      groups.map((item) =>
        item.id === group.id
          ? {
              ...item,
              name,
            }
          : item,
      ),
    );
  };

  const deleteGroup = (group: ApiProxyVisibleGroup) => {
    if (group.id === 'ungrouped') return;
    if (!groups.some((item) => item.id === group.id)) return;

    const confirmed = window.confirm(`确定删除分组「${group.name || '未命名分组'}」吗？分组里的代理会移动到未分组。`);

    if (!confirmed) return;

    saveGroups(groups.filter((item) => item.id !== group.id));
  };

  const startRule = (rule: ApiProxyRule) => {
    const nextRules = rules.map((item) =>
      item.id === rule.id
        ? {
            ...item,
            enabled: true,
          }
        : item,
    );

    saveRules(nextRules);

    vscode.postMessage({
      type: 'startApiProxyServer',
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
    const nextRules = rules.filter((item) => item.id !== rule.id);
    const nextGroups = groups.map((group) => ({
      ...group,
      ruleIds: (group.ruleIds || []).filter((ruleId) => ruleId !== rule.id),
    }));

    saveGroups(nextGroups);
    saveRules(nextRules);

    if (activeRuleId === rule.id) {
      setActiveRuleId('');
    }

    if (!nextRules.some((item) => item.enabled)) {
      vscode.postMessage({
        type: 'stopApiProxyServer',
      });
    }
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
                    running={server.running && rule.enabled}
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
