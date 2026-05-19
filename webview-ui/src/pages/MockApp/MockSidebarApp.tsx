import { useEffect, useState, useMemo } from 'react';
import { vscode } from '../../utils/vscode';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faServer, faCircle, faGear, faTrash, faPen, faPlus, faFileCode } from '@fortawesome/free-solid-svg-icons';
import { faFolderOpen, faCopy, faFile } from '@fortawesome/free-regular-svg-icons';
import styles from './index.module.css';

export default function MockSidebarApp() {
  const [proxies, setProxies] = useState<any[]>([]);
  const [mocks, setMocks] = useState<any[]>([]);
  const [runningProxies, setRunningProxies] = useState<string[]>([]);
  const [globalMockDir, setGlobalMockDir] = useState<string>('');
  const [copiedUrl, setCopiedUrl] = useState<string>('');

  const isGlobalRunning = useMemo(() => proxies.some((p) => p.enabled), [proxies]);

  useEffect(() => {
    const handleMessage = (e: MessageEvent) => {
      const { type, proxy, mock, mockDir, runningProxies: rp } = e.data;
      if (type === 'config') {
        setProxies(proxy || []);
        setMocks(mock || []);
        setGlobalMockDir(mockDir || '');
      }
      if (type === 'status') {
        setRunningProxies(rp || []);
      }
    };
    window.addEventListener('message', handleMessage);
    vscode.postMessage({ type: 'webviewLoaded' });
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const toggleGlobalServer = () => vscode.postMessage({ type: 'toggleServer', value: !isGlobalRunning });

  const selectGlobalMockDir = () => {
    vscode.postMessage({
      type: 'selectGlobalMockDir',
      currentPath: globalMockDir || '',
    });
  };

  const openProxyModal = (id?: string) => vscode.postMessage({ type: 'openProxyPanel', id });
  const openRuleModal = (proxyId: string, ruleId?: string) => vscode.postMessage({ type: 'openRulePanel', proxyId, ruleId });
  const toggleProxy = (id: string, enabled: boolean) => vscode.postMessage({ type: 'toggleProxy', id, enabled });
  const delProxy = (id: string) => vscode.postMessage({ type: 'deleteProxy', id });
  const toggleRule = (ruleId: string, enabled: boolean) => vscode.postMessage({ type: 'toggleRule', ruleId, enabled });
  const delRule = (ruleId: string) => vscode.postMessage({ type: 'deleteRule', ruleId });

  const copyMockUrl = (url: string) => {
    vscode.postMessage({ type: 'copyText', payload: url });
    setCopiedUrl(url);
    setTimeout(() => setCopiedUrl(''), 3000);
  };

  return (
    <div className={styles['mock-sidebar-root']}>
      <div className={styles['header']}>
        <div className={styles['header-top']}>
          <div className={styles['header-title']}>
            <FontAwesomeIcon icon={faServer} />
            <span title="Mock 服务管理">Mock 服务管理</span>
          </div>
          <div className={`${styles['server-status']} ${isGlobalRunning ? styles['on'] : ''}`} title="点击一键开启/关闭所有端口" onClick={toggleGlobalServer}>
            <FontAwesomeIcon icon={faCircle} /> <span>{isGlobalRunning ? `运行中 (${runningProxies.length})` : '已停止'}</span>
          </div>
        </div>
        <div className={styles['mock-dir-setting']} onClick={selectGlobalMockDir} title="设置全局数据存放目录">
          <FontAwesomeIcon icon={faFolderOpen} /> <span>{globalMockDir || '未设置全局路径'}</span>
        </div>
      </div>
      <div className={styles['content']}>
        {proxies.map(p => {
          const isProxyRunning = runningProxies.includes(p.id);
          const proxyMocks = mocks.filter(m => m.proxyId === p.id);
          return (
            <div key={p.id} className={styles['proxy-container']}>
              <div className={styles['proxy-header']}>
                <div title="当前监听地址">
                  <FontAwesomeIcon icon={faCircle} style={{ color: isProxyRunning ? 'var(--success)' : '#555', fontSize: '10px', marginRight: '6px' }} />
                  <span className={styles['port-badge']}>{p.domain || '127.0.0.1'}:{p.port}</span>
                </div>
                <div className={styles['proxy-actions']}>
                  <label className={styles['switch']} title="启用/停用此端口">
                    <input type="checkbox" checked={!!p.enabled} onChange={(e) => toggleProxy(p.id, e.target.checked)} />
                    <span className={styles['slider']}></span>
                  </label>
                  <button className={styles['icon-btn']} onClick={() => openProxyModal(p.id)} title="配置端口">
                    <FontAwesomeIcon icon={faGear} />
                  </button>
                  <button className={styles['icon-btn']} onClick={() => delProxy(p.id)} title="删除此服务及下属规则">
                    <FontAwesomeIcon icon={faTrash} />
                  </button>
                </div>
              </div>
              <div className={styles['rule-list']}>
                {proxyMocks.map(item => {
                  const isFile = item.mode === 'file';
                  const host = p.domain || '127.0.0.1';
                  const fullUrl = `http://${host}:${p.port}${item.url.startsWith('/') ? '' : '/'}${item.url}`;
                  return (
                    <div key={item.id} className={`${styles['rule-card']} ${item.enabled ? styles['active'] : styles['disabled']}`}>
                      <div className={styles['rule-main']}>
                        <div className={styles['url-container']}>
                          <span className={`${styles['tag']} ${styles[`tag-${item.method}`] || ''}`}>{item.method}</span>
                          {isFile && <span className={`${styles['tag']} ${styles['file-mode-tag']}`} title="此接口返回本地文件">FILE</span>}
                          <strong className={styles['url-text']} title={`完整路径: ${fullUrl}`}>{item.url}</strong>
                          {copiedUrl !== fullUrl ? (
                            <FontAwesomeIcon
                              icon={faCopy}
                              className={styles['copy-icon']}
                              title={`复制完整路径: ${fullUrl}`}
                              onClick={() => copyMockUrl(fullUrl)}
                            />
                          ) : (
                            <span className={styles['copied-text']}>已复制!</span>
                          )}
                        </div>
                        <div className={styles['data-path']} title={`配置文件路径: ${isFile ? item.filePath : item.dataPath}`}>
                          <FontAwesomeIcon icon={isFile ? faFile : faFileCode} /> {isFile ? item.filePath : item.dataPath}
                        </div>
                      </div>
                      <div className={styles['rule-actions']}>
                        <label className={styles['switch']} title="启用/停用此规则">
                          <input type="checkbox" checked={!!item.enabled} onChange={(e) => toggleRule(item.id, e.target.checked)} />
                          <span className={styles['slider']}></span>
                        </label>
                        <button className={styles['icon-btn']} onClick={() => openRuleModal(p.id, item.id)} title="编辑规则">
                          <FontAwesomeIcon icon={faPen} />
                        </button>
                        <button className={styles['icon-btn']} onClick={() => delRule(item.id)} title="删除规则">
                          <FontAwesomeIcon icon={faTrash} />
                        </button>
                      </div>
                    </div>
                  );
                })}
                <button className={styles['add-rule-btn']} title="为此服务新增一个拦截规则" onClick={() => openRuleModal(p.id)}>
                  <FontAwesomeIcon icon={faPlus} /> 添加接口规则
                </button>
              </div>
            </div>
          );
        })}
      </div>
      <div className={styles['footer']}>
        <button onClick={() => openProxyModal()} className={styles['btn-pri']} title="新增 Mock 本地服务端口">
          <FontAwesomeIcon icon={faPlus} /> 添加 Mock 服务
        </button>
      </div>
    </div>
  );
}