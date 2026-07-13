import * as vscode from 'vscode';
import type { WorkspaceDocumentFilterOptions, WorkspaceEventHandler, WorkspaceEventName } from '@workflow/workspace-events/type';

export type WebviewIcon =
  | string
  | {
      light: string;
      dark: string;
    };

export interface WebviewEnhancerOptions {
  /**
   * @description 插件根目录 Uri
   *
   * 用于根据字符串 icon 解析真实 vscode.Uri。
   */
  extensionUri?: vscode.Uri;

  icon?: WebviewIcon;

  /**
   * @description 当前 Webview 激活时，是否显示 editor/title 放大按钮
   */
  fullscreen?: boolean;
}

export interface WebviewCreatedPayload {
  panel: vscode.WebviewPanel;
  options?: WebviewEnhancerOptions;
}

export type WorkspaceOn = <T extends WorkspaceEventName>(eventName: T, handler: WorkspaceEventHandler<T>, options?: WorkspaceDocumentFilterOptions) => vscode.Disposable;

export interface WebviewAppearancePluginInitOptions {
  on?: WorkspaceOn;
}
