import * as vscode from 'vscode';

/**
 * @description 自动聚焦项目资源管理器插件
 *
 * 监听 readied 生命周期，应用启动完成后自动打开项目资源管理器视图。
 */
export default class AutoFocusRecentPlugin {
  public readonly pluginId = 'auto-focus-recent';

  public init() {
    return {
      pluginId: this.pluginId,
      on: [
        {
          name: 'readied',
          callback: () => {
            void vscode.commands
              .executeCommand('workbench.view.extension.quickOps-view-container')
              .then(() => {
                void vscode.commands.executeCommand('quickOps.recentProjectsView.focus');
              });
          },
        },
      ],
    };
  }
}
