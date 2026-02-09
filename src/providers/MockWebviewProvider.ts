import * as vscode from 'vscode';
import * as Mock from 'mockjs';
import { nanoid } from 'nanoid';
import { ConfigurationService } from '../services/ConfigurationService';
import { MockServerFeature } from '../features/MockServerFeature';

export class MockWebviewProvider implements vscode.WebviewViewProvider {
  // 保存侧边栏的 view 实例
  private _view?: vscode.WebviewView;

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly _mockFeature: MockServerFeature,
  ) {}

  public resolveWebviewView(webviewView: vscode.WebviewView, context: vscode.WebviewViewResolveContext, _token: vscode.CancellationToken) {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    };

    // 设置 HTML
    webviewView.webview.html = this.getHtmlForWebview(webviewView.webview);

    // 监听消息 -> 调用公共处理函数
    webviewView.webview.onDidReceiveMessage(async (data) => {
      await this.handleMessage(data, webviewView.webview);
    });
  }

  /**
   * [新增] 公共消息处理逻辑
   * 供侧边栏和全屏面板共同调用
   */
  public async handleMessage(data: any, webview: vscode.Webview) {
    const configService = ConfigurationService.getInstance();
    // 重新读取配置
    await configService.loadConfig();
    const currentConfig = configService.config.mock || { port: 3000, target: '', rules: [] };

    switch (data.type) {
      case 'refresh':
        this.sendConfigToWebview(webview, currentConfig);
        // 同时发送当前服务状态
        // 这里的状态获取逻辑可能需要 MockServerFeature 提供一个 getter，或者简单传 false
        // 暂时简单处理，或者你可以让 MockServerFeature 暴露 public isRunning 属性
        // webview.postMessage({ type: 'status', running: false });
        break;

      case 'toggleServer':
        if (data.value) {
          await this._mockFeature.startServer();
        } else {
          this._mockFeature.stopServer();
        }
        // 状态更新通常由 ServerFeature 回调 updateStatus 来统一处理
        break;

      case 'saveRule':
        const newRule = data.payload;
        if (!newRule.id) newRule.id = nanoid();

        if (!currentConfig.rules) currentConfig.rules = [];

        const index = currentConfig.rules.findIndex((r: any) => r.id === newRule.id);
        if (index > -1) {
          currentConfig.rules[index] = newRule;
        } else {
          currentConfig.rules.push(newRule);
        }

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
            await configService.updateConfig('mock', currentConfig);
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

  /**
   * 用于 MockServerFeature 通知侧边栏状态变更
   */
  public updateStatus(running: boolean, port?: number) {
    if (this._view) {
      this._view.webview.postMessage({ type: 'status', running, port });
    }
  }

  /**
   * 发送配置给前端
   */
  private sendConfigToWebview(webview: vscode.Webview, config: any) {
    webview.postMessage({ type: 'config', data: config });
  }

  /**
   * [修改] 改为 public 以便 Feature 调用
   */
  public getHtmlForWebview(webview: vscode.Webview) {
    // 这里放回你之前的 HTML 字符串代码
    // 为了节省篇幅，这里用 ... 代替，请把之前的 HTML 完整拷贝回来
    return `<!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Mock Manager</title>
      <style>
        body { font-family: var(--vscode-font-family); padding: 10px; color: var(--vscode-editor-foreground); }
        button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 5px 10px; cursor: pointer; }
        button:hover { background: var(--vscode-button-hoverBackground); }
        input, select, textarea { background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); padding: 4px; margin-bottom: 8px; }
        .rule-item { display: flex; align-items: center; border-bottom: 1px solid var(--vscode-panel-border); padding: 8px 0; gap: 10px; }
        .method { font-weight: bold; width: 60px; font-size: 12px; }
        .url { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .actions { display: flex; gap: 5px; }
        .modal { display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 99; justify-content: center; align-items: center; }
        .modal-content { background: var(--vscode-editor-background); padding: 20px; width: 80%; max-width: 600px; border: 1px solid var(--vscode-focusBorder); box-shadow: 0 4px 6px rgba(0,0,0,0.1); max-height: 90vh; overflow-y: auto; }
        .form-group { margin-bottom: 10px; }
        .form-group label { display: block; margin-bottom: 4px; font-weight: bold; }
        textarea { width: 100%; height: 150px; font-family: monospace; }
        .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; border-bottom: 1px solid var(--vscode-panel-border); padding-bottom: 10px; }
        #previewArea { margin-top: 10px; padding: 10px; background: var(--vscode-textBlockQuote-background); border-left: 3px solid var(--vscode-textLink-activeForeground); white-space: pre-wrap; word-break: break-all; font-family: monospace; display: none; }
        .status-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #ccc; margin-right: 5px; }
        .status-dot.on { background: #4caf50; }
      </style>
    </head>
    <body>
      <div id="app">
        <div class="header">
          <div style="display:flex; align-items:center;">
            <h3>Mock Server</h3>
            <span id="statusIndicator" class="status-dot" style="margin-left:10px;"></span>
            <span id="statusText" style="font-size: 12px;">已停止</span>
          </div>
          <div>
             <button id="startBtn">启动</button>
             <button id="stopBtn" style="display:none; background: var(--vscode-errorForeground);">停止</button>
          </div>
        </div>

        <div id="ruleList">
           </div>

        <button id="addBtn" style="width: 100%; margin-top: 15px; padding: 8px;">+ 新增接口拦截</button>

        <div id="editorModal" class="modal">
          <div class="modal-content">
            <h3 id="modalTitle">编辑规则</h3>
            <input type="hidden" id="editId">
            
            <div class="form-group">
              <label>Method</label>
              <select id="editMethod" style="width: 100%;">
                <option value="GET">GET</option>
                <option value="POST">POST</option>
                <option value="PUT">PUT</option>
                <option value="DELETE">DELETE</option>
                <option value="PATCH">PATCH</option>
              </select>
            </div>

            <div class="form-group">
              <label>URL (支持部分匹配)</label>
              <input type="text" id="editUrl" placeholder="e.g. /api/user/info" style="width: 100%;">
            </div>

            <div class="form-group">
              <label>Content-Type</label>
              <input type="text" id="editContentType" value="application/json" style="width: 100%;">
            </div>

            <div class="form-group">
              <label>Mock.js 模板 (JSON)</label>
              <textarea id="editTemplate" placeholder='{ "list|1-5": [{ "id|+1": 1 }] }'></textarea>
            </div>

            <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 15px;">
              <button id="simulateBtn" style="background: var(--vscode-textLink-foreground);">模拟预览</button>
              <div style="display: flex; gap: 10px;">
                <button id="cancelBtn" style="background: transparent; border: 1px solid var(--vscode-button-background);">取消</button>
                <button id="saveBtn">保存规则</button>
              </div>
            </div>

            <div id="previewArea"></div>
          </div>
        </div>
      </div>

      <script>
        const vscode = acquireVsCodeApi();
        let config = { rules: [] };

        // DOM Elements
        const ruleListEl = document.getElementById('ruleList');
        const modal = document.getElementById('editorModal');
        const previewArea = document.getElementById('previewArea');
        const statusText = document.getElementById('statusText');
        const statusDot = document.getElementById('statusIndicator');
        const startBtn = document.getElementById('startBtn');
        const stopBtn = document.getElementById('stopBtn');

        // Initial Load
        window.addEventListener('message', event => {
          const message = event.data;
          switch (message.type) {
            case 'config':
              config = message.data || { rules: [] };
              renderList();
              break;
            case 'status':
              updateStatusUI(message.running, message.port);
              break;
            case 'simulateResult':
              if (message.error) {
                previewArea.style.display = 'block';
                previewArea.style.color = 'red';
                previewArea.innerText = '错误: ' + message.error;
              } else {
                previewArea.style.display = 'block';
                previewArea.style.color = 'var(--vscode-editor-foreground)';
                previewArea.innerText = JSON.stringify(message.result, null, 2);
              }
              break;
          }
        });

        // Request initial data
        vscode.postMessage({ type: 'refresh' });

        function updateStatusUI(running, port) {
          if (running) {
            statusText.innerText = '运行中: ' + port;
            statusDot.classList.add('on');
            startBtn.style.display = 'none';
            stopBtn.style.display = 'inline-block';
          } else {
            statusText.innerText = '已停止';
            statusDot.classList.remove('on');
            startBtn.style.display = 'inline-block';
            stopBtn.style.display = 'none';
          }
        }

        // Render List
        function renderList() {
          ruleListEl.innerHTML = '';
          const rules = config.rules || [];
          if (rules.length === 0) {
            ruleListEl.innerHTML = '<div style="text-align:center; opacity:0.6; margin-top:20px;">暂无拦截规则</div>';
            return;
          }

          rules.forEach(rule => {
            const div = document.createElement('div');
            div.className = 'rule-item';
            div.style.opacity = rule.enabled ? '1' : '0.5';
            
            div.innerHTML = \`
              <input type="checkbox" \${rule.enabled ? 'checked' : ''} class="toggle-rule" data-id="\${rule.id}">
              <div class="method">\${rule.method}</div>
              <div class="url" title="\${rule.url}">\${rule.url}</div>
              <div class="actions">
                <button class="edit-btn" data-id="\${rule.id}">✎</button>
                <button class="del-btn" data-id="\${rule.id}" style="background:var(--vscode-errorForeground)">×</button>
              </div>
            \`;
            ruleListEl.appendChild(div);
          });

          // Bind Events
          document.querySelectorAll('.toggle-rule').forEach(el => {
            el.onchange = (e) => vscode.postMessage({ type: 'toggleRule', id: e.target.dataset.id, enabled: e.target.checked });
          });
          document.querySelectorAll('.del-btn').forEach(el => {
            el.onclick = (e) => {
               if(confirm('确定删除该规则吗？')) {
                 vscode.postMessage({ type: 'deleteRule', id: e.target.dataset.id });
               }
            };
          });
          document.querySelectorAll('.edit-btn').forEach(el => {
            el.onclick = (e) => openModal(e.target.dataset.id);
          });
        }

        // Controls
        startBtn.onclick = () => vscode.postMessage({ type: 'toggleServer', value: true });
        stopBtn.onclick = () => vscode.postMessage({ type: 'toggleServer', value: false });
        
        // Modal Logic
        document.getElementById('addBtn').onclick = () => openModal();
        document.getElementById('cancelBtn').onclick = () => modal.style.display = 'none';
        
        function openModal(id = null) {
          modal.style.display = 'flex';
          previewArea.style.display = 'none';
          previewArea.innerText = '';
          
          if (id) {
            const rule = config.rules.find(r => r.id === id);
            document.getElementById('modalTitle').innerText = '编辑规则';
            document.getElementById('editId').value = rule.id;
            document.getElementById('editMethod').value = rule.method;
            document.getElementById('editUrl').value = rule.url;
            document.getElementById('editContentType').value = rule.contentType;
            document.getElementById('editTemplate').value = typeof rule.template === 'string' ? rule.template : JSON.stringify(rule.template, null, 2);
          } else {
            document.getElementById('modalTitle').innerText = '新增规则';
            document.getElementById('editId').value = '';
            document.getElementById('editMethod').value = 'GET';
            document.getElementById('editUrl').value = '';
            document.getElementById('editContentType').value = 'application/json';
            document.getElementById('editTemplate').value = '{\\n  "code": 0,\\n  "data": {\\n    "name": "@cname"\\n  }\\n}';
          }
        }

        document.getElementById('saveBtn').onclick = () => {
          try {
            const templateStr = document.getElementById('editTemplate').value;
            // 校验 JSON
            const template = JSON.parse(templateStr);
            
            const payload = {
              id: document.getElementById('editId').value || null,
              method: document.getElementById('editMethod').value,
              url: document.getElementById('editUrl').value,
              contentType: document.getElementById('editContentType').value,
              template: template, // 存对象
              enabled: true
            };
            
            if (!payload.url) return alert('URL 不能为空');

            vscode.postMessage({ type: 'saveRule', payload });
            modal.style.display = 'none';
          } catch (e) {
            alert('模板 JSON 格式错误: ' + e.message);
          }
        };

        document.getElementById('simulateBtn').onclick = () => {
           vscode.postMessage({ 
             type: 'simulate', 
             template: document.getElementById('editTemplate').value 
           });
        };

      </script>
    </body>
    </html>`;
  }
}
