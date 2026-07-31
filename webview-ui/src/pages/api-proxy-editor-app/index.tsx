import { useEffect, useMemo, useState } from 'react';
import { vscode } from '@utils/vscode';
import { BaseForm, BaseFormItem } from '@components/BaseForm';
import styles from '@pages/api-proxy-editor-app/index.module.css';

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

interface ApiProxyLogItem {
  id: string;
  time: number;
  level: 'info' | 'success' | 'error';
  message: string;
  from?: string;
  to?: string;
}

interface ApiProxyStateMessage {
  type: string;
  rules?: ApiProxyRule[];
  groups?: ApiProxyGroup[];
  logs?: ApiProxyLogItem[];
  activeRuleId?: string;
}

function formatTime(time: number) {
  return time ? new Date(time).toLocaleTimeString() : '';
}

function resolvePreview(rule: ApiProxyRule | null, testUrl: string) {
  if (!rule || !testUrl.trim()) return '';

  try {
    const source = new URL(testUrl.trim(), 'http://127.0.0.1');
    const pathname = source.pathname;
    const fullUrl = source.toString();

    const matched =
      rule.matchType === 'exact'
        ? rule.match === pathname || rule.match === fullUrl
        : (() => {
            const regex = new RegExp(rule.match);
            return regex.test(pathname) || regex.test(fullUrl);
          })();

    if (!matched) return '';

    const rewriteValue = (() => {
      if (!rule.rewrite) return pathname;

      if (rule.matchType === 'regex') {
        const regex = new RegExp(rule.match);
        return regex.test(pathname) ? pathname.replace(regex, rule.rewrite) : fullUrl.replace(regex, rule.rewrite);
      }

      return rule.rewrite;
    })();

    const targetUrl = /^https?:\/\//i.test(rewriteValue) ? new URL(rewriteValue) : new URL(rewriteValue || pathname, rule.target);

    if (rule.preserveQuery && !targetUrl.search) {
      targetUrl.search = source.search;
    }

    return targetUrl.toString();
  } catch {
    return '';
  }
}

