import * as vscode from 'vscode';
import { ConfigurationService } from '../../common/services/configuration.service';

interface CommonCommandItem {
  label: string;
  icon: string;
  command: string;
}

type ConsoleType = 'log' | 'info' | 'warn' | 'error';

const COMMON_COMMANDS: CommonCommandItem[] = [
  {
    label: '刷新窗口',
    icon: 'refresh',
    command: 'workbench.action.reloadWindow',
  },
  {
    label: '开发者工具',
    icon: 'terminal',
    command: 'workbench.action.toggleDevTools',
  },
  {
    label: '输出面板',
    icon: 'output',
    command: 'workbench.action.output.toggleOutput',
  },
  {
    label: '重启 TS 服务',
    icon: 'server-process',
    command: 'typescript.restartTsServer',
  },
  {
    label: '新建终端',
    icon: 'add',
    command: 'workbench.action.terminal.new',
  },
  {
    label: '清空终端',
    icon: 'clear-all',
    command: 'workbench.action.terminal.clear',
  },
];

export class DebugConsoleService {
  public static inject = [ConfigurationService];

  private statusBarItem?: vscode.StatusBarItem;
  private hijacked = false;

  private readonly activeLogs: Record<ConsoleType, boolean> = {
    log: true,
    info: true,
    warn: true,
    error: true,
  };

  private readonly originalConsole = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error,
  };

  constructor(private readonly configurationService: ConfigurationService) {}

  public initStatusBar(): void {
    if (this.statusBarItem) return;

    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100,
    );

    this.statusBarItem.text = '$(bug) Q-Ops 调试';
    this.statusBarItem.name = 'Q-Ops Debug Console';

    this.updateTooltip();
  }

  public checkConfigAndToggle(): void {
    const isDebug = this.isDebugEnabled();

    if (!this.statusBarItem) {
      this.initStatusBar();
    }

    if (isDebug) {
      this.updateTooltip();
      this.statusBarItem?.show();
    } else {
      this.statusBarItem?.hide();
    }
  }

  public toggleConsole(type: string): void {
    if (!this.isConsoleType(type)) {
      vscode.window.showWarningMessage(`不支持的 console 类型: ${type}`);
      return;
    }

    this.activeLogs[type] = !this.activeLogs[type];
    this.updateTooltip();

    const stateText = this.activeLogs[type] ? '开启' : '关闭';
    vscode.window.showInformationMessage(`已${stateText}对 console.${type} 的拦截`);
  }

  public hijackConsole(): void {
    if (this.hijacked) return;

    this.hijacked = true;

    console.log = (...args: any[]) => {
      this.originalConsole.log.apply(console, args);
      this.notifyUser('log', args);
    };

    console.info = (...args: any[]) => {
      this.originalConsole.info.apply(console, args);
      this.notifyUser('info', args);
    };

    console.warn = (...args: any[]) => {
      this.originalConsole.warn.apply(console, args);
      this.notifyUser('warn', args);
    };

    console.error = (...args: any[]) => {
      this.originalConsole.error.apply(console, args);
      this.notifyUser('error', args);
    };
  }

  public restoreConsole(): void {
    if (!this.hijacked) return;

    console.log = this.originalConsole.log;
    console.info = this.originalConsole.info;
    console.warn = this.originalConsole.warn;
    console.error = this.originalConsole.error;

    this.hijacked = false;
  }

  public dispose(): void {
    this.restoreConsole();

    this.statusBarItem?.dispose();
    this.statusBarItem = undefined;
  }

  private updateTooltip(): void {
    if (!this.statusBarItem) return;

    const markdown = new vscode.MarkdownString();

    markdown.isTrusted = true;
    markdown.supportHtml = true;
    markdown.supportThemeIcons = true;

    markdown.appendMarkdown('### $(dashboard) Q-Ops 调试中心\n\n---\n\n');

    markdown.appendMarkdown('**$(settings) 常用控制**\n\n');

    const commandLinks = COMMON_COMMANDS.map(commandItem => {
      return `[$(${commandItem.icon}) ${commandItem.label}](command:${commandItem.command})`;
    });

    for (let i = 0; i < commandLinks.length; i += 3) {
      markdown.appendMarkdown(`${commandLinks.slice(i, i + 3).join('   |   ')}\\\n`);
    }

    markdown.appendMarkdown('\n---\n\n');
    markdown.appendMarkdown('**$(debug-console) Console 弹窗拦截器**\n\n');

    const toggleLinks = (['log', 'info', 'warn', 'error'] as ConsoleType[]).map(type => {
      const isChecked = this.activeLogs[type];
      const icon = isChecked ? '$(pass-filled)' : '$(circle-large-outline)';
      const args = encodeURIComponent(JSON.stringify([type]));
      const commandUri = `command:quick-ops.debug.toggleConsole?${args}`;

      return `[${icon} ${type}](${commandUri})`;
    });

    markdown.appendMarkdown(toggleLinks.join('        '));
    markdown.appendMarkdown('\n\n*(点击上方开关可动态启停全局 console 弹窗拦截)*');

    this.statusBarItem.tooltip = markdown;
  }

  private notifyUser(type: ConsoleType, args: any[]): void {
    const isDebug = this.isDebugEnabled();

    if (!isDebug || !this.activeLogs[type]) return;

    const message = this.stringifyConsoleArgs(args);
    const finalMessage = `[Console.${type.toUpperCase()}] ${message}`;

    if (type === 'error') {
      vscode.window.showErrorMessage(finalMessage);
      return;
    }

    if (type === 'warn') {
      vscode.window.showWarningMessage(finalMessage);
      return;
    }

    vscode.window.showInformationMessage(finalMessage);
  }

  private stringifyConsoleArgs(args: any[]): string {
    try {
      return args
        .map(item => {
          if (typeof item === 'string') {
            return item;
          }

          if (typeof item === 'object') {
            return JSON.stringify(item);
          }

          return String(item);
        })
        .join(' ');
    } catch {
      return '[复杂对象, 无法序列化显示]';
    }
  }

  private isDebugEnabled(): boolean {
    return this.configurationService.config.general?.debug === true;
  }

  private isConsoleType(type: string): type is ConsoleType {
    return ['log', 'info', 'warn', 'error'].includes(type);
  }
}