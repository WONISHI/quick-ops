import { useEffect, useState } from 'react';
import { vscode } from '../../utils/vscode';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCheck, faArrowsRotate, faXmark } from '@fortawesome/free-solid-svg-icons';
import { faFolderOpen, faCopy } from '@fortawesome/free-regular-svg-icons';
import styles from './index.module.css';

export default function MockRulePanelApp() {
  const [proxyId, setProxyId] = useState('');
  const [ruleId, setRuleId] = useState('');
  const [method, setMethod] = useState('GET');
  const [url, setUrl] = useState('');
  const [statusCode, setStatusCode] = useState('200');
  const [contentType, setContentType] = useState('application/json');
  const [delay, setDelay] = useState('0');
  const [reqHeaders, setReqHeaders] = useState('');

  const [mode, setMode] = useState('mock');
  const [mockTemplate, setMockTemplate] = useState('{\n  "code": 200,\n  "data": {}\n}');
  const [customJson, setCustomJson] = useState('');
  const [previewResult, setPreviewResult] = useState('');

  const [fileMode, setFileMode] = useState('single');
  const [filePathSingle, setFilePathSingle] = useState('');
  const [filePathsMultiple, setFilePathsMultiple] = useState<string[]>([]);
  const [fileDisposition, setFileDisposition] = useState('inline');

  const [copyStatus, setCopyStatus] = useState<Record<string, boolean>>({});

  useEffect(() => {
    vscode.postMessage({ type: 'webviewLoaded' });
  }, []);

  useEffect(() => {
    const handleMessage = (e: MessageEvent) => {
      const msg = e.data;
      if (msg.type === 'init') {
        setProxyId(msg.proxyId);
        const rule = msg.rule;
        setRuleId(rule ? rule.id : '');
        setMethod(rule ? rule.method : 'GET');
        setUrl(rule ? rule.url : '');
        setContentType(rule?.contentType || 'application/json');
        setStatusCode(rule?.statusCode?.toString() || '200');
        setDelay(rule?.delay?.toString() || '0');
        setReqHeaders(rule?.reqHeaders ? JSON.stringify(rule.reqHeaders) : '');
        setFileDisposition(rule?.fileDisposition || 'inline');

        let paths = (rule?.filePath || '').split('\n').map((p: string) => p.trim()).filter(Boolean);
        if (paths.length > 1) {
          setFileMode('multiple');
          setFilePathsMultiple(paths);
        } else {
          setFileMode('single');
          setFilePathSingle(paths[0] || '');
        }

        let currMode = rule?.mode;
        if (!currMode) {
          if (rule?.isFile) currMode = 'file';
          else if (rule && !rule.isTemplate && rule.data) currMode = 'custom';
          else currMode = 'mock';
        }
        setMode(currMode);

        if (currMode === 'custom') {
          setCustomJson(typeof rule?.data === 'string' ? rule.data : JSON.stringify(rule?.data || {}, null, 2));
        } else if (currMode === 'mock') {
          setMockTemplate(typeof rule?.template === 'object' ? JSON.stringify(rule.template, null, 2) : (rule?.template || '{\n  "code": 200,\n  "data": {}\n}'));
        }
      } else if (msg.type === 'fileReturnPathSelected') {
        const newPaths = msg.path.split('\n').map((p: string) => p.trim()).filter(Boolean);
        if (fileMode === 'single') {
          setFilePathSingle(newPaths[0] || '');
        } else {
          setFilePathsMultiple(prev => {
            const updated = [...prev];
            newPaths.forEach((p: string) => { if (!updated.includes(p)) updated.push(p); });
            return updated;
          });
        }
      } else if (msg.type === 'simulateResult') {
        setPreviewResult(msg.error ? 'Error: ' + msg.error : JSON.stringify(msg.result, null, 2));
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [fileMode]);

  useEffect(() => {
    if (mode === 'mock' && mockTemplate.trim()) {
      vscode.postMessage({ type: 'simulate', template: mockTemplate, mode: 'mock' });
    }
  }, [mockTemplate, mode]);

  const handleCopy = (text: string, id: string) => {
    vscode.postMessage({ type: 'copyText', payload: text });
    setCopyStatus(prev => ({ ...prev, [id]: true }));
    setTimeout(() => setCopyStatus(prev => ({ ...prev, [id]: false })), 2000);
  };

  const save = () => {
    if (!url) return vscode.postMessage({ type: 'error', message: 'API Path 不能为空！' });

    let parsedDelay = parseInt(delay, 10) || 0;
    let reqHeadersObj = null;
    if (reqHeaders.trim()) {
      try {
        reqHeadersObj = JSON.parse(reqHeaders);
        if (typeof reqHeadersObj !== 'object' || Array.isArray(reqHeadersObj)) throw new Error();
      } catch (e) {
        console.log('e', e);
        return vscode.postMessage({ type: 'error', message: '注入请求头必须是合法的 JSON 对象格式！' });
      }
    }

    let tpl, data, filePath = '';
    try {
      if (mode === 'mock') tpl = JSON.parse(mockTemplate || '{}');
      else if (mode === 'custom') data = JSON.parse(customJson || '{}');
      else if (mode === 'file') {
        filePath = fileMode === 'single' ? filePathSingle.trim() : filePathsMultiple.join('\n');
        if (!filePath) return vscode.postMessage({ type: 'error', message: '请选择要返回的文件！' });
      }

      vscode.postMessage({
        type: 'saveRule',
        payload: {
          id: ruleId,
          proxyId,
          method,
          url,
          contentType,
          enabled: true,
          template: tpl,
          data,
          mode,
          filePath,
          fileDisposition,
          delay: parsedDelay,
          reqHeaders: reqHeadersObj,
          statusCode: parseInt(statusCode) || 200
        }
      });
    } catch (e: any) {
      vscode.postMessage({ type: 'error', message: 'JSON 格式错误: ' + e.message });
    }
  };

  return (
    <div className={styles['mock-rule-root']}>
      <div className={styles['panel-container']}>
        <h2>配置拦截规则</h2>
        <div className={styles['form-row']}>
          <div className={styles['form-group']} style={{ flex: '0 0 100px' }}>
            <label>Method</label>
            <select value={method} onChange={e => setMethod(e.target.value)}>
              <option value="GET">GET</option><option value="POST">POST</option>
              <option value="PUT">PUT</option><option value="DELETE">DELETE</option>
            </select>
          </div>
          <div className={styles['form-group']}>
            <label>API Path</label>
            <input type="text" value={url} onChange={e => setUrl(e.target.value)} placeholder="/api/user/info" />
          </div>
          <div className={styles['form-group']} style={{ flex: '0 0 80px' }}>
            <label>状态码</label>
            <input type="number" value={statusCode} onChange={e => setStatusCode(e.target.value)} placeholder="200" />
          </div>
          <div className={styles['form-group']} style={{ flex: '0 0 160px' }}>
            <label>Content-Type</label>
            <select value={contentType} onChange={e => setContentType(e.target.value)}>
              <option value="application/json">application/json</option>
              <option value="text/plain">text/plain</option>
              <option value="text/html">text/html</option>
              <option value="application/xml">application/xml</option>
              <option value="application/x-www-form-urlencoded">application/x-www-form-urlencoded</option>
              <option value="multipart/form-data">multipart/form-data</option>
              <option value="application/octet-stream">application/octet-stream (文件流)</option>
            </select>
          </div>
        </div>

        <div className={styles['form-row']}>
          <div className={styles['form-group']} style={{ flex: '0 0 100px' }}>
            <label>延时返回(ms)</label>
            <input type="number" value={delay} onChange={e => setDelay(e.target.value)} min="0" />
          </div>
          <div className={styles['form-group']}>
            <label>注入请求头 (合法 JSON 格式)</label>
            <input type="text" value={reqHeaders} onChange={e => setReqHeaders(e.target.value)} placeholder='{"X-Custom-Auth": "token123"}' />
          </div>
        </div>

        <div className={styles['tabs']}>
          <div className={`${styles['tab']} ${mode === 'mock' ? styles['active'] : ''}`} onClick={() => setMode('mock')}>Mock 模板配置</div>
          <div className={`${styles['tab']} ${mode === 'custom' ? styles['active'] : ''}`} onClick={() => setMode('custom')}>静态 JSON</div>
          <div className={`${styles['tab']} ${mode === 'file' ? styles['active'] : ''}`} onClick={() => setMode('file')}>文件下发</div>
        </div>

        <div className={styles['tab-content']}>
          {mode === 'mock' && (
            <div>
              <div className={styles['textarea-header']}>
                <label>Mock.js 模板代码</label>
                <button className={styles['copy-btn']} onClick={() => handleCopy(mockTemplate, 'mock')}>
                  {copyStatus['mock'] ? <><FontAwesomeIcon icon={faCheck} style={{ color: 'var(--success)' }} /> 已复制</> : <><FontAwesomeIcon icon={faCopy} /> 复制</>}
                </button>
              </div>
              <textarea value={mockTemplate} onChange={e => setMockTemplate(e.target.value)} className={styles['mock-template-textarea']} />

              <div className={styles['preview-section']}>
                <div className={styles['preview-header']}>
                  <label>实时预览 (Preview)</label>
                  <div className={styles['preview-actions']}>
                    <button className={styles['copy-btn']} onClick={() => handleCopy(previewResult, 'preview')}>
                      {copyStatus['preview'] ? <><FontAwesomeIcon icon={faCheck} style={{ color: 'var(--success)' }} /> 已复制</> : <><FontAwesomeIcon icon={faCopy} /> 复制</>}
                    </button>
                    <button className={styles['btn-icon-only']} onClick={() => vscode.postMessage({ type: 'simulate', template: mockTemplate, mode: 'mock' })}>
                      <FontAwesomeIcon icon={faArrowsRotate} />
                    </button>
                  </div>
                </div>
                <div className={styles['preview-box']}>
                  {previewResult}
                </div>
              </div>
            </div>
          )}

          {mode === 'custom' && (
            <div>
              <div className={styles['textarea-header']}>
                <label>静态 JSON 数据</label>
                <button className={styles['copy-btn']} onClick={() => handleCopy(customJson, 'custom')}>
                  {copyStatus['custom'] ? <><FontAwesomeIcon icon={faCheck} style={{ color: 'var(--success)' }} /> 已复制</> : <><FontAwesomeIcon icon={faCopy} /> 复制</>}
                </button>
              </div>
              <textarea value={customJson} onChange={e => setCustomJson(e.target.value)} className={styles['custom-json-textarea']} />
            </div>
          )}

          {mode === 'file' && (
            <div>
              <div className={styles['form-group']} style={{ marginBottom: '20px' }}>
                <div className={styles['file-mode-header']}>
                  <label>选择要作为接口返回的本地文件</label>
                  <select value={fileMode} onChange={e => setFileMode(e.target.value)} className={styles['file-mode-select']}>
                    <option value="single">单文件</option>
                    <option value="multiple">多文件分发</option>
                  </select>
                </div>
                <div className={styles['file-select-row']}>
                  {fileMode === 'single' ? (
                    <input type="text" value={filePathSingle} onChange={e => setFilePathSingle(e.target.value)} placeholder="例如: public/logo.png 或 绝对路径" style={{ flex: 1 }} />
                  ) : (
                    <div className={styles['file-tags-container']}>
                      {filePathsMultiple.length === 0 ? <span className={styles['file-empty-text']}>尚未选择文件...</span> : filePathsMultiple.map((path, idx) => (
                        <div key={idx} className={styles['file-tag']}>
                          <span title={path}>{path}</span> <FontAwesomeIcon icon={faXmark} className={styles['file-tag-close']} onClick={() => setFilePathsMultiple(filePathsMultiple.filter((_, i) => i !== idx))} />
                        </div>
                      ))}
                    </div>
                  )}
                  <button className={styles['btn-sec']} style={{ height: '28px' }} onClick={() => vscode.postMessage({ type: 'selectFileReturnPath', currentPath: fileMode === 'single' ? filePathSingle : (filePathsMultiple[0] || ''), multiple: fileMode === 'multiple' })}>
                    <FontAwesomeIcon icon={faFolderOpen} />
                  </button>
                </div>
              </div>
              <div className={styles['form-group']}>
                <label>响应方式 (Content-Disposition)</label>
                <select value={fileDisposition} onChange={e => setFileDisposition(e.target.value)}>
                  <option value="inline">浏览器内预览 (Inline)</option>
                  <option value="attachment">作为附件下载 (Attachment)</option>
                </select>
              </div>
            </div>
          )}
        </div>

        <div className={styles['actions-footer']}>
          <button className={styles['btn-sec']} onClick={() => vscode.postMessage({ type: 'cancel' })}>取消</button>
          <button className={styles['btn-pri']} onClick={save}>保存规则</button>
        </div>
      </div>
    </div>
  );
}