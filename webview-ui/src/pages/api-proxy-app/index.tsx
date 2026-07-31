import { useEffect, useMemo, useState } from 'react';
import { vscode } from '@utils/vscode';
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

export default function ApiProxyListApp() {
  const [rules, setRules] = useState<ApiProxyRule[]>([]);
  const [groups, setGroups] = useState<ApiProxyGroup[]>([]);
  const [server, setServer] = useState<ApiProxyServerState>(DEFAULT_SERVER);

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
  const visibleGroups = useMemo(() => {
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
            const collapsed = !!group.collapsed;

            return (
              <section key={group.id} className={styles['proxy-group']}>
                <button type="button" className={styles['group-header']} onClick={() => toggleGroupCollapse(group.id)}>
                  <span className="codicon codicon-chevron-down" data-collapsed={collapsed} />
                  <span className="codicon codicon-folder" />
                  <span className={styles['group-name']} title={group.name || '未命名分组'}>
                    {group.name || '未命名分组'}
                  </span>
                  <span className={styles['group-count']}>
                    {group.rules.length} 个代理{groupEnabledCount > 0 ? ` · ${groupEnabledCount} 个启用` : ''}
                  </span>
                </button>

                {!collapsed && (
                  <div className={styles['group-body']}>
                    {group.rules.map((rule) => {
                      const running = server.running && rule.enabled;

                      return (
                        <div key={rule.id} className={[styles['proxy-item'], running ? styles['proxy-running'] : ''].filter(Boolean).join(' ')}>
                          <span className={[styles['proxy-icon'], running ? styles['proxy-icon-running'] : ''].filter(Boolean).join(' ')}>
                            <span className="codicon codicon-symbol-interface" />
                          </span>

                          <button type="button" className={styles['proxy-main']} title={rule.name || '未命名代理'} onClick={() => editRule(rule)}>
                            <span className={styles['proxy-name']}>{rule.name || '未命名代理'}</span>
                            <span className={styles['proxy-meta']}>
                              {rule.matchType === 'regex' ? '正则' : '精确'} · {rule.match || '未配置匹配地址'}
                            </span>
                          </button>

                          <div className={styles['proxy-actions']}>
                            <button
                              type="button"
                              className={styles['icon-btn']}
                              title={running ? '停止代理' : '启动代理'}
                              onClick={() => {
                                if (running) {
                                  stopRule(rule);
                                } else {
                                  startRule(rule);
                                }
                              }}
                            >
                              <span className={`codicon ${running ? 'codicon-debug-disconnect' : 'codicon-rocket'}`} />
                            </button>

                            <button type="button" className={styles['icon-btn']} title="修改代理" onClick={() => editRule(rule)}>
                              <span className="codicon codicon-edit" />
                            </button>

                            <button type="button" className={[styles['icon-btn'], styles['danger']].join(' ')} title="删除代理" onClick={() => deleteRule(rule)}>
                              <span className="codicon codicon-trash" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            );
          })
        )}
      </main>
    </div>
  );
}
