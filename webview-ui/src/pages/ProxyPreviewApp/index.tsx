import React, { useEffect, useState } from 'react';
import { vscode } from '../../utils/vscode';
import styles from './index.module.css';

interface ProxyRule {
  id: string;
  path: string;
  target: string;
  changeOrigin?: boolean;
  proxyStatic?: boolean;
}

interface ProxyPreviewConfig {
  frontend: string;
  port: number;
  rules: ProxyRule[];
}

interface ProxyPreviewStatus {
  running: boolean;
  frontend: string;
  port: number;
  proxyUrl: string;
  rules: ProxyRule[];
}

const createRule = (): ProxyRule => ({
  id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
  path: '/api',
  target: 'http://localhost:8080',
  changeOrigin: true,
  proxyStatic: false,
});

const DEFAULT_CONFIG: ProxyPreviewConfig = {
  frontend: 'http://localhost:5173',
  port: 8899,
  rules: [createRule()],
};

export default function ProxyPreviewApp() {
  const [config, setConfig] = useState<ProxyPreviewConfig>(DEFAULT_CONFIG);
  const [status, setStatus] = useState<ProxyPreviewStatus | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const message = event.data;

      if (message.type === 'status') {
        setConfig(message.config || DEFAULT_CONFIG);
        setStatus(message.status || null);
        setError('');
        return;
      }

      if (message.type === 'error') {
        setError(message.message || '操作失败');
      }
    };

    window.addEventListener('message', handleMessage);
    vscode.postMessage({ command: 'ready' });

    return () => {
      window.removeEventListener('message', handleMessage);
    };
  }, []);

  const updateRule = (id: string, patch: Partial<ProxyRule>) => {
    setConfig((prev) => ({
      ...prev,
      rules: prev.rules.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule)),
    }));
  };

  const addRule = () => {
    setConfig((prev) => ({
      ...prev,
      rules: [...prev.rules, createRule()],
    }));
  };

  const removeRule = (id: string) => {
    setConfig((prev) => ({
      ...prev,
      rules: prev.rules.filter((rule) => rule.id !== id),
    }));
  };

  const saveConfig = () => {
    vscode.postMessage({
      command: 'saveConfig',
      config,
    });
  };

  const startProxy = () => {
    vscode.postMessage({
      command: 'start',
      config,
    });
  };

  const stopProxy = () => {
    vscode.postMessage({
      command: 'stop',
    });
  };

  const openProxy = () => {
    vscode.postMessage({
      command: 'open',
    });
  };

  return (
    <div className={styles['proxy-page']}>
      <header className={styles['proxy-header']}>
        <div>
          <h2>代理预览</h2>
          <p>不修改 Vite / Webpack 项目代码，通过 QuickOps 本地代理转发后端请求。</p>
        </div>

        <div className={`${styles['status']} ${status?.running ? styles['running'] : styles['stopped']}`}>
          {status?.running ? '运行中' : '未启动'}
        </div>
      </header>

      {error && <div className={styles['error']}>{error}</div>}

      <section className={styles['card']}>
        <div className={styles['form-row']}>
          <label>前端 Dev Server</label>
          <input
            value={config.frontend}
            placeholder="例如：http://localhost:5173"
            onChange={(event) => setConfig({ ...config, frontend: event.target.value })}
          />
        </div>

        <div className={styles['form-row']}>
          <label>代理端口</label>
          <input
            type="number"
            value={config.port}
            placeholder="例如：8899"
            onChange={(event) => setConfig({ ...config, port: Number(event.target.value || 8899) })}
          />
        </div>

        <div className={styles['proxy-url']}>
          访问地址：
          <code>{status?.proxyUrl || `http://127.0.0.1:${config.port}`}</code>
        </div>
      </section>

      <section className={styles['card']}>
        <div className={styles['section-title']}>
          <div>
            <h3>后端代理规则</h3>
            <p>默认不代理 js、css、less、图片、字体、HMR 等前端资源。</p>
          </div>

          <button className={styles['secondary-btn']} onClick={addRule}>
            新增规则
          </button>
        </div>

        <div className={styles['rules']}>
          {config.rules.map((rule) => (
            <div className={styles['rule']} key={rule.id}>
              <div className={styles['rule-inputs']}>
                <div className={styles['form-row']}>
                  <label>匹配路径</label>
                  <input
                    value={rule.path}
                    placeholder="/api"
                    onChange={(event) => updateRule(rule.id, { path: event.target.value })}
                  />
                </div>

                <div className={styles['form-row']}>
                  <label>后端地址</label>
                  <input
                    value={rule.target}
                    placeholder="http://localhost:8080"
                    onChange={(event) => updateRule(rule.id, { target: event.target.value })}
                  />
                </div>
              </div>

              <label className={styles['checkbox']}>
                <input
                  type="checkbox"
                  checked={!!rule.proxyStatic}
                  onChange={(event) => updateRule(rule.id, { proxyStatic: event.target.checked })}
                />
                允许该规则代理静态资源
              </label>

              <button className={styles['danger-btn']} onClick={() => removeRule(rule.id)}>
                删除
              </button>
            </div>
          ))}

          {config.rules.length === 0 && <div className={styles['empty']}>暂无规则，所有请求都会转发到前端 Dev Server。</div>}
        </div>
      </section>

      <footer className={styles['actions']}>
        <button className={styles['secondary-btn']} onClick={saveConfig}>
          保存配置
        </button>

        {status?.running ? (
          <button className={styles['danger-btn']} onClick={stopProxy}>
            停止代理
          </button>
        ) : (
          <button className={styles['primary-btn']} onClick={startProxy}>
            启动代理
          </button>
        )}

        <button className={styles['primary-btn']} disabled={!status?.running} onClick={openProxy}>
          打开代理地址
        </button>
      </footer>

      <section className={styles['tips']}>
        <h3>转发规则</h3>
        <ul>
          <li>资源文件：`.js`、`.css`、`.less`、`.png`、`.svg`、字体、`.map` 默认走前端服务。</li>
          <li>Vite / Webpack HMR：`/@vite`、`/@react-refresh`、`/sockjs-node`、`/ws` 默认走前端服务。</li>
          <li>接口请求：命中上方规则时转发到后端服务。</li>
          <li>其它请求：默认转发到前端 Dev Server。</li>
        </ul>
      </section>
    </div>
  );
}
