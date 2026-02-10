import * as vscode from 'vscode';
import * as Mock from 'mockjs';
import { nanoid } from 'nanoid';
import { ConfigurationService } from '../services/ConfigurationService';
import { MockServerFeature } from '../features/MockServerFeature';

// 定义配置项接口，方便类型提示
interface IMockConfigItem {
  port: number;
  target: string;
  rules: any[];
}

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

    // 确保 currentConfig 是数组
    let currentConfig: IMockConfigItem[] = [];
    const rawConfig = configService.config.mock;

    if (Array.isArray(rawConfig)) {
      currentConfig = rawConfig;
    } else if (rawConfig && typeof rawConfig === 'object') {
      // 兼容旧的单对象格式，转为数组
      currentConfig = [rawConfig as any];
    }

    switch (data.type) {
      case 'error':
        vscode.window.showErrorMessage(data.message);
        break;

      case 'refresh':
        this.sendConfigToWebview(webview, currentConfig);
        this._mockFeature.notifyStatusToWebview(webview);
        break;

      case 'toggleServer':
        // 这里的逻辑可能需要调整：是启动所有 Target 的服务，还是只启动选中的？
        // 目前简化为：启动 MockFeature，由它去处理多端口或默认端口
        if (data.value) {
          await this._mockFeature.startServer();
        } else {
          this._mockFeature.stopServer();
        }
        break;

      case 'saveRule':
        const newRule = data.payload;
        if (!newRule.id) newRule.id = nanoid();

        // 1. 确定归属的 Target 组
        // 如果用户没填 target，默认归到第一个组，或者创建一个默认组
        const targetUrl = newRule.target || 'default';

        let targetGroup = currentConfig.find((c) => c.target === targetUrl);

        if (!targetGroup) {
          // 如果是全新的 Target，创建一个新组
          // 注意：Port 分配是个问题，这里暂时默认都用 3000，或者需要用户输入 Port
          // 简单起见，如果通过 UI 新增，默认复用第一个配置的 Port，或者默认 3000
          const defaultPort = currentConfig.length > 0 ? currentConfig[0].port : 3000;
          targetGroup = {
            port: defaultPort,
            target: targetUrl,
            rules: [],
          };
          currentConfig.push(targetGroup);
        }

        // 2. 在组内更新规则
        if (!targetGroup.rules) targetGroup.rules = [];
        const existingIdx = targetGroup.rules.findIndex((r: any) => r.id === newRule.id);

        if (existingIdx > -1) {
          targetGroup.rules[existingIdx] = newRule;
        } else {
          targetGroup.rules.push(newRule);
        }

        await configService.updateConfig('mock', currentConfig);
        this.sendConfigToWebview(webview, currentConfig);

        if (newRule.enabled) this._mockFeature.startServer();
        vscode.window.showInformationMessage(`规则 ${newRule.url} 已保存`);
        break;

      case 'deleteRule':
        const confirm = await vscode.window.showWarningMessage(`确定删除此规则吗？`, { modal: true }, '删除');
        if (confirm !== '删除') return;

        // 遍历所有组查找并删除
        let deleted = false;
        currentConfig.forEach((group) => {
          if (group.rules) {
            const initialLen = group.rules.length;
            group.rules = group.rules.filter((r: any) => r.id !== data.id);
            if (group.rules.length !== initialLen) deleted = true;
          }
        });

        if (deleted) {
          // 如果某个组空了，是否要删除该组？视需求而定，这里暂时保留组
          await configService.updateConfig('mock', currentConfig);
          this.sendConfigToWebview(webview, currentConfig);
        }
        break;

      case 'toggleRule':
        // 遍历所有组查找并更新
        let toggled = false;
        currentConfig.forEach((group) => {
          const rule = group.rules?.find((r: any) => r.id === data.id);
          if (rule) {
            rule.enabled = data.enabled;
            toggled = true;
          }
        });

        if (toggled) {
          await configService.updateConfig('mock', currentConfig);
          this.sendConfigToWebview(webview, currentConfig);
          if (data.enabled) this._mockFeature.startServer();
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
          --input-bg: var(--vscode-input-background);
          --input-fg: var(--vscode-input-foreground);
          --input-border: var(--vscode-input-border);
        }
        body { font-family: var(--vscode-font-family); padding: 0; margin: 0; color: var(--text); background: var(--bg); display: flex; flex-direction: column; height: 100vh; font-size: 13px; }
        
        .header { padding: 12px 16px; border-bottom: 1px solid var(--border); background: var(--vscode-sideBar-background); display: flex; justify-content: space-between; align-items: center; }
        .header-title { font-weight: bold; font-size: 14px; display: flex; align-items: center; gap: 8px; }
        
        .server-status { font-size: 12px; padding: 4px 10px; border-radius: 20px; background: #444; color: #ccc; cursor: pointer; user-select: none; display: flex; align-items: center; gap: 6px; transition: all 0.2s; border: 1px solid transparent; }
        .server-status:hover { filter: brightness(1.1); }
        .server-status.on { background: rgba(76, 175, 80, 0.15); color: var(--success); border-color: var(--success); }
        .server-status i { font-size: 8px; }

        .content { flex: 1; overflow-y: auto; padding: 12px; }
        .rule-list { display: flex; flex-direction: column; gap: 10px; }
        .empty-tip { text-align: center; padding: 40px; opacity: 0.5; color: var(--text-sub); }

        /* Group 样式 */
        .group-container { margin-bottom: 20px; }
        .group-header { 
            font-size: 12px; font-weight: bold; color: var(--text-sub); margin-bottom: 8px; 
            padding-bottom: 4px; border-bottom: 1px dashed var(--border); 
            display: flex; justify-content: space-between; align-items: center;
        }
        .group-tag { background: var(--bg-hover); padding: 2px 6px; border-radius: 4px; font-family: monospace; }

        .card { background: var(--vscode-sideBar-background); border: 1px solid var(--border); border-radius: 6px; padding: 12px; display: flex; align-items: center; gap: 12px; transition: all 0.2s; position: relative; overflow: hidden; margin-bottom: 8px; }
        .card:hover { border-color: var(--primary); }
        .card.disabled { opacity: 0.6; filter: grayscale(0.8); }
        .card::before { content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 4px; background: transparent; transition: 0.2s; }
        .card.active::before { background: var(--success); }

        .card-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 6px; }
        .card-row-1 { display: flex; align-items: center; gap: 8px; }
        .card-row-2 { display: flex; align-items: center; gap: 10px; font-size: 11px; color: var(--text-sub); }

        .tag { font-size: 10px; font-weight: bold; padding: 2px 6px; border-radius: 3px; }
        .tag.GET { background: rgba(52, 152, 219, 0.1); color: #3498db; }
        .tag.POST { background: rgba(46, 204, 113, 0.1); color: #2ecc71; }
        .tag.PUT { background: rgba(243, 156, 18, 0.1); color: #f39c12; }
        .tag.DELETE { background: rgba(231, 76, 60, 0.1); color: #e74c3c; }
        
        .url-text { font-family: 'Consolas', monospace; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        
        .actions { display: flex; align-items: center; gap: 8px; }
        .icon-btn { background: transparent; border: none; color: var(--text-sub); cursor: pointer; padding: 6px; border-radius: 4px; transition: 0.2s; }
        .icon-btn:hover { background: var(--bg-hover); color: var(--text); }
        .icon-btn.del:hover { color: var(--error); background: rgba(255,0,0,0.1); }

        .switch { position: relative; display: inline-block; width: 32px; height: 18px; }
        .switch input { opacity: 0; width: 0; height: 0; }
        .slider { position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0; background-color: #555; transition: .3s; border-radius: 18px; }
        .slider:before { position: absolute; content: ""; height: 14px; width: 14px; left: 2px; bottom: 2px; background-color: white; transition: .3s; border-radius: 50%; }
        input:checked + .slider { background-color: var(--success); }
        input:checked + .slider:before { transform: translateX(14px); }

        .footer { padding: 12px; border-top: 1px solid var(--border); background: var(--vscode-sideBar-background); }
        .add-btn { width: 100%; padding: 8px; background: var(--primary); color: white; border: none; border-radius: 4px; cursor: pointer; display: flex; justify-content: center; align-items: center; gap: 8px; }
        .add-btn:hover { opacity: 0.9; }

        /* Modal Styles (保持不变) */
        .modal { display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.6); z-index: 100; justify-content: center; align-items: center; }
        .modal.active { display: flex; }
        .modal-box { background: var(--bg); width: 650px; max-width: 90%; max-height: 90vh; border: 1px solid var(--border); border-radius: 8px; display: flex; flex-direction: column; box-shadow: 0 10px 30px rgba(0,0,0,0.5); }
        .modal-header { padding: 15px 20px; border-bottom: 1px solid var(--border); font-weight: bold; display: flex; justify-content: space-between; align-items: center; font-size: 14px; }
        .modal-body { padding: 20px; overflow-y: auto; flex: 1; }
        .modal-footer { padding: 15px 20px; border-top: 1px solid var(--border); display: flex; justify-content: flex-end; gap: 10px; background: var(--vscode-sideBar-background); border-radius: 0 0 8px 8px; }
        .form-row { display: flex; gap: 15px; margin-bottom: 15px; }
        .form-group { flex: 1; display: flex; flex-direction: column; gap: 6px; }
        .form-label { font-size: 12px; font-weight: 600; color: var(--text); }
        input, select, textarea { background: var(--input-bg); color: var(--input-fg); border: 1px solid var(--input-border); padding: 8px; border-radius: 4px; outline: none; font-family: inherit; font-size: 13px; }
        input:focus, select:focus, textarea:focus { border-color: var(--primary); }
        
        /* Tabs */
        .tabs { display: flex; margin-bottom: 0; border-bottom: 1px solid var(--border); }
        .tab { padding: 8px 16px; cursor: pointer; font-size: 12px; border-bottom: 2px solid transparent; opacity: 0.6; transition: 0.2s; display: flex; align-items: center; gap: 6px; }
        .tab:hover { opacity: 1; background: var(--bg-hover); }
        .tab.active { opacity: 1; border-bottom-color: var(--primary); color: var(--primary); font-weight: bold; }
        .tab-content { border: 1px solid var(--border); border-top: none; padding: 15px; background: var(--vscode-sideBar-background); border-radius: 0 0 4px 4px; }
        .tab-pane { display: none; }
        .tab-pane.active { display: block; }

        .btn-sec { background: transparent; border: 1px solid var(--border); color: var(--text); padding: 6px 14px; border-radius: 4px; cursor: pointer; }
        .btn-pri { background: var(--primary); color: white; border: none; padding: 6px 14px; border-radius: 4px; cursor: pointer; }
        .btn-sec:hover { background: var(--bg-hover); }
        .btn-pri:hover { opacity: 0.9; }
        
        #previewArea { display: none; margin-top: 15px; }
        #previewBox { background: rgba(0,0,0,0.3); padding: 10px; border-radius: 4px; font-family: monospace; font-size: 12px; white-space: pre-wrap; max-height: 200px; overflow: auto; border: 1px solid var(--border); }
      </style>
    </head>
    <body>
      
      <div class="header">
        <div class="header-title"><i class="fa-solid fa-server"></i> Mock Manager</div>
        <div id="serverStatusBtn" class="server-status" title="点击开启/停止服务">
           <i class="fa-solid fa-circle"></i> <span id="statusText">Offline</span>
        </div>
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
            <i class="fa-solid fa-xmark" onclick="closeModal()" style="cursor: pointer; opacity: 0.6;"></i>
          </div>
          <div class="modal-body">
            <input type="hidden" id="ruleId">
            
            <div class="form-row">
              <div class="form-group" style="flex: 0 0 110px;">
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
                <input type="text" id="url" placeholder="e.g. /xy/app/theme/list">
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
                 <label class="form-label">Target (代理目标)</label>
                 <input type="text" id="target" placeholder="为空则使用全局配置">
              </div>
            </div>

            <label class="form-label">Response Configuration</label>
            <div class="tabs">
              <div id="tab-mock" class="tab active" onclick="switchTab('mock')">
                <i class="fa-solid fa-wand-magic-sparkles"></i> Mock 模板
              </div>
              <div id="tab-custom" class="tab" onclick="switchTab('custom')">
                <i class="fa-solid fa-code"></i> 自定义 JSON
              </div>
            </div>

            <div class="tab-content">
                <div id="pane-mock" class="tab-pane active">
                    <textarea id="mockTemplate" style="height: 180px; font-family: monospace;" 
                        placeholder='{ "code": 0, "data": { "list|10": [{"id|+1":1, "name":"@cname"}] } }'></textarea>
                    <div style="margin-top: 6px; font-size: 11px; opacity: 0.6; display:flex; justify-content:space-between;">
                        <span>支持 Mock.js 语法 (如 @cname, @image)</span>
                    </div>
                </div>
                
                <div id="pane-custom" class="tab-pane">
                    <textarea id="customJson" style="height: 180px; font-family: monospace;" 
                        placeholder='{ "code": 200, "data": { "fixed": "value" } }'></textarea>
                    <div style="margin-top: 6px; font-size: 11px; opacity: 0.6;">
                        <span>请输入标准 JSON 数据 (静态返回)</span>
                    </div>
                </div>
            </div>

            <div id="previewArea">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px;">
                    <label class="form-label">预览结果</label>
                    <button id="btn-simulate" onclick="simulate()" class="btn-sec" style="font-size: 11px; padding: 2px 8px;">
                        <i class="fa-solid fa-play"></i> 生成预览
                    </button>
                </div>
                <div id="previewBox"></div>
            </div>

          </div>
          <div class="modal-footer">
            <button onclick="closeModal()" class="btn-sec">取消</button>
            <button onclick="save()" class="btn-pri">保存</button>
          </div>
        </div>
      </div>

      <script>
        const vscode = acquireVsCodeApi();
        let config = []; // 默认为数组
        let isRunning = false;

        window.addEventListener('message', e => {
           const msg = e.data;
           if(msg.type === 'config') {
             // 确保 config 是数组
             config = Array.isArray(msg.data) ? msg.data : (msg.data ? [msg.data] : []);
             render();
           }
           if(msg.type === 'status') {
             isRunning = msg.running;
             const btn = document.getElementById('serverStatusBtn');
             const txt = document.getElementById('statusText');
             if(msg.running) {
               btn.className = 'server-status on';
               txt.innerText = 'Running: ' + msg.port;
             } else {
               btn.className = 'server-status';
               txt.innerText = 'Offline';
             }
           }
           if(msg.type === 'simulateResult') {
             const box = document.getElementById('previewBox');
             box.innerText = msg.error ? 'Error: ' + msg.error : JSON.stringify(msg.result, null, 2);
             box.style.color = msg.error ? 'var(--error)' : 'var(--text)';
           }
        });
        
        vscode.postMessage({ type: 'refresh' });

        document.getElementById('serverStatusBtn').onclick = () => {
            vscode.postMessage({ type: 'toggleServer', value: !isRunning });
        };

        window.switchTab = (mode) => {
            document.querySelectorAll('.tab').forEach(el => el.classList.remove('active'));
            document.querySelectorAll('.tab-pane').forEach(el => el.classList.remove('active'));
            
            document.getElementById('tab-' + mode).classList.add('active');
            document.getElementById('pane-' + mode).classList.add('active');

            const previewArea = document.getElementById('previewArea');
            if (mode === 'mock') {
                previewArea.style.display = 'block';
                document.getElementById('btn-simulate').style.display = 'inline-block';
                document.getElementById('previewBox').innerText = ''; 
            } else {
                previewArea.style.display = 'none';
            }
        };

        window.openModal = () => {
           document.getElementById('modalTitle').innerText = '新增规则';
           document.getElementById('ruleId').value = '';
           document.getElementById('method').value = 'GET';
           document.getElementById('url').value = '';
           document.getElementById('contentType').value = 'application/json';
           document.getElementById('target').value = '';
           
           document.getElementById('mockTemplate').value = '{\\n  "code": 0,\\n  "data": { "list|5": [{"id|+1":1}] }\\n}';
           document.getElementById('customJson').value = '{\\n  "code": 200,\\n  "data": {}\\n}';
           
           document.getElementById('modal').classList.add('active');
           switchTab('mock'); 
        };

        // 编辑逻辑需要遍历所有组来查找
        window.edit = (id) => {
           let foundRule = null;
           let foundGroup = null;
           
           for (const group of config) {
               const r = group.rules.find(x => x.id === id);
               if (r) {
                   foundRule = r;
                   foundGroup = group;
                   break;
               }
           }
           
           if(!foundRule) return;
           
           document.getElementById('modalTitle').innerText = '编辑规则';
           document.getElementById('ruleId').value = foundRule.id;
           document.getElementById('method').value = foundRule.method;
           document.getElementById('url').value = foundRule.url;
           document.getElementById('contentType').value = foundRule.contentType || 'application/json';
           // 使用规则自己的 target，如果没有则回填组的 target 作为参考（这里逻辑可根据需求调整）
           document.getElementById('target').value = foundGroup.target || '';

           if (foundRule.data) {
               document.getElementById('customJson').value = JSON.stringify(foundRule.data, null, 2);
               document.getElementById('mockTemplate').value = '{}'; 
               switchTab('custom');
           } else {
               const tpl = foundRule.template || {};
               document.getElementById('mockTemplate').value = typeof tpl === 'string' ? tpl : JSON.stringify(tpl, null, 2);
               document.getElementById('customJson').value = '{}';
               switchTab('mock');
           }
           
           document.getElementById('modal').classList.add('active');
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

           const isMockMode = document.getElementById('tab-mock').classList.contains('active');
           let template = undefined;
           let staticData = undefined;

           try {
               if (isMockMode) {
                   const raw = document.getElementById('mockTemplate').value;
                   template = raw ? JSON.parse(raw) : {};
               } else {
                   const raw = document.getElementById('customJson').value;
                   staticData = raw ? JSON.parse(raw) : {};
               }

               const payload = {
                   id: id || null,
                   method, url, contentType, target, enabled: true,
                   template: template,
                   data: staticData
               };

               vscode.postMessage({ type: 'saveRule', payload });
               closeModal();
           } catch(e) {
               vscode.postMessage({ type: 'error', message: 'JSON 格式错误: ' + e.message });
           }
        };

        window.closeModal = () => document.getElementById('modal').classList.remove('active');
        
        window.simulate = () => {
           const raw = document.getElementById('mockTemplate').value;
           vscode.postMessage({ type: 'simulate', template: raw });
        };

        window.toggle = (id, val) => vscode.postMessage({ type: 'toggleRule', id, enabled: val });
        window.del = (id) => vscode.postMessage({ type: 'deleteRule', id });

        // --- 渲染列表：支持多组渲染 ---
        function render() {
          const list = document.getElementById('ruleList');
          list.innerHTML = '';
          
          if(!config || config.length === 0) {
            list.innerHTML = \`<div class="empty-tip"><i class="fa-solid fa-inbox fa-2x"></i><div style="margin-top:10px">暂无规则</div></div>\`;
            return;
          }

          // 遍历每个配置组
          config.forEach(group => {
            const groupDiv = document.createElement('div');
            groupDiv.className = 'group-container';
            
            // 组标题
            const header = document.createElement('div');
            header.className = 'group-header';
            header.innerHTML = \`<span>Target: \${group.target || 'Default'}</span> <span class="group-tag">Port: \${group.port}</span>\`;
            groupDiv.appendChild(header);

            // 规则列表
            if (!group.rules || group.rules.length === 0) {
                const empty = document.createElement('div');
                empty.style.opacity = '0.5';
                empty.style.fontSize = '12px';
                empty.innerText = '此组暂无规则';
                groupDiv.appendChild(empty);
            } else {
                group.rules.forEach(item => {
                    const isActive = item.enabled;
                    const typeLabel = item.data ? 'JSON' : 'Mock';
                    
                    const card = document.createElement('div');
                    card.className = 'card ' + (isActive ? 'active' : 'disabled');
                    card.innerHTML = \`
                      <div class="card-main">
                        <div class="card-row-1">
                           <span class="tag \${item.method}">\${item.method}</span>
                           <span class="url-text" title="\${item.url}">\${item.url}</span>
                        </div>
                        <div class="card-row-2">
                           <span>\${item.contentType || 'json'}</span>
                           <span style="opacity:0.3">|</span>
                           <span style="font-weight:bold; font-size:10px; opacity:0.8">\${typeLabel}</span>
                        </div>
                      </div>
                      <div class="actions">
                         <label class="switch" title="\${isActive ? '点击关闭' : '点击开启'}">
                           <input type="checkbox" \${isActive ? 'checked' : ''} onchange="toggle('\${item.id}', this.checked)">
                           <span class="slider"></span>
                         </label>
                         <button class="icon-btn" onclick="edit('\${item.id}')"><i class="fa-solid fa-pen"></i></button>
                         <button class="icon-btn del" onclick="del('\${item.id}')"><i class="fa-solid fa-trash"></i></button>
                      </div>
                    \`;
                    groupDiv.appendChild(card);
                });
            }
            list.appendChild(groupDiv);
          });
        }
      </script>
    </body>
    </html>`;
  }
}
