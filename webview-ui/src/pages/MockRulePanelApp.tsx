import { useState, useEffect } from 'react';
import '../assets/css/MockPanel.css';
import { vscode } from '../utils/vscode';

export default function MockRulePanelApp() {
  const [proxyId, setProxyId] = useState('');
  const [globalMockDir, setGlobalMockDir] = useState('');
  const [simulateResult, setSimulateResult] = useState('');
  
  // 复杂的表单状态
  const [formData, setFormData] = useState({
    id: '', method: 'GET', url: '/api/example', contentType: 'application/json',
    enabled: true, dataPath: '', mode: 'mock', delay: 0, statusCode: 200,
    template: '{\n  "code": 0,\n  "msg": "success",\n  "data|1-5": [{ "id|+1": 1, "name": "@cname" }]\n}',
    data: '{\n  "code": 0,\n  "msg": "success",\n  "data": []\n}',
    filePath: '', fileDisposition: 'inline'
  });

  useEffect(() => {
    vscode?.postMessage({ type: 'webviewLoaded' });

    const handleMessage = (event: MessageEvent) => {
      const message = event.data;
      if (message.type === 'init') {
        setProxyId(message.proxyId);
        if (message.globalMockDir) setGlobalMockDir(message.globalMockDir);
        if (message.rule) {
          setFormData({
            ...formData,
            ...message.rule,
            template: typeof message.rule.template === 'object' ? JSON.stringify(message.rule.template, null, 2) : (message.rule.template || formData.template),
            data: typeof message.rule.data === 'object' ? JSON.stringify(message.rule.data, null, 2) : (message.rule.data || formData.data),
          });
        }
      } else if (message.type === 'ruleDirSelected') {
        setFormData(prev => ({ ...prev, dataPath: message.path }));
      } else if (message.type === 'fileReturnPathSelected') {
        setFormData(prev => ({ ...prev, filePath: message.path }));
      } else if (message.type === 'simulateResult') {
        setSimulateResult(message.error ? `错误: ${message.error}` : JSON.stringify(message.result, null, 2));
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const handleChange = (key: string, value: any) => {
    setFormData(prev => ({ ...prev, [key]: value }));
  };

  const handleSimulate = () => {
    vscode?.postMessage({ 
      type: 'simulate', 
      mode: formData.mode, 
      template: formData.mode === 'mock' ? formData.template : formData.data 
    });
  };

  const handleSave = () => {
    if (!formData.url.startsWith('/')) {
      vscode?.postMessage({ type: 'error', message: 'URL 路径必须以 / 开头' });
      return;
    }
    
    let finalTemplate = formData.template;
    let finalData = formData.data;

    try {
      if (formData.mode === 'mock') finalTemplate = JSON.parse(formData.template);
      if (formData.mode === 'custom') finalData = JSON.parse(formData.data);
    } catch (e) {
      vscode?.postMessage({ type: 'error', message: 'JSON 格式错误，请检查！' });
      return;
    }

    vscode?.postMessage({
      type: 'saveRule',
      payload: { ...formData, proxyId, template: finalTemplate, data: finalData }
    });
  };

  return (
    <div className="mock-panel-container">
      <h2>{formData.id ? '编辑规则' : '新增规则'}</h2>
      
      <div className="form-row">
        <div className="form-group flex-1">
          <label>Method</label>
          <select value={formData.method} onChange={e => handleChange('method', e.target.value)}>
            {['GET', 'POST', 'PUT', 'DELETE', 'PATCH'].map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <div className="form-group flex-3">
          <label>URL 路径 <span className="required">*</span></label>
          <input type="text" value={formData.url} onChange={e => handleChange('url', e.target.value)} placeholder="/api/users" />
        </div>
      </div>

      <div className="form-row">
        <div className="form-group flex-1">
          <label>状态码</label>
          <input type="number" value={formData.statusCode} onChange={e => handleChange('statusCode', Number(e.target.value))} />
        </div>
        <div className="form-group flex-1">
          <label>延时 (毫秒)</label>
          <input type="number" value={formData.delay} onChange={e => handleChange('delay', Number(e.target.value))} />
        </div>
      </div>

      <div className="form-group">
        <label>响应数据来源 (Mode)</label>
        <div className="radio-group">
          <label><input type="radio" checked={formData.mode === 'mock'} onChange={() => handleChange('mode', 'mock')} /> Mockjs 动态生成</label>
          <label><input type="radio" checked={formData.mode === 'custom'} onChange={() => handleChange('mode', 'custom')} /> 固定 JSON 数据</label>
          <label><input type="radio" checked={formData.mode === 'file'} onChange={() => handleChange('mode', 'file')} /> 返回本地文件</label>
        </div>
      </div>

      {formData.mode !== 'file' && (
        <div className="form-group">
          <div className="flex-between">
            <label>{formData.mode === 'mock' ? 'Mockjs 模板 (JSON)' : '返回数据 (JSON)'}</label>
            <button className="btn-text" onClick={handleSimulate}>试运行 (Simulate)</button>
          </div>
          <textarea 
            rows={10} 
            value={formData.mode === 'mock' ? formData.template : formData.data}
            onChange={e => handleChange(formData.mode === 'mock' ? 'template' : 'data', e.target.value)}
          />
          {simulateResult && <pre className="simulate-result">{simulateResult}</pre>}
        </div>
      )}

      {formData.mode === 'file' && (
        <div className="form-group">
          <label>选择要返回的本地文件</label>
          <div className="flex-row">
            <input type="text" value={formData.filePath} readOnly placeholder="请选择文件..." />
            <button onClick={() => vscode?.postMessage({ type: 'selectFileReturnPath', currentPath: formData.filePath })}>浏览</button>
          </div>
        </div>
      )}

      <div className="form-group">
        <label>数据存放路径 (相对工作区)</label>
        <div className="flex-row">
          <input type="text" value={formData.dataPath} onChange={e => handleChange('dataPath', e.target.value)} placeholder={globalMockDir || '.mock'} />
          <button onClick={() => vscode?.postMessage({ type: 'selectRuleMockDir', currentPath: formData.dataPath })}>选择目录</button>
        </div>
      </div>

      <div className="actions mt-20">
        <button className="btn-secondary" onClick={() => vscode?.postMessage({ type: 'cancel' })}>取消</button>
        <button className="btn-primary" onClick={handleSave}>保存规则</button>
      </div>
    </div>
  );
}