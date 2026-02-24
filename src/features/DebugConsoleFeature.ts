import * as vscode from 'vscode';
import { IFeature } from '../core/interfaces/IFeature';
import { ConfigurationService } from '../services/ConfigurationService';

export class DebugConsoleFeature implements IFeature {
  public readonly id = 'DebugConsoleFeature';
  private statusBarItem!: vscode.StatusBarItem;
  private configService = ConfigurationService.getInstance();

  // 默认开启所有监听
  private activeLogs: Record<string, boolean> = {
    log: true,
    info: true,
    warn: true,
    error: true,
  };

  // 保存原始的 console 方法
  private originalConsole = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error,
  };

  public activate(context: vscode.ExtensionContext): void {
    // 1. 创建状态栏按钮 (只显示一个主入口)
    this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.statusBarItem.text = '$(bug) Q-Ops 调试';
    context.subscriptions.push(this.statusBarItem);

    // 2. 注册点击勾选/取消的命令
    context.subscriptions.push(
      vscode.commands.registerCommand('quick-ops.debug.toggleConsole', (type: string) => {
        this.activeLogs[type] = !this.activeLogs[type];
        this.updateTooltip(); // 状态改变后重绘 Hover 菜单

        const stateText = this.activeLogs[type] ? '开启' : '关闭';
        vscode.window.showInformationMessage(`已${stateText}对 console.${type} 的拦截`);
      }),
    );

    // 3. 监听自定义配置文件 .quickopsrc 的变化
    const configWatcher = vscode.workspace.createFileSystemWatcher('**/.quickopsrc');
    configWatcher.onDidChange(() => this.checkConfigAndToggle());
    configWatcher.onDidCreate(() => this.checkConfigAndToggle());
    configWatcher.onDidDelete(() => this.checkConfigAndToggle());
    context.subscriptions.push(configWatcher);

    // 4. 初始化
    this.checkConfigAndToggle();
    this.hijackConsole();
  }

  // 检查配置并控制显示/隐藏
  private async checkConfigAndToggle() {
    await this.configService.loadConfig();
    const isDebug = this.configService.config.general?.debug === true;

    if (isDebug) {
      this.updateTooltip(); // 确保提示是最新的
      this.statusBarItem.show();
    } else {
      this.statusBarItem.hide();
    }
  }

  // 🌟 核心：绘制“迷你控制面板”形式的 Hover 悬浮菜单
  private updateTooltip() {
    const md = new vscode.MarkdownString();
    md.isTrusted = true; // 允许执行命令
    md.supportHtml = true; // 允许 HTML 空格排版
    md.supportThemeIcons = true; // 允许解析 $(icon)

    // --- 标题区 ---
    md.appendMarkdown('### $(dashboard) Q-Ops 调试中心\n\n---\n\n');

    // --- 快捷操作区 (调用 VS Code 内置命令) ---
    md.appendMarkdown(`**$(settings) 常用控制**\n\n`);

    // 刷新窗口 (等同于 Cmd+R)
    md.appendMarkdown('[`$(refresh) 刷新插件 (Reload)`](command:workbench.action.reloadWindow) &nbsp;&nbsp; ');
    // 打开开发者工具 (查看 Webview 报错和底层报错)
    md.appendMarkdown('[`$(terminal) 开发者工具`](command:workbench.action.toggleDevTools) &nbsp;&nbsp; ');
    // 打开底层输出面板
    md.appendMarkdown('[`$(output) 输出面板`](command:workbench.action.output.toggleOutput)\n\n');
    // 打开外部终端
    md.appendMarkdown('[`$(console) 新建终端`](command:workbench.action.terminal.new)\n\n');

    md.appendMarkdown('---\n\n');

    // --- 拦截开关区 ---
    md.appendMarkdown(`**$(debug-console) Console 弹窗拦截器**\n\n`);

    const types = ['log', 'info', 'warn', 'error'];
    const toggleLinks = types.map((type) => {
      const isChecked = this.activeLogs[type];
      // 状态图标
      const icon = isChecked ? '$(pass-filled)' : '$(circle-large-outline)';

      // 构造带参数的命令链接
      const args = encodeURIComponent(JSON.stringify([type]));
      const cmdUri = `command:quick-ops.debug.toggleConsole?${args}`;

      return `[${icon} ${type}](${cmdUri})`;
    });

    // 将四个按钮横向排布
    md.appendMarkdown(toggleLinks.join(' &nbsp;&nbsp;|&nbsp;&nbsp; '));
    md.appendMarkdown('\n\n*(点击上方开关可动态启停全局 console 弹窗拦截)*');

    this.statusBarItem.tooltip = md;
  }

  // 拦截全局 console
  private hijackConsole() {
    const that = this;

    console.log = function (...args: any[]) {
      that.originalConsole.log.apply(console, args);
      that.notifyUser('log', args);
    };

    console.info = function (...args: any[]) {
      that.originalConsole.info.apply(console, args);
      that.notifyUser('info', args);
    };

    console.warn = function (...args: any[]) {
      that.originalConsole.warn.apply(console, args);
      that.notifyUser('warn', args);
    };

    console.error = function (...args: any[]) {
      that.originalConsole.error.apply(console, args);
      that.notifyUser('error', args);
    };
  }

  // 触发 VS Code 右下角弹窗
  private notifyUser(type: string, args: any[]) {
    const isDebug = this.configService.config.general?.debug === true;

    if (!isDebug || !this.activeLogs[type]) return;

    let msgStr = '';
    try {
      msgStr = args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
    } catch (e) {
      msgStr = '[复杂对象, 无法序列化显示]';
    }

    const finalMsg = `[Console.${type.toUpperCase()}] ${msgStr}`;

    if (type === 'error') {
      vscode.window.showErrorMessage(finalMsg);
    } else if (type === 'warn') {
      vscode.window.showWarningMessage(finalMsg);
    } else {
      vscode.window.showInformationMessage(finalMsg);
    }
  }
}
