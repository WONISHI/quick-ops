import * as vscode from 'vscode';
import type { WebviewCreatedPayload, WebviewIcon } from '@plugins/webview-enhancer/type';

export class WebviewAppearancePlugin {
  public init() {
    return {
      pluginId: 'webview-icon-plugin',

      /**
       * 使用 Webview 工作流已有的 webview:created
       * 不需要额外新增 webview:addIcon
       */
      on: [
        {
          name: 'webview:created',
          callback: this.handleWebviewCreated.bind(this),
        },
      ],
    };
  }

  /**
   * @description Webview 创建完成后，给 WebviewPanel 添加图标
   */
  private handleWebviewCreated(payload: WebviewCreatedPayload): void {
    const { panel, options, context } = payload;

    if (!panel) return;
    if (!options?.icon) return;

    panel.iconPath = this.resolveIconPath(context, options.icon);
  }

  /**
   * @description 解析 Webview 图标路径
   *
   * 兼容两种情况：
   * 1. icon 是字符串：表示不区分 light / dark，直接使用同一个图标
   * 2. icon 是对象：表示区分 light / dark 图标
   */
  private resolveIconPath(context: vscode.ExtensionContext, icon: WebviewIcon): vscode.Uri | { light: vscode.Uri; dark: vscode.Uri } {
    if (typeof icon === 'string') {
      return vscode.Uri.joinPath(context.extensionUri, icon);
    }

    return {
      light: vscode.Uri.joinPath(context.extensionUri, icon.light),
      dark: vscode.Uri.joinPath(context.extensionUri, icon.dark),
    };
  }
}
