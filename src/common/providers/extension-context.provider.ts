import * as vscode from 'vscode';
import * as path from 'path';
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
   * @description 获取原始 ExtensionContext
   */
  public getContext(): vscode.ExtensionContext {
    return this.context;
  }

  /**
   * @description 插件订阅列表
   */
  public get subscriptions(): vscode.Disposable[] {
    return this.context.subscriptions;
  }

  /**
   * @description 插件安装目录 URI
   */
  public get extensionUri(): vscode.Uri {
    return this.context.extensionUri;
  }

  /**
   * @description 插件安装目录绝对路径
   */
  public get extensionPath(): string {
    return this.context.extensionPath;
  }

  /**
   * @description 全局状态
   */
  public get globalState(): vscode.Memento & {
    setKeysForSync(keys: readonly string[]): void;
  } {
    return this.context.globalState;
  }

  /**
   * @description 工作区状态
   */
  public get workspaceState(): vscode.Memento {
    return this.context.workspaceState;
  }

  /**
   * @description 插件全局存储目录 URI
   */
  public get globalStorageUri(): vscode.Uri {
    return this.context.globalStorageUri;
  }

  /**
   * @description 插件工作区存储目录 URI
   */
  public get storageUri(): vscode.Uri | undefined {
    return this.context.storageUri;
  }

  /**
   * @description 插件日志目录 URI
   */
  public get logUri(): vscode.Uri {
    return this.context.logUri;
  }

  /**
   * @description 插件密钥存储
   */
  public get secrets(): vscode.SecretStorage {
    return this.context.secrets;
  }

  /**
   * @description 当前插件 ID
   */
  public get extensionId(): string {
    return this.context.extension.id;
  }

  /**
   * @description 当前插件 package.json
   */
  public get packageJSON(): any {
    return this.context.extension.packageJSON;
  }

  /**
   * @description 判断插件当前是否激活
   */
  public get isActive(): boolean {
    return this.context.extension.isActive;
  }

  /**
   * @description 获取当前第一个工作区
   */
  public get workspaceFolder(): vscode.WorkspaceFolder | undefined {
    return vscode.workspace.workspaceFolders?.[0];
  }

  /**
   * @description 获取当前第一个工作区 URI
   */
  public get workspaceUri(): vscode.Uri | undefined {
    return this.workspaceFolder?.uri;
  }

  /**
   * @description 获取当前第一个工作区绝对路径
   */
  public get workspacePath(): string {
    return this.workspaceFolder?.uri.fsPath || '';
  }

  /**
   * @description 注册 disposable
   */
  public register(...disposables: vscode.Disposable[]): void {
    this.context.subscriptions.push(...disposables);
  }

  /**
   * @description 获取插件目录下文件的绝对路径
   */
  public asAbsolutePath(relativePath: string): string {
    return this.context.asAbsolutePath(relativePath);
  }

  /**
   * @description 获取插件目录下文件 URI
   */
  public getExtensionUri(...paths: string[]): vscode.Uri {
    return vscode.Uri.joinPath(this.context.extensionUri, ...paths);
  }

  /**
   * @description 获取全局存储目录下文件 URI
   */
  public getGlobalStorageUri(...paths: string[]): vscode.Uri {
    return vscode.Uri.joinPath(this.context.globalStorageUri, ...paths);
  }

  /**
   * @description 获取工作区存储目录下文件 URI
   */
  public getWorkspaceStorageUri(...paths: string[]): vscode.Uri | undefined {
    if (!this.context.storageUri) {
      return undefined;
    }

    return vscode.Uri.joinPath(this.context.storageUri, ...paths);
  }

  /**
   * @description 获取日志目录下文件 URI
   */
  public getLogUri(...paths: string[]): vscode.Uri {
    return vscode.Uri.joinPath(this.context.logUri, ...paths);
  }

  /**
   * @description 把路径统一成 POSIX 风格
   *
   * 例如：
   * - Windows: src\modules\anchor\anchor.service.ts
   * - 统一后: src/modules/anchor/anchor.service.ts
   */
  public normalizePath(value: string): string {
    return value.replace(/\\/g, '/');
  }

  /**
   * @description 根据文件 URI 获取它所属的工作区
   *
   * 多工作区场景下，优先使用 vscode.workspace.getWorkspaceFolder(uri)
   * 判断文件真正属于哪个 workspace。
   */
  public getWorkspaceFolderByUri(
    uri: vscode.Uri,
  ): vscode.WorkspaceFolder | undefined {
    return vscode.workspace.getWorkspaceFolder(uri) || this.workspaceFolder;
  }

  /**
   * @description 获取指定文件所属工作区的根目录路径
   */
  public getWorkspacePathByUri(uri: vscode.Uri): string {
    return this.getWorkspaceFolderByUri(uri)?.uri.fsPath || '';
  }

  /**
   * @description 获取文件相对于工作区根目录的路径
   *
   * 使用场景：
   * - 锚点保存的是相对路径，例如 src/modules/anchor/anchor.service.ts
   * - document.uri.fsPath 是绝对路径
   * - 所以需要统一转成相对路径，才能和锚点 filePath 匹配
   */
  public getRelativePathByUri(uri: vscode.Uri): string {
    const workspacePath = this.getWorkspacePathByUri(uri);

    if (!workspacePath) {
      return this.normalizePath(uri.fsPath);
    }

    return this.normalizePath(path.relative(workspacePath, uri.fsPath));
  }

  /**
   * @description 获取文档相对于工作区根目录的路径
   */
  public getDocumentRelativePath(document: vscode.TextDocument): string {
    return this.getRelativePathByUri(document.uri);
  }

  /**
   * @description 判断指定 URI 是否在当前工作区内
   */
  public isUriInWorkspace(uri: vscode.Uri): boolean {
    const workspaceFolder = this.getWorkspaceFolderByUri(uri);

    if (!workspaceFolder) return false;

    const workspacePath = this.normalizePath(workspaceFolder.uri.fsPath);
    const targetPath = this.normalizePath(uri.fsPath);

    return targetPath === workspacePath || targetPath.startsWith(`${workspacePath}/`);
  }
}