export default function ApiProxyEditorApp() {
  const [rules, setRules] = useState<ApiProxyRule[]>([]);
  const [groups, setGroups] = useState<ApiProxyGroup[]>([]);
  const [logs, setLogs] = useState<ApiProxyLogItem[]>([]);
  const [activeId, setActiveId] = useState('');
  const [testUrl, setTestUrl] = useState('/ISAPI/Security/sessionLogin');

  useEffect(() => {
    const handleMessage = (event: MessageEvent<ApiProxyStateMessage>) => {
      const message = event.data;

      if (message?.type !== 'apiProxyState') return;

      const nextRules = Array.isArray(message.rules) ? message.rules : [];
      const nextActiveId = message.activeRuleId && nextRules.some((rule) => rule.id === message.activeRuleId) ? message.activeRuleId : nextRules[0]?.id || '';

      setRules(nextRules);
      setGroups(Array.isArray(message.groups) ? message.groups : []);
      setLogs(Array.isArray(message.logs) ? message.logs : []);
      setActiveId(nextActiveId);
    };

    window.addEventListener('message', handleMessage);
    vscode.postMessage({ type: 'apiProxyReady' });

    return () => {
      window.removeEventListener('message', handleMessage);
    };
  }, []);

  const activeRule = rules.find((rule) => rule.id === activeId) || null;
  const activeGroup = activeRule ? groups.find((group) => (group.ruleIds || []).includes(activeRule.id)) : null;
  const previewTarget = useMemo(() => resolvePreview(activeRule, testUrl), [activeRule, testUrl]);

  const saveRules = (nextRules: ApiProxyRule[]) => {
    setRules(nextRules);

    vscode.postMessage({
      type: 'saveApiProxyRules',
      rules: nextRules,
    });
  };

  const updateRule = (patch: Partial<ApiProxyRule>) => {
    if (!activeRule) return;

    saveRules(
      rules.map((rule) =>
        rule.id === activeRule.id
          ? {
              ...rule,
              ...patch,
            }
          : rule,
      ),
    );
  };

  const clearLogs = () => {
    vscode.postMessage({
      type: 'clearApiProxyLogs',
    });
  };

  return (
    <div className={styles['api-proxy-editor']}>
      <header className={styles['header']}>
        <div className={styles['title']}>接口代理配置</div>
      </header>

      <main className={styles['content']}>
        {!activeRule ? (
          <div className={styles['empty']}>请选择一个代理规则。</div>
        ) : (
          <>
            <section className={styles['form']}>
              <div className={styles['form-head']}>
                <div>
                  <div className={styles['form-title']}>{activeRule.name || '未命名代理'}</div>
                  <div className={styles['form-subtitle']}>
                    {activeGroup?.name ? `所属分组：${activeGroup.name} · ` : ''}
                    命中请求后会转发到配置的目标地址
                  </div>
                </div>

                <span className={[styles['form-status'], activeRule.enabled ? styles['form-status-enabled'] : ''].filter(Boolean).join(' ')}>
                  {activeRule.enabled ? '已启用' : '未启用'}
                </span>
              </div>

              <BaseForm labelWidth={76}>
                <BaseFormItem label="启用">
                  <input type="checkbox" checked={activeRule.enabled} onChange={(event) => updateRule({ enabled: event.target.checked })} />
                </BaseFormItem>

                <BaseFormItem label="名称" required validateStatus={activeRule.name.trim() ? undefined : 'error'} help={activeRule.name.trim() ? undefined : '请输入代理名称'}>
                  <input value={activeRule.name} onChange={(event) => updateRule({ name: event.target.value })} placeholder="例如：监控" />
                </BaseFormItem>

                <BaseFormItem label="匹配方式">
                  <select value={activeRule.matchType} onChange={(event) => updateRule({ matchType: event.target.value as ApiProxyMatchType })}>
                    <option value="regex">正则匹配</option>
                    <option value="exact">精确匹配</option>
                  </select>
                </BaseFormItem>

                <BaseFormItem
                  label="匹配地址"
                  required
                  validateStatus={activeRule.match.trim() ? undefined : 'error'}
                  help={activeRule.match.trim() ? undefined : '请输入匹配地址'}
                >
                  <input value={activeRule.match} onChange={(event) => updateRule({ match: event.target.value })} placeholder="^/ISAPI(?:/.*)?$" />
                </BaseFormItem>

                <BaseFormItem
                  label="转发目标"
                  required
                  validateStatus={activeRule.target.trim() ? undefined : 'error'}
                  help={activeRule.target.trim() ? undefined : '请输入转发目标'}
                >
                  <input value={activeRule.target} onChange={(event) => updateRule({ target: event.target.value })} placeholder="http://172.24.10.27:80" />
                </BaseFormItem>

                <BaseFormItem label="重写地址" extra="留空则保持原路径">
                  <input value={activeRule.rewrite || ''} onChange={(event) => updateRule({ rewrite: event.target.value })} placeholder="/ISAPI/$1" />
                </BaseFormItem>

                <BaseFormItem label="保留 Query">
                  <input type="checkbox" checked={activeRule.preserveQuery} onChange={(event) => updateRule({ preserveQuery: event.target.checked })} />
                </BaseFormItem>
              </BaseForm>

              <section className={styles['tester']}>
                <div className={styles['tester-title']}>测试命中</div>

                <input value={testUrl} onChange={(event) => setTestUrl(event.target.value)} placeholder="/ISAPI/Security/sessionLogin" />

                <div className={[styles['preview'], previewTarget ? styles['hit'] : ''].filter(Boolean).join(' ')}>{previewTarget || '未命中代理规则'}</div>
              </section>
            </section>

            <section className={styles['log-panel']}>
              <div className={styles['log-header']}>
                <span>代理日志</span>

                <button type="button" className={styles['ghost-button']} onClick={clearLogs}>
                  清空
                </button>
              </div>

              <div className={styles['log-list']}>
                {logs.length === 0 ? (
                  <div className={styles['empty']}>暂无日志</div>
                ) : (
                  logs
                    .slice()
                    .reverse()
                    .map((log) => (
                      <div key={log.id} className={[styles['log-item'], styles[`log-${log.level}`]].filter(Boolean).join(' ')}>
                        <div className={styles['log-main']}>
                          <span className={styles['log-time']}>{formatTime(log.time)}</span>
                          <span className={styles['log-message']}>{log.message}</span>
                        </div>

                        {(log.from || log.to) && (
                          <div className={styles['log-detail']}>
                            {log.from && <div>from: {log.from}</div>}
                            {log.to && <div>to: {log.to}</div>}
                          </div>
                        )}
                      </div>
                    ))
                )}
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  );
}
