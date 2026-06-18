import * as vscode from 'vscode';
import { TOKENS } from '../../core/container/token';

/**
 * VSCode ExtensionContext 全局上下文 Provider
 *
 * 作用：
 * 1. 统一管理 vscode.ExtensionContext
 * 2. 让 service / provider / controller 都可以通过依赖注入拿到 context
 * 3. 避免到处把 context 当参数传来传去
 */
export class ExtensionContextProvider {
  public static inject = [TOKENS.ExtensionContext];

  constructor(private readonly context: vscode.ExtensionContext) {}

  /**
   * 获取原始 ExtensionContext
   */
  public getContext(): vscode.ExtensionContext {
    return this.context;
  }

  /**
   * 插件订阅列表
   */
  public get subscriptions(): vscode.Disposable[] {
    return this.context.subscriptions;
  }

  /**
   * 插件安装目录 URI
   */
  public get extensionUri(): vscode.Uri {
    return this.context.extensionUri;
  }

  /**
   * 插件安装目录绝对路径
   */
  public get extensionPath(): string {
    return this.context.extensionPath;
  }

  /**
   * 全局状态
   */
  public get globalState(): vscode.Memento & {
    setKeysForSync(keys: readonly string[]): void;
  } {
    return this.context.globalState;
  }

  /**
   * 工作区状态
   */
  public get workspaceState(): vscode.Memento {
    return this.context.workspaceState;
  }

  /**
   * 插件全局存储目录 URI
   */
  public get globalStorageUri(): vscode.Uri {
    return this.context.globalStorageUri;
  }

  /**
   * 插件工作区存储目录 URI
   */
  public get storageUri(): vscode.Uri | undefined {
    return this.context.storageUri;
  }

  /**
   * 插件日志目录 URI
   */
  public get logUri(): vscode.Uri {
    return this.context.logUri;
  }

  /**
   * 插件密钥存储
   */
  public get secrets(): vscode.SecretStorage {
    return this.context.secrets;
  }

  /**
   * 当前插件 ID
   */
  public get extensionId(): string {
    return this.context.extension.id;
  }

  /**
   * 当前插件 package.json
   */
  public get packageJSON(): any {
    return this.context.extension.packageJSON;
  }

  /**
   * 判断插件当前是否激活
   */
  public get isActive(): boolean {
    return this.context.extension.isActive;
  }

  /**
   * 注册 disposable
   */
  public register(...disposables: vscode.Disposable[]): void {
    this.context.subscriptions.push(...disposables);
  }

  /**
   * 获取插件目录下文件的绝对路径
   */
  public asAbsolutePath(relativePath: string): string {
    return this.context.asAbsolutePath(relativePath);
  }

  /**
   * 获取插件目录下文件 URI
   */
  public getExtensionUri(...paths: string[]): vscode.Uri {
    return vscode.Uri.joinPath(this.context.extensionUri, ...paths);
  }

  /**
   * 获取全局存储目录下文件 URI
   */
  public getGlobalStorageUri(...paths: string[]): vscode.Uri {
    return vscode.Uri.joinPath(this.context.globalStorageUri, ...paths);
  }

  /**
   * 获取工作区存储目录下文件 URI
   */
  public getWorkspaceStorageUri(...paths: string[]): vscode.Uri | undefined {
    if (!this.context.storageUri) {
      return undefined;
    }

    return vscode.Uri.joinPath(this.context.storageUri, ...paths);
  }

  /**
   * 获取日志目录下文件 URI
   */
  public getLogUri(...paths: string[]): vscode.Uri {
    return vscode.Uri.joinPath(this.context.logUri, ...paths);
  }
}