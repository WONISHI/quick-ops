import { useEffect, useState } from 'react';
import { vscode } from '../../utils/vscode';
import styles from './index.module.css';

export default function MockProxyPanelApp() {
  const [proxyId, setProxyId] = useState('');
  const [domain, setDomain] = useState('127.0.0.1');
  const [port, setPort] = useState('');
  const [isEdit, setIsEdit] = useState(false);

  useEffect(() => {
    vscode.postMessage({ type: 'webviewLoaded' });
  }, []);

  useEffect(() => {
    const handleMessage = (e: MessageEvent) => {
      const msg = e.data;
      if (msg.type === 'init' && msg.proxy) {
        setProxyId(msg.proxy.id || '');
        setDomain(msg.proxy.domain || '127.0.0.1');
        setPort(msg.proxy.port || '');
        setIsEdit(true);
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const save = () => {
    const portNum = parseInt(port, 10);
    if (!portNum) return vscode.postMessage({ type: 'error', message: '端口为必填项！' });
    vscode.postMessage({ type: 'saveProxy', payload: { id: proxyId, domain: domain || '127.0.0.1', port: portNum } });
  };

  return (
    <div className={styles['mock-proxy-root']}>
      <div className={styles['panel-container']}>
        <h2>{isEdit ? '编辑 Mock 服务' : '新增 Mock 服务'}</h2>
        <div>
          <label>本地服务监听域名 (Domain / Host)</label>
          <input type="text" value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="例如: 127.0.0.1 或 localhost" title="请输入监听域名，默认 127.0.0.1" />
        </div>
        <div>
          <label>本地服务监听端口 (Port)</label>
          <input type="number" value={port} onChange={(e) => setPort(e.target.value)} placeholder="例如: 8080" title="请输入一个空闲的端口号" />
        </div>
        <div className={styles['actions']}>
          <button className={styles['btn-sec']} onClick={() => vscode.postMessage({ type: 'cancel' })} title="取消编辑">取消</button>
          <button className={styles['btn-pri']} onClick={save} title="保存服务端口配置">保存配置</button>
        </div>
      </div>
    </div>
  );
}