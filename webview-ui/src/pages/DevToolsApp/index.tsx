import { useEffect, useRef, useState } from 'react';
import { vscode } from '../../utils/vscode';
import styles from './index.module.css';

interface DevToolsState {
  devToolsUrl: string;
}

export default function DevToolsApp() {
  const [state, setState] = useState<DevToolsState>({
    devToolsUrl: '',
  });
  const [iframeKey, setIframeKey] = useState(0);
  const latestUrlRef = useRef('');

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const message = event.data;

      if (message?.type === 'init') {
        const nextUrl = String(message.devToolsUrl || '').trim();

        latestUrlRef.current = nextUrl;
        setState({
          devToolsUrl: nextUrl,
        });

        if (nextUrl) {
          setIframeKey((prev) => prev + 1);
        }
      }
    };

    window.addEventListener('message', handleMessage);
    vscode?.postMessage({ type: 'ready' });

    return () => {
      window.removeEventListener('message', handleMessage);
    };
  }, []);

  const reloadDevTools = () => {
    if (!state.devToolsUrl) return;

    setIframeKey((prev) => prev + 1);

    vscode?.postMessage({
      type: 'reloadDevTools',
    });
  };

  const openExternal = () => {
    if (!state.devToolsUrl) return;

    vscode?.postMessage({
      type: 'openExternalDevTools',
      url: state.devToolsUrl,
    });
  };

  if (!state.devToolsUrl) {
    return (
      <div className={styles['devtools-empty-page']}>
        <div className={styles['devtools-empty-card']}>
          <div className={styles['devtools-empty-icon']}>
            <i className="codicon codicon-debug-alt" />
          </div>
          <div className={styles['devtools-empty-title']}>DevTools</div>
          <div className={styles['devtools-empty-desc']}>
            点击网页预览工具栏中的 DevTools 后会显示在这里
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles['devtools-root']}>
      <div className={styles['devtools-toolbar']}>
        <span className={styles['devtools-indicator']} />
        <span className={styles['devtools-title']} title={state.devToolsUrl}>
          {state.devToolsUrl}
        </span>

        <button
          className={styles['devtools-action']}
          type="button"
          onClick={reloadDevTools}
          title="刷新 DevTools"
        >
          刷新
        </button>

        <button
          className={styles['devtools-action']}
          type="button"
          onClick={openExternal}
          title="在外部浏览器打开 DevTools"
        >
          外部打开
        </button>
      </div>

      <iframe
        key={`${iframeKey}-${state.devToolsUrl}`}
        className={styles['devtools-frame']}
        src={state.devToolsUrl}
        allow="clipboard-read; clipboard-write"
        title="Q-ops DevTools"
      />
    </div>
  );
}
