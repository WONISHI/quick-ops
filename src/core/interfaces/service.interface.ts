import * as vscode from 'vscode';

/**
 * 基础服务接口
 * 所有基础设施服务都应实现此接口
 */
export interface IService {
  /** 服务的唯一标识符 */
  readonly serviceId: string;

  /** 初始化服务 */
  init(context?: vscode.ExtensionContext): Promise<void> | void;

  /** 销毁服务，清理资源 */
  dispose?(): void | Promise<void>;
}