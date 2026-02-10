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
        vscode.window.showInformationMessage(`规则 ${newRule.url} 已保存`);
        break;
      case 'deleteRule':
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
            // 立即保存配置
            await configService.updateConfig('mock', currentConfig);
            // 刷新界面
            this.sendConfigToWebview(webview, currentConfig);
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
      <style>
        :root {
          --primary-color: var(--vscode-textLink-activeForeground);
          --border-color: var(--vscode-panel-border);
          --bg-hover: var(--vscode-list-hoverBackground);
        }
        body { font-family: var(--vscode-font-family); padding: 0; margin: 0; color: var(--vscode-editor-foreground); background-color: var(--vscode-editor-background); display: flex; flex-direction: column; height: 100vh; }
        
        /* 顶部状态栏 */
        .header { 
          padding: 12px 16px; 
          border-bottom: 1px solid var(--border-color); 
          display: flex; justify-content: space-between; align-items: center; 
          background: var(--vscode-sideBar-background);
        }
        .status-badge { font-size: 12px; display: flex; align-items: center; gap: 6px; }
        .status-dot { width: 8px; height: 8px; border-radius: 50%; background: #666; transition: all 0.3s; }
        .status-dot.running { background: #4caf50; box-shadow: 0 0 6px rgba(76, 175, 80, 0.6); }

        /* 列表区域 - 占据剩余空间 */
        .content { flex: 1; overflow-y: auto; padding: 10px; }
        .rule-list { display: flex; flex-direction: column; gap: 8px; }

        /* 规则卡片 */
        .rule-item { 
          display: flex; align-items: center; justify-content: space-between;
          padding: 10px; 
          border: 1px solid var(--border-color); 
          border-radius: 6px; 
          background: var(--vscode-editor-background);
          transition: all 0.2s;
        }
        .rule-item:hover { border-color: var(--primary-color); background: var(--bg-hover); }
        .rule-item.disabled { opacity: 0.6; filter: grayscale(0.8); }
        .rule-item.disabled:hover { opacity: 0.9; filter: grayscale(0); }

        .rule-info { flex: 1; min-width: 0; margin-right: 10px; }
        .rule-method { 
          display: inline-block; font-size: 10px; font-weight: bold; padding: 2px 6px; 
          border-radius: 3px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); 
          margin-bottom: 4px;
        }
        .rule-method.GET { background: #3498db; color: #fff; }
        .rule-method.POST { background: #2ecc71; color: #fff; }
        .rule-method.PUT { background: #f39c12; color: #fff; }
        .rule-method.DELETE { background: #e74c3c; color: #fff; }

        .rule-url { 
          font-size: 13px; font-family: monospace; 
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis; 
          color: var(--vscode-editor-foreground);
        }

        /* 每一行的控制区 */
        .rule-actions { display: flex; align-items: center; gap: 12px; }

        /* iOS 风格开关 Switch */
        .switch { position: relative; display: inline-block; width: 36px; height: 20px; }
        .switch input { opacity: 0; width: 0; height: 0; }
        .slider { position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0; background-color: #ccc; transition: .4s; border-radius: 20px; }
        .slider:before { position: absolute; content: ""; height: 16px; width: 16px; left: 2px; bottom: 2px; background-color: white; transition: .4s; border-radius: 50%; }
        input:checked + .slider { background-color: #2196F3; }
        input:checked + .slider:before { transform: translateX(16px); }

        /* 操作按钮 */
        .btn-icon { background: none; border: none; cursor: pointer; color: var(--vscode-icon-foreground); padding: 4px; opacity: 0.7; }
        .btn-icon:hover { opacity: 1; color: var(--primary-color); }
        .btn-icon.delete:hover { color: var(--vscode-errorForeground); }

        /* 底部操作栏 */
        .footer { padding: 10px; border-top: 1px solid var(--border-color); background: var(--vscode-sideBar-background); }
        .primary-btn { width: 100%; background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 8px; cursor: pointer; border-radius: 2px; }
        .primary-btn:hover { background: var(--vscode-button-hoverBackground); }
        .danger-btn { background: var(--vscode-errorForeground); color: white; border: none; padding: 4px 12px; cursor: pointer; border-radius: 2px; }

        /* 弹窗样式 */
        .modal { display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 100; justify-content: center; align-items: center; }
        .modal.active { display: flex; }
        .modal-box { background: var(--vscode-editor-background); width: 90%; max-width: 600px; max-height: 90vh; border: 1px solid var(--vscode-focusBorder); display: flex; flex-direction: column; box-shadow: 0 4px 20px rgba(0,0,0,0.5); border-radius: 4px; }
        .modal-header { padding: 12px 16px; font-weight: bold; border-bottom: 1px solid var(--border-color); }
        .modal-body { padding: 16px; overflow-y: auto; flex: 1; }
        .modal-footer { padding: 12px 16px; border-top: 1px solid var(--border-color); text-align: right; display: flex; justify-content: flex-end; gap: 10px; }
        
        .form-group { margin-bottom: 12px; }
        .form-label { display: block; margin-bottom: 4px; font-size: 12px; opacity: 0.8; }
        input[type="text"], select, textarea { 
          width: 100%; background: var(--vscode-input-background); color: var(--vscode-input-foreground); 
          border: 1px solid var(--vscode-input-border); padding: 6px; box-sizing: border-box; outline: none;
        }
        input:focus, select:focus, textarea:focus { border-color: var(--vscode-focusBorder); }
        
        /* 预览区 */
        #previewBox { display: none; margin-top: 10px; padding: 10px; background: rgba(0,0,0,0.2); font-family: monospace; max-height: 150px; overflow: auto; border-left: 3px solid var(--primary-color); white-space: pre-wrap; }
      </style>
    </head>
    <body>
      
      <div class="header">
        <div class="status-badge">
          <div id="statusDot" class="status-dot"></div>
          <div id="statusText">已停止</div>
        </div>
        <button id="toggleServerBtn" class="primary-btn" style="width: auto; font-size: 12px; padding: 4px 12px;">启动服务</button>
      </div>

      <div class="content">
        <div id="ruleList" class="rule-list"></div>
      </div>

      <div class="footer">
        <button onclick="openEditModal()" class="primary-btn">+ 新增接口拦截</button>
      </div>

      <div id="editModal" class="modal">
        <div class="modal-box">
          <div class="modal-header">编辑规则</div>
          <div class="modal-body">
            <input type="hidden" id="editId">
            <div class="form-group">
              <label class="form-label">Method</label>
              <select id="editMethod">
                <option value="GET">GET</option>
                <option value="POST">POST</option>
                <option value="PUT">PUT</option>
                <option value="DELETE">DELETE</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">URL Path (e.g. /api/user)</label>
              <input type="text" id="editUrl" placeholder="/api/...">
            </div>
            
            <div class="form-group">
              <label class="form-label">Mock 模板 (JSON)</label>
              <textarea id="editTemplate" style="height: 150px; font-family: monospace;" placeholder='{ "code": 0, "data": { "name": "@cname" } }'></textarea>
            </div>

            <button onclick="simulateMock()" class="primary-btn" style="background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground);">生成数据预览</button>
            <div id="previewBox"></div>

          </div>
          <div class="modal-footer">
            <button onclick="closeEditModal()" class="danger-btn" style="background: transparent; color: var(--vscode-foreground); border: 1px solid var(--border-color);">取消</button>
            <button onclick="saveRule()" class="primary-btn" style="width: auto;">保存</button>
          </div>
        </div>
      </div>

      <script>
        const vscode = acquireVsCodeApi();
        let config = { rules: [] };
        let isRunning = false;

        // 监听消息
        window.addEventListener('message', event => {
          const msg = event.data;
          if (msg.type === 'config') {
            config = msg.data || { rules: [] };
            renderList();
          }
          if (msg.type === 'status') {
            isRunning = msg.running;
            updateStatusUI(msg.running, msg.port);
          }
          if (msg.type === 'simulateResult') {
            const box = document.getElementById('previewBox');
            box.style.display = 'block';
            if (msg.error) {
              box.innerText = 'Error: ' + msg.error;
              box.style.color = 'var(--vscode-errorForeground)';
            } else {
              box.innerText = JSON.stringify(msg.result, null, 2);
              box.style.color = 'var(--vscode-editor-foreground)';
            }
          }
        });

        // 初始化请求
        vscode.postMessage({ type: 'refresh' });

        // 更新服务状态 UI
        function updateStatusUI(running, port) {
          const dot = document.getElementById('statusDot');
          const text = document.getElementById('statusText');
          const btn = document.getElementById('toggleServerBtn');

          if (running) {
            dot.className = 'status-dot running';
            text.innerText = '运行中: ' + port;
            btn.innerText = '停止服务';
            btn.style.background = 'var(--vscode-errorForeground)';
          } else {
            dot.className = 'status-dot';
            text.innerText = '已停止';
            btn.innerText = '启动服务';
            btn.style.background = ''; // reset
          }
        }

        document.getElementById('toggleServerBtn').onclick = () => {
          vscode.postMessage({ type: 'toggleServer', value: !isRunning });
        };

        // 渲染列表核心逻辑
        function renderList() {
          const container = document.getElementById('ruleList');
          container.innerHTML = '';

          if (!config.rules || config.rules.length === 0) {
            container.innerHTML = '<div style="text-align:center; padding: 20px; opacity: 0.5;">暂无规则</div>';
            return;
          }

          config.rules.forEach(rule => {
            const div = document.createElement('div');
            // 如果未启用，添加 disabled 类名实现置灰效果
            div.className = \`rule-item \${rule.enabled ? '' : 'disabled'}\`;
            
            div.innerHTML = \`
              <div class="rule-info">
                <span class="rule-method \${rule.method}">\${rule.method}</span>
                <div class="rule-url" title="\${rule.url}">\${rule.url}</div>
              </div>
              <div class="rule-actions">
                <label class="switch" title="开启/关闭此接口拦截">
                  <input type="checkbox" \${rule.enabled ? 'checked' : ''} onchange="toggleRule('\${rule.id}', this.checked)">
                  <span class="slider"></span>
                </label>
                
                <button class="btn-icon" onclick="editRule('\${rule.id}')" title="编辑">✎</button>
                <button class="btn-icon delete" onclick="deleteRule('\${rule.id}')" title="删除">×</button>
              </div>
            \`;
            container.appendChild(div);
          });
        }

        // 交互函数
        window.toggleRule = (id, checked) => {
          vscode.postMessage({ type: 'toggleRule', id, enabled: checked });
        };

        window.deleteRule = (id) => {
          if (confirm('确认删除此规则？')) {
            vscode.postMessage({ type: 'deleteRule', id });
          }
        };

        // 模态框逻辑
        const modal = document.getElementById('editModal');
        
        window.openEditModal = () => {
          document.getElementById('editId').value = '';
          document.getElementById('editUrl').value = '';
          document.getElementById('editMethod').value = 'GET';
          document.getElementById('editTemplate').value = '{\\n  "code": 0,\\n  "data": {\\n    "list|5": [{ "id|+1": 1, "name": "@cname" }]\\n  }\\n}';
          document.getElementById('previewBox').style.display = 'none';
          modal.classList.add('active');
        };

        window.editRule = (id) => {
          const rule = config.rules.find(r => r.id === id);
          if (!rule) return;
          document.getElementById('editId').value = rule.id;
          document.getElementById('editUrl').value = rule.url;
          document.getElementById('editMethod').value = rule.method;
          document.getElementById('editTemplate').value = typeof rule.template === 'string' ? rule.template : JSON.stringify(rule.template, null, 2);
          document.getElementById('previewBox').style.display = 'none';
          modal.classList.add('active');
        };

        window.closeEditModal = () => {
          modal.classList.remove('active');
        };

        window.saveRule = () => {
          try {
            const templateStr = document.getElementById('editTemplate').value;
            const payload = {
              id: document.getElementById('editId').value || null,
              method: document.getElementById('editMethod').value,
              url: document.getElementById('editUrl').value,
              contentType: 'application/json',
              template: JSON.parse(templateStr),
              enabled: true // 新增或保存时默认开启，或者你需要保持原有状态
            };
            if (!payload.url) return alert('URL 不能为空');
            vscode.postMessage({ type: 'saveRule', payload });
            closeEditModal();
          } catch (e) {
            alert('JSON 格式错误: ' + e.message);
          }
        };

        window.simulateMock = () => {
          vscode.postMessage({ type: 'simulate', template: document.getElementById('editTemplate').value });
        };
      </script>
    </body>
    </html>`;
  }
}
