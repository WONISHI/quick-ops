import type { CommonCommandItem } from '@/modules/debug-console/debug-console.type';

export const COMMON_COMMANDS: CommonCommandItem[] = [
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
