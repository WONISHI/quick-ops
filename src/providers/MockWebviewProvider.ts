import * as vscode from 'vscode';
import * as Mock from 'mockjs';
import { nanoid } from 'nanoid';
import { ConfigurationService } from '../services/ConfigurationService';
import { MockServerFeature } from '../features/MockServerFeature';

export class MockWebviewProvider implements vscode.WebviewViewProvider {
  private _view?: vscode.WebviewView;

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly _mockFeature: MockServerFeature,
  ) {}

  public resolveWebviewView(webviewView: vscode.WebviewView, context: vscode.WebviewViewResolveContext, _token: vscode.CancellationToken) {
    this._view = webviewView;
    webviewView.webview.options = { enableScripts: true, localResourceRoots: [this._extensionUri] };
    webviewView.webview.html = this.getHtmlForWebview(webviewView.webview);
    webviewView.webview.onDidReceiveMessage(async (data) => {
      await this.handleMessage(data, webviewView.webview);
    });
  }

  public async handleMessage(data: any, webview: vscode.Webview) {
    const configService = ConfigurationService.getInstance();
    await configService.loadConfig();
    const currentConfig = configService.config.mock || { port: 3000, target: '', rules: [] };

    switch (data.type) {
      // 新增：处理来自 Webview 的错误提示
      case 'error':
        vscode.window.showErrorMessage(data.message);
        break;

      case 'refresh':
        this.sendConfigToWebview(webview, currentConfig);
        this._mockFeature.notifyStatusToWebview(webview);
        break;

      case 'toggleServer':
        data.value ? await this._mockFeature.startServer() : this._mockFeature.stopServer();
        break;

      case 'saveRule':
        const newRule = data.payload;
        if (!newRule.id) newRule.id = nanoid();
        if (!currentConfig.rules) currentConfig.rules = [];
        const index = currentConfig.rules.findIndex((r: any) => r.id === newRule.id);
        if (index > -1) currentConfig.rules[index] = newRule;
        else currentConfig.rules.push(newRule);

        await configService.updateConfig('mock', currentConfig);
        this.sendConfigToWebview(webview, currentConfig);

        if (newRule.enabled) this._mockFeature.startServer();

        vscode.window.showInformationMessage(`规则 ${newRule.url} 已保存`);
        break;

      case 'deleteRule':
        // 将确认逻辑移到后端，使用 VS Code 原生确认框
        const answer = await vscode.window.showWarningMessage(`确定要删除此拦截规则吗？`, { modal: true }, '删除');
        if (answer !== '删除') return;

        if (currentConfig.rules) {
          currentConfig.rules = currentConfig.rules.filter((r: any) => r.id !== data.id);
          await configService.updateConfig('mock', currentConfig);
          this.sendConfigToWebview(webview, currentConfig);
        }
        break;

      case 'toggleRule':
        if (currentConfig.rules) {
          const rule = currentConfig.rules.find((r: any) => r.id === data.id);
          if (rule) {
            rule.enabled = data.enabled;
            await configService.updateConfig('mock', currentConfig);
            this.sendConfigToWebview(webview, currentConfig);
            if (rule.enabled) this._mockFeature.startServer();
          }
        }
        break;

      case 'simulate':
        try {
          const template = typeof data.template === 'string' ? JSON.parse(data.template) : data.template;
          const result = Mock.mock(template);
          webview.postMessage({ type: 'simulateResult', result });
        } catch (e: any) {
          webview.postMessage({ type: 'simulateResult', error: e.message });
        }
        break;
    }
  }

  public updateStatus(running: boolean, port?: number) {
    this._view?.webview.postMessage({ type: 'status', running, port });
  }

  private sendConfigToWebview(webview: vscode.Webview, config: any) {
    webview.postMessage({ type: 'config', data: config });
  }

  public getHtmlForWebview(webview: vscode.Webview) {
    return `<!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Mock Manager</title>
      <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
      <style>
        :root {
          --primary: var(--vscode-textLink-activeForeground);
          --border: var(--vscode-panel-border);
          --bg: var(--vscode-editor-background);
          --bg-hover: var(--vscode-list-hoverBackground);
          --text: var(--vscode-editor-foreground);
          --text-sub: var(--vscode-descriptionForeground);
          --error: var(--vscode-errorForeground);
          --success: #4caf50;
        }
        body { font-family: var(--vscode-font-family); padding: 0; margin: 0; color: var(--text); background: var(--bg); display: flex; flex-direction: column; height: 100vh; font-size: 13px; }
        
        /* 顶部统计 */
        .header { 
          padding: 10px 16px; border-bottom: 1px solid var(--border); 
          background: var(--vscode-sideBar-background);
          display: flex; justify-content: space-between; align-items: center;
        }
        .header-title { font-weight: bold; font-size: 14px; display: flex; align-items: center; gap: 8px; }
        .server-status { font-size: 11px; padding: 2px 6px; border-radius: 4px; background: #333; color: #fff; opacity: 0.7; }
        .server-status.on { background: var(--success); opacity: 1; }

        /* 内容列表 */
        .content { flex: 1; overflow-y: auto; padding: 12px; background: var(--vscode-editor-background); }
        .rule-list { display: flex; flex-direction: column; gap: 10px; }
        .empty-tip { text-align: center; padding: 30px; opacity: 0.5; display: flex; flex-direction: column; gap: 10px; align-items: center; }

        /* 卡片样式 */
        .card { 
          background: var(--vscode-sideBar-background); 
          border: 1px solid var(--border); 
          border-radius: 6px; 
          padding: 12px; 
          display: flex; align-items: center; gap: 12px;
          transition: all 0.2s;
          position: relative;
          overflow: hidden;
        }
        .card:hover { border-color: var(--primary); box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
        .card::before { content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 3px; background: transparent; transition: 0.2s; }
        .card.active::before { background: var(--success); }
        .card.disabled { opacity: 0.7; filter: grayscale(0.9); }

        /* 卡片内容布局 */
        .card-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
        .card-row-1 { display: flex; align-items: center; gap: 8px; }
        .card-row-2 { display: flex; align-items: center; gap: 10px; font-size: 11px; color: var(--text-sub); }

        .tag { font-size: 10px; font-weight: bold; padding: 1px 4px; border-radius: 3px; border: 1px solid transparent; }
        .tag.GET { color: #3498db; border-color: #3498db; }
        .tag.POST { color: #2ecc71; border-color: #2ecc71; }
        .tag.PUT { color: #f39c12; border-color: #f39c12; }
        .tag.DELETE { color: #e74c3c; border-color: #e74c3c; }
        
        .url-text { font-family: 'Consolas', monospace; font-weight: bold; font-size: 13px;overflow: hidden;text-overflow: ellipsis;}
        .proxy-target { display: flex; align-items: center; gap: 4px; max-width: 150px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }

        /* 操作区 */
        .actions { display: flex; align-items: center; gap: 8px; }
        .icon-btn { 
          background: transparent; border: none; color: var(--text-sub); 
          cursor: pointer; padding: 6px; border-radius: 4px; transition: 0.2s; font-size: 14px;
        }
        .icon-btn:hover { background: var(--bg-hover); color: var(--primary); }
        .icon-btn.del:hover { color: var(--error); }

        /* 开关 Switch */
        .switch { position: relative; display: inline-block; width: 34px; height: 18px; }
        .switch input { opacity: 0; width: 0; height: 0; }
        .slider { position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0; background-color: #ccc; transition: .3s; border-radius: 18px; }
        .slider:before { position: absolute; content: ""; height: 14px; width: 14px; left: 2px; bottom: 2px; background-color: white; transition: .3s; border-radius: 50%; }
        input:checked + .slider { background-color: var(--success); }
        input:checked + .slider:before { transform: translateX(16px); }

        /* 底部 */
        .footer { padding: 12px; border-top: 1px solid var(--border); background: var(--vscode-sideBar-background); text-align: center; }
        .add-btn { 
          background: var(--primary); color: white; border: none; 
          padding: 8px 24px; border-radius: 4px; cursor: pointer; font-size: 13px; 
          display: flex; align-items: center; justify-content: center; gap: 8px; width: 100%; box-sizing: border-box;
        }
        .add-btn:hover { opacity: 0.9; }

        /* 模态框 */
        .modal { display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.6); z-index: 999; justify-content: center; align-items: center; backdrop-filter: blur(2px); }
        .modal.active { display: flex; }
        .modal-box { 
          background: var(--vscode-editor-background); width: 600px; max-width: 90%; 
          border: 1px solid var(--border); border-radius: 8px; 
          box-shadow: 0 8px 24px rgba(0,0,0,0.4); 
          display: flex; flex-direction: column; max-height: 90vh;
        }
        .modal-header { padding: 16px; border-bottom: 1px solid var(--border); font-weight: bold; font-size: 15px; display: flex; justify-content: space-between; }
        .modal-body { padding: 20px; overflow-y: auto; flex: 1; }
        .modal-footer { padding: 16px; border-top: 1px solid var(--border); display: flex; justify-content: flex-end; gap: 10px; background: var(--vscode-sideBar-background); border-bottom-left-radius: 8px; border-bottom-right-radius: 8px; }

        /* 表单 */
        .form-row { display: flex; gap: 15px; margin-bottom: 15px; }
        .form-group { flex: 1; }
        .form-label { display: block; margin-bottom: 6px; font-size: 12px; font-weight: 600; color: var(--text); }
        input, select, textarea { 
          width: 100%; box-sizing: border-box; background: var(--vscode-input-background); 
          color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); 
          padding: 8px; border-radius: 4px; outline: none; font-family: inherit;
        }
        input:focus, select:focus, textarea:focus { border-color: var(--primary); }

        /* Tabs */
        .tabs { display: flex; gap: 2px; background: var(--vscode-sideBar-background); padding: 4px; border-radius: 4px; margin-bottom: 15px; border: 1px solid var(--border); }
        .tab { flex: 1; text-align: center; padding: 6px; cursor: pointer; border-radius: 3px; font-size: 12px; opacity: 0.7; }
        .tab.active { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); opacity: 1; font-weight: bold; }
        .tab-pane { display: none; }
        .tab-pane.active { display: block; }

        .btn-secondary { background: transparent; border: 1px solid var(--border); color: var(--text); padding: 6px 16px; border-radius: 4px; cursor: pointer; }
        .btn-primary { background: var(--primary); color: white; border: none; padding: 6px 20px; border-radius: 4px; cursor: pointer; }
        
        #previewBox { margin-top: 10px; padding: 10px; background: rgba(0,0,0,0.2); border-radius: 4px; font-family: monospace; font-size: 12px; white-space: pre-wrap; display: none; max-height: 150px; overflow: auto; border: 1px solid var(--border); }
      </style>
    </head>
    <body>
      
      <div class="header">
        <div class="header-title"><i class="fa-solid fa-server"></i> Mock Manager</div>
        <div id="serverStatus" class="server-status">Offline</div>
      </div>

      <div class="content">
        <div id="ruleList" class="rule-list"></div>
      </div>

      <div class="footer">
        <button onclick="openModal()" class="add-btn"><i class="fa-solid fa-plus"></i> 新增接口拦截</button>
      </div>

      <div id="modal" class="modal">
        <div class="modal-box">
          <div class="modal-header">
            <span id="modalTitle">新增规则</span>
            <i class="fa-solid fa-xmark" onclick="closeModal()" style="cursor:pointer; opacity:0.5;"></i>
          </div>
          <div class="modal-body">
            <input type="hidden" id="ruleId">
            
            <div class="form-row">
              <div class="form-group" style="flex: 0 0 100px;">
                <label class="form-label">Method</label>
                <select id="method">
                  <option value="GET">GET</option>
                  <option value="POST">POST</option>
                  <option value="PUT">PUT</option>
                  <option value="DELETE">DELETE</option>
                  <option value="PATCH">PATCH</option>
                </select>
              </div>
              <div class="form-group">
                <label class="form-label">API Path</label>
                <input type="text" id="url" placeholder="/api/users/list">
              </div>
            </div>

            <div class="form-row">
              <div class="form-group">
                  <label class="form-label">Content-Type</label>
                  <select id="contentType">
                    <option value="application/json">application/json</option>
                    <option value="text/plain">text/plain</option>
                    <option value="text/html">text/html</option>
                    <option value="application/xml">application/xml</option>
                  </select>
              </div>
              <div class="form-group">
                  <label class="form-label">Target (代理目标, 可选)</label>
                  <input type="text" id="target" placeholder="继承全局配置或 http://...">
              </div>
            </div>

            <label class="form-label">Response Body</label>
            <div class="tabs">
              <div class="tab active" onclick="switchTab('mock')"><i class="fa-solid fa-wand-magic-sparkles"></i> Mock 模板</div>
              <div class="tab" onclick="switchTab('custom')"><i class="fa-solid fa-code"></i> 自定义 JSON</div>
            </div>

            <div id="pane-mock" class="tab-pane active">
               <textarea id="mockTemplate" style="height: 180px; font-family: monospace;" placeholder='{ "code": 0, "msg": "success", "data": { "list|5": [{"id|+1":1, "name":"@cname"}] } }'></textarea>
               <div style="margin-top: 8px; font-size: 11px; opacity: 0.6;">支持 Mock.js 语法。</div>
            </div>
            
            <div id="pane-custom" class="tab-pane">
               <textarea id="customJson" style="height: 180px; font-family: monospace;" placeholder='{ "fixed": "data" }'></textarea>
            </div>

            <div style="margin-top: 15px;">
              <button onclick="simulate()" class="btn-secondary" style="font-size: 12px;"><i class="fa-solid fa-play"></i> 生成预览</button>
              <div id="previewBox"></div>
            </div>

          </div>
          <div class="modal-footer">
            <button onclick="closeModal()" class="btn-secondary">取消</button>
            <button onclick="save()" class="btn-primary">保存规则</button>
          </div>
        </div>
      </div>

      <script>
        const vscode = acquireVsCodeApi();
        let config = { rules: [], target: '' };

        window.addEventListener('message', e => {
           const msg = e.data;
           if(msg.type === 'config') {
             config = msg.data || { rules: [] };
             render();
           }
           if(msg.type === 'status') {
             const el = document.getElementById('serverStatus');
             if(msg.running) {
               el.innerText = 'Running: ' + msg.port;
               el.className = 'server-status on';
             } else {
               el.innerText = 'Offline';
               el.className = 'server-status';
             }
           }
           if(msg.type === 'simulateResult') {
             const box = document.getElementById('previewBox');
             box.style.display = 'block';
             box.innerText = msg.error ? 'Error: ' + msg.error : JSON.stringify(msg.result, null, 2);
             box.style.color = msg.error ? 'var(--error)' : 'var(--text)';
           }
        });
        
        vscode.postMessage({ type: 'refresh' });

        function render() {
          const list = document.getElementById('ruleList');
          list.innerHTML = '';
          
          if(!config.rules || config.rules.length === 0) {
            list.innerHTML = \`<div class="empty-tip"><i class="fa-solid fa-inbox fa-2x"></i><div>暂无拦截规则</div></div>\`;
            return;
          }

          config.rules.forEach(r => {
            const isActive = r.enabled;
            const targetText = r.target || config.target || 'Global';
            
            const item = document.createElement('div');
            item.className = 'card ' + (isActive ? 'active' : 'disabled');
            item.innerHTML = \`
              <div class="card-main">
                <div class="card-row-1">
                   <span class="tag \${r.method}">\${r.method}</span>
                   <span class="url-text">\${r.url}</span>
                </div>
                <div class="card-row-2">
                   <span class="proxy-target" title="代理目标: \${targetText}"><i class="fa-solid fa-arrow-right-long"></i> \${targetText}</span>
                   <span style="opacity:0.5">|</span>
                   <span>\${r.contentType || 'json'}</span>
                </div>
              </div>
              
              <div class="actions">
                 <label class="switch" title="\${isActive ? '点击关闭' : '点击开启'}">
                   <input type="checkbox" \${isActive ? 'checked' : ''} onchange="toggle('\${r.id}', this.checked)">
                   <span class="slider"></span>
                 </label>
                 <button class="icon-btn" onclick="edit('\${r.id}')" title="编辑"><i class="fa-solid fa-pen"></i></button>
                 <button class="icon-btn del" onclick="del('\${r.id}')" title="删除"><i class="fa-solid fa-trash"></i></button>
              </div>
            \`;
            list.appendChild(item);
          });
        }

        /* 逻辑部分 */
        window.toggle = (id, val) => vscode.postMessage({ type: 'toggleRule', id, enabled: val });
        
        // 修改：不再使用 confirm，直接发消息给插件处理
        window.del = (id) => vscode.postMessage({ type: 'deleteRule', id });
        
        window.switchTab = (tab) => {
           document.querySelectorAll('.tab').forEach(el => el.classList.remove('active'));
           document.querySelectorAll('.tab-pane').forEach(el => el.classList.remove('active'));
           event.currentTarget.classList.add('active');
           document.getElementById('pane-' + tab).classList.add('active');
        };

        window.openModal = () => {
           document.getElementById('modalTitle').innerText = '新增规则';
           document.getElementById('ruleId').value = '';
           document.getElementById('method').value = 'GET';
           document.getElementById('url').value = '';
           document.getElementById('contentType').value = 'application/json';
           document.getElementById('mockTemplate').value = '{\\n  "code": 0,\\n  "data": "@cname"\\n}';
           document.getElementById('customJson').value = '{}';
           document.getElementById('previewBox').style.display = 'none';
           document.getElementById('modal').classList.add('active');
           switchTab('mock');
        };

        window.closeModal = () => document.getElementById('modal').classList.remove('active');

        window.edit = (id) => {
           const r = config.rules.find(x => x.id === id);
           if(!r) return;
           document.getElementById('modalTitle').innerText = '编辑规则';
           document.getElementById('ruleId').value = r.id;
           document.getElementById('method').value = r.method;
           document.getElementById('url').value = r.url;
           document.getElementById('contentType').value = r.contentType || 'application/json';
           document.getElementById('target').value = r.target || '';
           
           const tplStr = typeof r.template === 'string' ? r.template : JSON.stringify(r.template, null, 2);
           document.getElementById('mockTemplate').value = tplStr;
           document.getElementById('customJson').value = tplStr;
           
           document.getElementById('modal').classList.add('active');
           switchTab('mock');
        };

        window.save = () => {
           const id = document.getElementById('ruleId').value;
           const method = document.getElementById('method').value;
           const url = document.getElementById('url').value;
           const contentType = document.getElementById('contentType').value;
           const target = document.getElementById('target').value;
           
           if(!url) {
             vscode.postMessage({ type: 'error', message: 'API Path 不能为空' });
             return;
           }

           const isMock = document.querySelector('.tab.active').innerText.includes('Mock');
           const raw = isMock ? document.getElementById('mockTemplate').value : document.getElementById('customJson').value;

           try {
             const template = JSON.parse(raw);
             const payload = {
               id: id || null,
               method, url, contentType, template, target,
               enabled: true
             };
             vscode.postMessage({ type: 'saveRule', payload });
             closeModal();
           } catch(e) {
             vscode.postMessage({ type: 'error', message: 'JSON 格式错误: ' + e.message });
           }
        };

        window.simulate = () => {
           const isMock = document.querySelector('.tab.active').innerText.includes('Mock');
           const raw = isMock ? document.getElementById('mockTemplate').value : document.getElementById('customJson').value;
           vscode.postMessage({ type: 'simulate', template: raw });
        };

      </script>
    </body>
    </html>`;
  }
}
