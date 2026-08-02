import { useEffect, useRef, useState, type MouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { vscode } from '@utils/vscode';
import BaseButton from '@components/BaseButton';
import { BaseForm, BaseFormItem } from '@components/BaseForm';
import BaseInput from '@components/BaseInput';
import BaseSelect from '@components/BaseSelection';
import ApiProxyLogList from '@pages/api-proxy-editor-app/components/api-proxy-log-list';
import styles from '@pages/api-proxy-editor-app/index.module.css';
import { DEFAULT_SERVER } from '@pages/api-proxy-editor-app/src/constants';
import type {
  ApiProxyServerState,
  ApiProxyRule,
  ApiProxyMatchItem,
  ApiProxyGroup,
  ApiProxyStateMessage,
  ApiProxyLogItem,
  ApiProxyMatchType,
} from '@pages/api-proxy-editor-app/src/type';

let localMatchIdSeed = 0;

function createLocalMatchId() {
  localMatchIdSeed += 1;

  return `match-local-${localMatchIdSeed}`;
}

function createProxyOrigin(host: string, port: number | string) {
  const listenHost = String(host || '').trim();
  const listenPort = Number(port);

  if (!listenHost || !Number.isFinite(listenPort) || listenPort <= 0) {
    return '';
  }

  const originHost = listenHost === '0.0.0.0' || listenHost === '::' ? '127.0.0.1' : listenHost;
  const normalizedHost = originHost.includes(':') && !originHost.startsWith('[') ? `[${originHost}]` : originHost;

  return `http://${normalizedHost}:${listenPort}`;
}

function resolveProxyHomeUrl(server: ApiProxyServerState) {
  return server.running && server.origin ? server.origin : createProxyOrigin(server.listenHost, server.listenPort);
}

function getMatchItems(rule: ApiProxyRule | null): ApiProxyMatchItem[] {
  if (!rule) return [];

  if (Array.isArray(rule.matches) && rule.matches.length > 0) {
    return rule.matches.map((item, index) => ({
      id: item.id || `${rule.id}-match-${index}`,
      match: item.match || '',
      target: item.target || '',
    }));
  }

  return [
    {
      id: `${rule.id}-legacy`,
      match: rule.match || '',
      target: '',
    },
  ];
}

function syncRuleMatches(rule: ApiProxyRule, matches: ApiProxyMatchItem[]): ApiProxyRule {
  return {
    ...rule,
    match: matches[0]?.match || '',
    matches,
  };
}

function sanitizeRuleForSave(rule: ApiProxyRule): ApiProxyRule {
  const matches = getMatchItems(rule)
    .filter((item) => item.match.trim())
    .map((item) => ({
      ...item,
      match: item.match.trim(),
      target: String(item.target || '').trim(),
    }));

  return {
    ...rule,
    name: rule.name.trim(),
    target: rule.target.trim(),
    rewrite: String(rule.rewrite || '').trim(),
    listenHost: String(rule.listenHost || DEFAULT_SERVER.listenHost).trim(),
    listenPort: Number(rule.listenPort) || undefined,
    devServerOrigin: String(rule.devServerOrigin || '').trim(),
    match: matches[0]?.match || '',
    matches,
  };
}

function getRuleServer(rule: ApiProxyRule | null, server: ApiProxyServerState): ApiProxyServerState {
  const listenHost = rule ? String(rule.listenHost || DEFAULT_SERVER.listenHost) : String(server.listenHost || DEFAULT_SERVER.listenHost);
  const listenPort = rule ? rule.listenPort || '' : server.listenPort || DEFAULT_SERVER.listenPort;

  return {
    ...server,
    port: Number(listenPort) || 0,
    origin: server.running ? createProxyOrigin(listenHost, listenPort) : '',
    listenHost,
    listenPort,
    devServerOrigin: rule ? String(rule.devServerOrigin || '') : String(server.devServerOrigin || DEFAULT_SERVER.devServerOrigin),
  };
}

function getRuleValidationMessage(rule: ApiProxyRule, server: ApiProxyServerState) {
  const ruleServer = getRuleServer(rule, server);

  if (!String(ruleServer.listenHost || '').trim()) {
    return '请先选择监听地址。';
  }

  const listenPort = Number(ruleServer.listenPort);

  if (!Number.isFinite(listenPort) || listenPort <= 0 || listenPort > 65535) {
    return '请填写有效的监听端口。';
  }

  if (!String(ruleServer.devServerOrigin || '').trim()) {
    return '请填写前端服务地址。';
  }

  if (!String(rule.name || '').trim()) {
    return '请填写代理名称。';
  }

  if (!String(rule.target || '').trim()) {
    return '请填写公共转发目标。';
  }

  if (getMatchItems(rule).filter((item) => item.match.trim()).length === 0) {
    return '请至少填写一个匹配地址。';
  }

  return '';
}

export default function ApiProxyEditorApp() {
  const [rules, setRules] = useState<ApiProxyRule[]>([]);
  const [groups, setGroups] = useState<ApiProxyGroup[]>([]);
  const [logs, setLogs] = useState<ApiProxyLogItem[]>([]);
  const [server, setServer] = useState<ApiProxyServerState>(DEFAULT_SERVER);
  const [activeId, setActiveId] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isValidationVisible, setIsValidationVisible] = useState(false);
  const [expandedLogIds, setExpandedLogIds] = useState<Set<string>>(new Set());
  const [logPanelWidth, setLogPanelWidth] = useState(510);
  const activeIdRef = useRef('');
  const saveTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const handleMessage = (event: MessageEvent<ApiProxyStateMessage>) => {
      const message = event.data;

      if (message?.type !== 'apiProxyState') return;

      const nextRules = Array.isArray(message.rules) ? message.rules : [];
      const nextActiveId = message.activeRuleId && nextRules.some((rule) => rule.id === message.activeRuleId) ? message.activeRuleId : nextRules[0]?.id || '';
      const shouldShowValidation = !!message.validationRuleId && message.validationRuleId === nextActiveId;

      if (activeIdRef.current !== nextActiveId) {
        activeIdRef.current = nextActiveId;
        setIsValidationVisible(shouldShowValidation);
      } else if (shouldShowValidation) {
        setIsValidationVisible(true);
      }

      setRules(nextRules);
      setGroups(Array.isArray(message.groups) ? message.groups : []);
      setLogs(Array.isArray(message.logs) ? message.logs : []);
      setServer(message.server || DEFAULT_SERVER);
      setActiveId(nextActiveId);
      setExpandedLogIds((prev) => {
        const nextLogIds = new Set((message.logs || []).map((log) => log.id));
        const next = new Set<string>();

        prev.forEach((id) => {
          if (nextLogIds.has(id)) {
            next.add(id);
          }
        });

        return next;
      });
    };

    window.addEventListener('message', handleMessage);
    vscode.postMessage({ type: 'apiProxyReady' });

    return () => {
      window.removeEventListener('message', handleMessage);
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
    };
  }, []);

  const activeRule = rules.find((rule) => rule.id === activeId) || null;
  const activeGroup = activeRule ? groups.find((group) => (group.ruleIds || []).includes(activeRule.id)) : null;
  const activeRuleServer = getRuleServer(activeRule, server);
  const isEditingLocked = !!activeRule?.enabled;
  const proxyHomeUrl = resolveProxyHomeUrl(activeRuleServer);
  const canOpenBrowserEntry = !!activeRule?.enabled && server.running && !!proxyHomeUrl;
  const listenHosts = Array.from(new Set([...(server.listenHosts || []), activeRuleServer.listenHost].filter(Boolean)));
  const activeMatchItems = getMatchItems(activeRule);
  const activeLogs = activeRule?.enabled ? logs.filter((log) => log.ruleId === activeRule.id) : [];
  const getValidateStatus = (isInvalid: boolean) => (isValidationVisible && isInvalid ? 'error' : undefined);
  const getValidateHelp = (isInvalid: boolean, message: string) => (isValidationVisible && isInvalid ? message : undefined);

  const saveRules = (nextRules: ApiProxyRule[]) => {
    setRules(nextRules);

    vscode.postMessage({
      type: 'saveApiProxyRules',
      rules: nextRules,
    });
  };

  const saveActiveRuleConfig = () => {
    if (!activeRule) return false;

    setIsValidationVisible(true);

    const sanitizedRule = sanitizeRuleForSave(activeRule);
    const validationMessage = getRuleValidationMessage(sanitizedRule, server);

    if (validationMessage) {
      vscode.postMessage({
        type: 'showApiProxyValidationError',
        message: validationMessage,
        ruleId: activeRule.id,
      });
      return false;
    }

    saveRules(rules.map((rule) => (rule.id === activeRule.id ? sanitizedRule : rule)));
    return true;
  };

  const handleSaveConfig = () => {
    if (isSaving) return;

    const saved = saveActiveRuleConfig();

    if (!saved) return;

    setIsSaving(true);

    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
    }

    saveTimerRef.current = window.setTimeout(() => {
      setIsSaving(false);
      saveTimerRef.current = null;
    }, 1000);
  };

  const updateRule = (patch: Partial<ApiProxyRule>) => {
    if (!activeRule) return;
    if (isEditingLocked) return;

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

  const updateMatchItems = (nextMatches: ApiProxyMatchItem[]) => {
    if (!activeRule) return;
    if (isEditingLocked) return;

    const normalizedMatches = nextMatches.length > 0 ? nextMatches : [{ id: createLocalMatchId(), match: '', target: '' }];
    const nextRule = syncRuleMatches(activeRule, normalizedMatches);

    saveRules(rules.map((rule) => (rule.id === activeRule.id ? nextRule : rule)));
  };

  const updateMatchItem = (matchId: string, patch: Partial<ApiProxyMatchItem>) => {
    updateMatchItems(
      activeMatchItems.map((item) =>
        item.id === matchId
          ? {
              ...item,
              ...patch,
            }
          : item,
      ),
    );
  };

  const addMatchItem = () => {
    updateMatchItems([
      ...activeMatchItems,
      {
        id: createLocalMatchId(),
        match: '',
        target: '',
      },
    ]);
  };

  const removeMatchItem = (matchId: string) => {
    if (activeMatchItems.length <= 1) return;

    updateMatchItems(activeMatchItems.filter((item) => item.id !== matchId));
  };

  const updateServerOptions = (patch: Partial<Pick<ApiProxyServerState, 'listenHost' | 'listenPort' | 'devServerOrigin'>>) => {
    if (!activeRule) return;
    if (isEditingLocked) return;

    const nextServer = {
      ...server,
      ...patch,
    };
    const nextRulePatch: Partial<ApiProxyRule> = {
      ...(patch.listenHost !== undefined ? { listenHost: patch.listenHost } : {}),
      ...(patch.listenPort !== undefined ? { listenPort: patch.listenPort } : {}),
      ...(patch.devServerOrigin !== undefined ? { devServerOrigin: patch.devServerOrigin } : {}),
    };

    setServer(nextServer);
    saveRules(
      rules.map((rule) =>
        rule.id === activeRule.id
          ? {
              ...rule,
              ...nextRulePatch,
            }
          : rule,
      ),
    );
  };

  const clearLogs = () => {
    setExpandedLogIds(new Set());
    vscode.postMessage({
      type: 'clearApiProxyLogs',
    });
  };

  const toggleLogDetail = (logId: string) => {
    setExpandedLogIds((prev) => {
      const next = new Set(prev);

      if (next.has(logId)) {
        next.delete(logId);
      } else {
        next.add(logId);
      }

      return next;
    });
  };

  const handleLogPanelResizePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();

    const startX = event.clientX;
    const startWidth = logPanelWidth;
    const minWidth = 320;
    const maxWidth = Math.max(420, Math.floor(window.innerWidth * 0.62));

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const nextWidth = Math.min(maxWidth, Math.max(minWidth, startWidth + startX - moveEvent.clientX));

      setLogPanelWidth(nextWidth);
    };

    const handlePointerUp = () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);
  };

  const openBrowserEntry = (event?: MouseEvent<HTMLButtonElement>) => {
    event?.preventDefault();
    event?.stopPropagation();

    if (!canOpenBrowserEntry || !proxyHomeUrl) return;

    vscode.postMessage({
      type: 'openApiProxyExternal',
      url: proxyHomeUrl,
    });
  };

  return (
    <div className={styles['api-proxy-editor']}>
      <header className={styles['header']}>
        <div className={styles['title']}>接口代理配置</div>

        <div className={styles['header-actions']}>
          <BaseButton type="primary" size="medium" className={styles['save-button']} disabled={!activeRule || isEditingLocked} loading={isSaving} onClick={handleSaveConfig}>
            {isSaving ? '保存中' : '保存'}
          </BaseButton>
        </div>
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
                    {isEditingLocked ? '代理运行中，配置已锁定' : '命中请求后会转发到配置的目标地址'}
                  </div>
                </div>

                <span className={[styles['form-status'], activeRule.enabled ? styles['form-status-enabled'] : ''].filter(Boolean).join(' ')}>
                  {activeRule.enabled ? '已启用' : '未启用'}
                </span>
              </div>

              <BaseForm labelWidth={76}>
                <BaseFormItem
                  label="监听地址"
                  required
                  validateStatus={getValidateStatus(!activeRuleServer.listenHost.trim())}
                  help={getValidateHelp(!activeRuleServer.listenHost.trim(), '请选择监听地址')}
                  extra="代理服务监听的主机，前端请求需要访问这个地址"
                >
                  <BaseSelect
                    value={activeRuleServer.listenHost}
                    disabled={isEditingLocked}
                    status={getValidateStatus(!activeRuleServer.listenHost.trim())}
                    options={listenHosts.map((host) => ({
                      label: host,
                      value: host,
                    }))}
                    onChange={(value) => updateServerOptions({ listenHost: value })}
                  />
                </BaseFormItem>

                <BaseFormItem
                  label="监听端口"
                  required
                  validateStatus={getValidateStatus(!(Number(activeRuleServer.listenPort) > 0))}
                  help={getValidateHelp(!(Number(activeRuleServer.listenPort) > 0), '请输入监听端口')}
                  extra="不能和 Vue dev server 使用同一个端口"
                >
                  <BaseInput
                    type="number"
                    value={activeRuleServer.listenPort}
                    disabled={isEditingLocked}
                    status={getValidateStatus(!(Number(activeRuleServer.listenPort) > 0))}
                    onValueChange={(value) => updateServerOptions({ listenPort: value })}
                    placeholder="57197"
                  />
                </BaseFormItem>

                <BaseFormItem
                  label="前端服务"
                  required
                  validateStatus={getValidateStatus(!activeRuleServer.devServerOrigin.trim())}
                  help={getValidateHelp(!activeRuleServer.devServerOrigin.trim(), '请输入前端服务地址')}
                  extra="未命中接口代理规则的页面、JS、CSS、HMR 会转发到这里"
                >
                  <BaseInput
                    value={activeRuleServer.devServerOrigin}
                    disabled={isEditingLocked}
                    status={getValidateStatus(!activeRuleServer.devServerOrigin.trim())}
                    allowClear
                    onValueChange={(value) => updateServerOptions({ devServerOrigin: value })}
                    placeholder="http://localhost:8081"
                  />
                </BaseFormItem>

                <BaseFormItem label="名称" required validateStatus={getValidateStatus(!activeRule.name.trim())} help={getValidateHelp(!activeRule.name.trim(), '请输入代理名称')}>
                  <BaseInput
                    value={activeRule.name}
                    status={getValidateStatus(!activeRule.name.trim())}
                    disabled={isEditingLocked}
                    allowClear
                    onValueChange={(value) => updateRule({ name: value })}
                    placeholder="例如：监控"
                  />
                </BaseFormItem>

                <BaseFormItem label="匹配方式">
                  <BaseSelect
                    value={activeRule.matchType}
                    options={[
                      {
                        label: '正则匹配',
                        value: 'regex',
                      },
                      {
                        label: '精确匹配',
                        value: 'exact',
                      },
                    ]}
                    disabled={isEditingLocked}
                    onChange={(value) => updateRule({ matchType: value as ApiProxyMatchType })}
                  />
                </BaseFormItem>

                <BaseFormItem
                  label="转发目标"
                  required
                  validateStatus={getValidateStatus(!activeRule.target.trim())}
                  help={getValidateHelp(!activeRule.target.trim(), '请输入转发目标')}
                >
                  <BaseInput
                    value={activeRule.target}
                    status={getValidateStatus(!activeRule.target.trim())}
                    disabled={isEditingLocked}
                    allowClear
                    onValueChange={(value) => updateRule({ target: value })}
                    placeholder="http://172.24.10.27:80"
                  />
                </BaseFormItem>

                <BaseFormItem
                  label="匹配地址"
                  required
                  validateStatus={getValidateStatus(!activeMatchItems.some((item) => item.match.trim()))}
                  help={getValidateHelp(!activeMatchItems.some((item) => item.match.trim()), '至少填写一个匹配地址')}
                  extra="左侧填匹配地址或正则；右侧转发地址可不填，不填时使用上面的公共转发目标"
                >
                  <div className={styles['match-list']}>
                    {activeMatchItems.map((item) => (
                      <div key={item.id} className={styles['match-row']}>
                        <BaseInput
                          value={item.match}
                          status={getValidateStatus(!item.match.trim())}
                          disabled={isEditingLocked}
                          allowClear
                          onValueChange={(value) => updateMatchItem(item.id, { match: value })}
                          placeholder={activeRule.matchType === 'regex' ? '/ISAPI/(.*)' : '/ISAPI/Security/sessionLogin'}
                        />

                        <BaseInput
                          value={item.target || ''}
                          disabled={isEditingLocked}
                          allowClear
                          onValueChange={(value) => updateMatchItem(item.id, { target: value })}
                          placeholder="转发地址，可不填"
                        />

                        <BaseButton
                          type="icon"
                          size="medium"
                          className={styles['match-remove-button']}
                          disabled={isEditingLocked || activeMatchItems.length <= 1}
                          icon={<span className="codicon codicon-trash" />}
                          title={activeMatchItems.length <= 1 ? '至少保留一条匹配地址' : '删除匹配地址'}
                          onClick={() => removeMatchItem(item.id)}
                        />
                      </div>
                    ))}

                    <BaseButton
                      type="default"
                      size="medium"
                      className={styles['match-add-button']}
                      disabled={isEditingLocked}
                      icon={<span className="codicon codicon-add" />}
                      onClick={addMatchItem}
                    >
                      新增匹配地址
                    </BaseButton>
                  </div>
                </BaseFormItem>

                <BaseFormItem label="重写地址" extra="留空则保持原路径">
                  <BaseInput
                    value={activeRule.rewrite || ''}
                    disabled={isEditingLocked}
                    allowClear
                    onValueChange={(value) => updateRule({ rewrite: value })}
                    placeholder="/ISAPI/$1"
                  />
                </BaseFormItem>

                <BaseFormItem label="保留 Query">
                  <input type="checkbox" checked={activeRule.preserveQuery} disabled={isEditingLocked} onChange={(event) => updateRule({ preserveQuery: event.target.checked })} />
                </BaseFormItem>
              </BaseForm>

              <section className={styles['tester']}>
                <div className={styles['tester-title']}>测试命中</div>

                <div className={styles['preview-label']}>浏览器入口</div>

                <div className={styles['preview-with-action']}>
                  <div className={[styles['preview'], canOpenBrowserEntry ? styles['hit'] : styles['preview-disabled'], styles['preview-action-content']].join(' ')}>
                    {proxyHomeUrl}
                  </div>

                  <BaseButton
                    type="icon"
                    size="large"
                    className={styles['open-browser-button']}
                    disabled={!canOpenBrowserEntry}
                    icon={<span className="codicon codicon-globe" />}
                    title={canOpenBrowserEntry ? '在浏览器打开' : '代理启动后才能打开'}
                    onClick={openBrowserEntry}
                  />
                </div>
              </section>
            </section>

            <section className={styles['log-panel']} style={{ width: logPanelWidth }}>
              <div className={styles['log-resize-handle']} title="拖拽调整日志宽度" onPointerDown={handleLogPanelResizePointerDown} />

              <div className={styles['log-header']}>
                <span>代理日志</span>

                <BaseButton type="default" size="small" className={styles['ghost-button']} onClick={clearLogs}>
                  清空
                </BaseButton>
              </div>

              <ApiProxyLogList logs={activeLogs} expandedLogIds={expandedLogIds} onToggleLogDetail={toggleLogDetail} />
            </section>
          </>
        )}
      </main>
    </div>
  );
}
