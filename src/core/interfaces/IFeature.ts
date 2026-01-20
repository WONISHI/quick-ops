import * as vscode from 'vscode';

/**
 * 业务功能接口
 * 所有面向用户的具体功能模块（Features）都应实现此接口
 */
export interface IFeature {
  /** 功能模块的唯一标识符 */
  readonly id: string;

  /** * 激活功能
   * 在这里注册命令、Webview 或其他 VS Code 贡献点
   */
  activate(context: vscode.ExtensionContext): void;

  /** 销毁功能模块资源 */
  dispose?(): void;
}
