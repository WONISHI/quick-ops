import  { useEffect, useMemo, useState } from 'react';
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

interface ApiProxyServerState {
  running: boolean;
  port: number;
  origin: string;
}

interface ApiProxyStateMessage {
  type: string;
  rules?: ApiProxyRule[];
  server?: ApiProxyServerState;
}

const DEFAULT_SERVER: ApiProxyServerState = {
  running: false,
  port: 0,
  origin: '',
};

export default function ApiProxyListApp() {
  const [rules, setRules] = useState<ApiProxyRule[]>([]);
  const [server, setServer] = useState<ApiProxyServerState>(DEFAULT_SERVER);

  useEffect(() => {
    const handleMessage = (event: MessageEvent<ApiProxyStateMessage>) => {
      const message = event.data;

      if (message?.type !== 'apiProxyState') return;

      setRules(Array.isArray(message.rules) ? message.rules : []);
      setServer(message.server || DEFAULT_SERVER);
    };

    window.addEventListener('message', handleMessage);
    vscode.postMessage({ type: 'apiProxyReady' });

    return () => {
      window.removeEventListener('message', handleMessage);
    };
  }, []);

  const enabledCount = useMemo(() => rules.filter((rule) => rule.enabled).length, [rules]);

  const saveRules = (nextRules: ApiProxyRule[]) => {
    setRules(nextRules);

    vscode.postMessage({
      type: 'saveApiProxyRules',
      rules: nextRules,
    });
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
          rules.map((rule) => {
            const running = server.running && rule.enabled;

            return (
              <div key={rule.id} className={[styles['proxy-item'], running ? styles['proxy-running'] : ''].filter(Boolean).join(' ')}>
                <span className={[styles['proxy-icon'], running ? styles['proxy-icon-running'] : ''].filter(Boolean).join(' ')}>
                  <span className="codicon codicon-symbol-interface" />
                </span>

                <button type="button" className={styles['proxy-main']} title={rule.name || '未命名代理'} onClick={() => editRule(rule)}>
                  <span className={styles['proxy-name']}>{rule.name || '未命名代理'}</span>
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
          })
        )}
      </main>
    </div>
  );
}