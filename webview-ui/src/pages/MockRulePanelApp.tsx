import React, { useEffect, useState, useRef } from 'react';
import { vscode } from '../utils/vscode';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCheck, faArrowsRotate, faXmark } from '@fortawesome/free-solid-svg-icons';
import { faFolderOpen, faCopy } from '@fortawesome/free-regular-svg-icons';

export default function MockRulePanelApp() {
  const [proxyId, setProxyId] = useState('');
  const [ruleId, setRuleId] = useState('');
  const [method, setMethod] = useState('GET');
  const [url, setUrl] = useState('');
  const [statusCode, setStatusCode] = useState('200');
  const [contentType, setContentType] = useState('application/json');
  const [delay, setDelay] = useState('0');
  const [reqHeaders, setReqHeaders] = useState('');
  const [dataPath, setDataPath] = useState('');

  const [mode, setMode] = useState('mock'); // mock | custom | file
  const [mockTemplate, setMockTemplate] = useState('{\n  "code": 200,\n  "data": {}\n}');
  const [customJson, setCustomJson] = useState('');
  const [previewResult, setPreviewResult] = useState('');

  const [fileMode, setFileMode] = useState('single');
  const [filePathSingle, setFilePathSingle] = useState('');
  const [filePathsMultiple, setFilePathsMultiple] = useState<string[]>([]);
  const [fileDisposition, setFileDisposition] = useState('inline');

  const [copyStatus, setCopyStatus] = useState<Record<string, boolean>>({});

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
        setDataPath(rule?.dataPath || (msg.globalMockDir ? msg.globalMockDir + '/' : ''));
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
      } else if (msg.type === 'ruleDirSelected') {
        setDataPath(msg.path.endsWith('/') ? msg.path : msg.path + '/');
      } else if (msg.type === 'fileReturnPathSelected') {
        const newPaths = msg.path.split('\n').map((p: string) => p.trim()).filter(Boolean);
        if (fileMode === 'single') { // This requires tracking fileMode via a ref or functional setState if closed over, but simpler to just use current state if updated correctly.
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
  }, [fileMode]); // 注意这里最好加上 fileMode 依赖以解决上面注释里提到的闭包问题

  // Simulate generation when mock template changes
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
        type: 'saveRule', payload: {
          id: ruleId, proxyId, method, url, contentType, enabled: true, dataPath,
          template: tpl, data, mode, filePath, fileDisposition, delay: parsedDelay, reqHeaders: reqHeadersObj, statusCode: parseInt(statusCode) || 200
        }
      });
    } catch (e: any) {
      vscode.postMessage({ type: 'error', message: 'JSON 格式错误: ' + e.message });
    }
  };

  return (
    <div style={{ padding: '20px 30px' }}>
      <style>{`
        body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size, 13px); background: var(--vscode-editor-background); color: var(--vscode-editor-foreground); }
        .panel-container { max-width: 900px; margin: 0 auto; display: flex; flex-direction: column; gap: 20px; }
        h2 { font-weight: 400; font-size: 20px; margin: 0; color: var(--vscode-editor-foreground); }
        .form-row { display: flex; gap: 24px; align-items: flex-end; }
        .form-group { flex: 1; display: flex; flex-direction: column; gap: 6px; }
        label { color: var(--vscode-descriptionForeground); font-size: 12px; }
        input, select, textarea { width: 100%; box-sizing: border-box; padding: 6px; border-radius: 2px; font-family: var(--vscode-font-family); font-size: 13px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); }
        select { background: var(--vscode-dropdown-background); color: var(--vscode-dropdown-foreground); border: 1px solid var(--vscode-dropdown-border); }
        input:focus, select:focus, textarea:focus { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; border-color: var(--vscode-focusBorder); }
        button { padding: 6px 14px; cursor: pointer; border: 1px solid transparent; border-radius: 2px; font-size: 13px; font-family: var(--vscode-font-family); display: inline-flex; align-items: center; justify-content: center; gap: 6px;}
        .btn-pri { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
        .btn-pri:hover { background: var(--vscode-button-hoverBackground); }
        .btn-sec { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
        .btn-sec:hover { background: var(--vscode-button-secondaryHoverBackground); }
        .btn-icon-only { background: transparent; color: var(--vscode-icon-foreground); border: none; padding: 4px; border-radius: 4px; cursor: pointer;}
        .btn-icon-only:hover { background: var(--vscode-toolbar-hoverBackground); }
        .tabs { display: flex; border-bottom: 1px solid var(--vscode-panel-border); margin-top: 10px; gap: 20px; }
        .tab { padding: 8px 0; cursor: pointer; color: var(--vscode-panelTitle-inactiveForeground); text-transform: uppercase; font-size: 11px; letter-spacing: 0.5px; border-bottom: 1px solid transparent; margin-bottom: -1px; }
        .tab.active { color: var(--vscode-panelTitle-activeForeground); border-bottom: 1px solid var(--vscode-panelTitle-activeBorder); }
        .tab-content { padding-top: 16px; }
        .actions-footer { display: flex; justify-content: flex-end; gap: 8px; margin-top: 30px; padding-top: 20px; border-top: 1px solid var(--vscode-panel-border); }
        .textarea-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; }
        .copy-btn { font-size: 11px; padding: 2px 6px; cursor: pointer; color: var(--vscode-textLink-activeForeground); background: transparent; border: none; }
        .copy-btn:hover { text-decoration: underline; }
        .file-tags-container { border: 1px solid var(--vscode-input-border); background: var(--vscode-input-background); min-height: 28px; padding: 4px; border-radius: 2px; flex: 1; display: flex; flex-wrap: wrap; gap: 4px;}
        .file-tag { display: inline-flex; align-items: center; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); padding: 2px 6px; border-radius: 3px; font-size: 11px; word-break: break-all; }
        .file-tag-close { margin-left: 6px; cursor: pointer; opacity: 0.7; }
        .file-tag-close:hover { opacity: 1; color: var(--vscode-errorForeground); }
      `}</style>
      <div className="panel-container">
        <h2>配置拦截规则</h2>
        <div className="form-row">
          <div className="form-group" style={{ flex: '0 0 100px' }}>
            <label>Method</label>
            <select value={method} onChange={e => setMethod(e.target.value)}>
              <option value="GET">GET</option><option value="POST">POST</option>
              <option value="PUT">PUT</option><option value="DELETE">DELETE</option>
            </select>
          </div>
          <div className="form-group">
            <label>API Path</label>
            <input type="text" value={url} onChange={e => setUrl(e.target.value)} placeholder="/api/user/info" />
          </div>
          <div className="form-group" style={{ flex: '0 0 80px' }}>
            <label>状态码</label>
            <input type="number" value={statusCode} onChange={e => setStatusCode(e.target.value)} placeholder="200" />
          </div>
          <div className="form-group" style={{ flex: '0 0 160px' }}>
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

        <div className="form-row">
          <div className="form-group" style={{ flex: '0 0 100px' }}>
            <label>延时返回(ms)</label>
            <input type="number" value={delay} onChange={e => setDelay(e.target.value)} min="0" />
          </div>
          <div className="form-group">
            <label>注入请求头 (合法 JSON 格式)</label>
            <input type="text" value={reqHeaders} onChange={e => setReqHeaders(e.target.value)} placeholder='{"X-Custom-Auth": "token123"}' />
          </div>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label>规则配置存放路径 (必填)</label>
            <div style={{ display: 'flex', gap: '6px' }}>
              <input type="text" value={dataPath} onChange={e => setDataPath(e.target.value)} placeholder="相对于工作区的路径" />
              <button className="btn-sec" onClick={() => vscode.postMessage({ type: 'selectRuleMockDir', currentPath: dataPath })}>
                <FontAwesomeIcon icon={faFolderOpen} />
              </button>
            </div>
          </div>
        </div>

        <div className="tabs">
          <div className={`tab ${mode === 'mock' ? 'active' : ''}`} onClick={() => setMode('mock')}>Mock 模板配置</div>
          <div className={`tab ${mode === 'custom' ? 'active' : ''}`} onClick={() => setMode('custom')}>静态 JSON</div>
          <div className={`tab ${mode === 'file' ? 'active' : ''}`} onClick={() => setMode('file')}>文件下发</div>
        </div>

        <div className="tab-content">
          {mode === 'mock' && (
            <div>
              <div className="textarea-header">
                <label>Mock.js 模板代码</label>
                <button className="copy-btn" onClick={() => handleCopy(mockTemplate, 'mock')}>
                  {copyStatus['mock'] ? <><FontAwesomeIcon icon={faCheck} style={{ color: 'var(--success)' }} /> 已复制</> : <><FontAwesomeIcon icon={faCopy} /> 复制</>}
                </button>
              </div>
              <textarea value={mockTemplate} onChange={e => setMockTemplate(e.target.value)} style={{ height: '240px', fontFamily: 'var(--vscode-editor-font-family, monospace)' }} />

              <div style={{ marginTop: '16px', borderTop: '1px dashed var(--vscode-panel-border)', paddingTop: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <label>实时预览 (Preview)</label>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button className="copy-btn" onClick={() => handleCopy(previewResult, 'preview')}>
                      {copyStatus['preview'] ? <><FontAwesomeIcon icon={faCheck} style={{ color: 'var(--success)' }} /> 已复制</> : <><FontAwesomeIcon icon={faCopy} /> 复制</>}
                    </button>
                    <button className="btn-icon-only" onClick={() => vscode.postMessage({ type: 'simulate', template: mockTemplate, mode: 'mock' })}>
                      <FontAwesomeIcon icon={faArrowsRotate} />
                    </button>
                  </div>
                </div>
                <div style={{ background: 'var(--vscode-input-background)', border: '1px solid var(--vscode-input-border)', borderRadius: '2px', padding: '12px', fontFamily: 'var(--vscode-editor-font-family, monospace)', fontSize: '12px', maxHeight: '180px', overflow: 'auto', whiteSpace: 'pre-wrap' }}>
                  {previewResult}
                </div>
              </div>
            </div>
          )}

          {mode === 'custom' && (
            <div>
              <div className="textarea-header">
                <label>静态 JSON 数据</label>
                <button className="copy-btn" onClick={() => handleCopy(customJson, 'custom')}>
                  {copyStatus['custom'] ? <><FontAwesomeIcon icon={faCheck} style={{ color: 'var(--success)' }} /> 已复制</> : <><FontAwesomeIcon icon={faCopy} /> 复制</>}
                </button>
              </div>
              <textarea value={customJson} onChange={e => setCustomJson(e.target.value)} style={{ height: '420px', fontFamily: 'var(--vscode-editor-font-family, monospace)' }} />
            </div>
          )}

          {mode === 'file' && (
            <div>
              <div className="form-group" style={{ marginBottom: '20px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                  <label style={{ margin: 0 }}>选择要作为接口返回的本地文件</label>
                  <select value={fileMode} onChange={e => setFileMode(e.target.value)} style={{ width: '100px', padding: '2px 4px', fontSize: '11px', height: '22px' }}>
                    <option value="single">单文件</option>
                    <option value="multiple">多文件分发</option>
                  </select>
                </div>
                <div style={{ display: 'flex', gap: '6px', alignItems: 'flex-start' }}>
                  {fileMode === 'single' ? (
                    <input type="text" value={filePathSingle} onChange={e => setFilePathSingle(e.target.value)} placeholder="例如: public/logo.png 或 绝对路径" style={{ flex: 1 }} />
                  ) : (
                    <div className="file-tags-container">
                      {filePathsMultiple.length === 0 ? <span style={{ color: 'var(--text-sub)', fontSize: '11px', padding: '2px' }}>尚未选择文件...</span> : filePathsMultiple.map((path, idx) => (
                        <div key={idx} className="file-tag">
                          <span title={path}>{path}</span> <FontAwesomeIcon icon={faXmark} className="file-tag-close" onClick={() => setFilePathsMultiple(filePathsMultiple.filter((_, i) => i !== idx))} />
                        </div>
                      ))}
                    </div>
                  )}
                  <button className="btn-sec" style={{ height: '28px' }} onClick={() => vscode.postMessage({ type: 'selectFileReturnPath', currentPath: fileMode === 'single' ? filePathSingle : (filePathsMultiple[0] || ''), multiple: fileMode === 'multiple' })}>
                    <FontAwesomeIcon icon={faFolderOpen} />
                  </button>
                </div>
              </div>
              <div className="form-group">
                <label>响应方式 (Content-Disposition)</label>
                <select value={fileDisposition} onChange={e => setFileDisposition(e.target.value)}>
                  <option value="inline">浏览器内预览 (Inline)</option>
                  <option value="attachment">作为附件下载 (Attachment)</option>
                </select>
              </div>
            </div>
          )}
        </div>

        <div className="actions-footer">
          <button className="btn-sec" onClick={() => vscode.postMessage({ type: 'cancel' })}>取消</button>
          <button className="btn-pri" onClick={save}>保存规则</button>
        </div>
      </div>
    </div>
  );
}