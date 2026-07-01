import * as vscode from 'vscode';
import * as path from 'path';
import { TOKENS } from '@core/container/token';

export interface OpenWorkspaceTextDocumentAtLineOptions {
  /**
   * @description 打开文件时使用的编辑器列
   */
  viewColumn?: vscode.ViewColumn;

  /**
   * @description 是否以预览模式打开
   */
  preview?: boolean;

  /**
   * @description 跳转到目标行后的滚动展示方式
   */
  revealType?: vscode.TextEditorRevealType;
}

/**
 * VSCode ExtensionContext 全局上下文 Provider
 *
 * 作用：
 * 1. 统一管理 vscode.ExtensionContext
 * 2. 让 service / provider / controller 都可以通过依赖注入拿到 context
 * 3. 避免到处把 context 当参数传来传去
 * 4. 统一封装工作区路径、URI、文档打开等通用能力
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
   * @description 注册 disposable，统一放进 context.subscriptions
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
   * 用途：
   * - Windows 路径分隔符是 \
   * - macOS / Linux 路径分隔符是 /
   * - 扩展内部保存路径时建议统一成 /
   *
   * 示例：
   * - src\modules\anchor\anchor.service.ts
   * - 转成 src/modules/anchor/anchor.service.ts
   */
  public normalizePath(value: string): string {
    return value.replace(/\\/g, '/');
  }

  /**
   * @description 根据文件 URI 获取它所属的工作区
   *
   * 说明：
   * - 多工作区场景下，不能只拿 workspaceFolders[0]
   * - vscode.workspace.getWorkspaceFolder(uri) 可以判断文件真正属于哪个工作区
   * - 如果判断不到，则回退到第一个工作区
   */
  public getWorkspaceFolderByUri(
    uri: vscode.Uri,
  ): vscode.WorkspaceFolder | undefined {
    return vscode.workspace.getWorkspaceFolder(uri) || this.workspaceFolder;
  }

  /**
   * @description 获取指定 URI 所属工作区的根目录路径
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
   * - 所以需要把绝对路径转成相对路径，才能和锚点 filePath 匹配
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

  /**
   * @description 根据工作区相对路径获取文件 URI
   *
   * 支持：
   * 1. 相对路径：src/index.ts
   * 2. 绝对路径：/Users/xxx/project/src/index.ts
   * 3. URI 字符串：file:///Users/xxx/project/src/index.ts
   */
  public getWorkspaceFileUri(filePath: string): vscode.Uri | undefined {
    if (!filePath) return undefined;

    if (filePath.includes('://')) {
      return vscode.Uri.parse(filePath);
    }

    if (path.isAbsolute(filePath)) {
      return vscode.Uri.file(filePath);
    }

    if (!this.workspacePath) {
      return undefined;
    }

    return vscode.Uri.file(path.join(this.workspacePath, filePath));
  }

  /**
   * @description 根据工作区相对路径获取文件绝对路径
   */
  public getWorkspaceFileAbsolutePath(filePath: string): string {
    const uri = this.getWorkspaceFileUri(filePath);

    return uri?.fsPath || '';
  }

  /**
   * @description 打开工作区内的文本文件
   */
  public async openWorkspaceTextDocument(
    filePath: string,
  ): Promise<vscode.TextDocument | undefined> {
    const uri = this.getWorkspaceFileUri(filePath);

    if (!uri) return undefined;

    return vscode.workspace.openTextDocument(uri);
  }

  /**
   * @description 打开工作区内文件，并跳转到指定行
   *
   * 注意：
   * - uiLine 是用户看到的行号，从 1 开始
   * - vscode.Position 的行号从 0 开始
   * - 所以这里会做 uiLine - 1
   */
  public async openWorkspaceTextDocumentAtLine(
    filePath: string,
    uiLine: number,
    options: OpenWorkspaceTextDocumentAtLineOptions = {},
  ): Promise<vscode.TextEditor | undefined> {
    const document = await this.openWorkspaceTextDocument(filePath);

    if (!document) return undefined;

    const editor = await vscode.window.showTextDocument(document, {
      viewColumn: options.viewColumn ?? vscode.ViewColumn.Active,
      preview: options.preview ?? false,
    });

    const maxLineIndex = Math.max(0, document.lineCount - 1);
    const lineIndex = Math.min(Math.max(0, uiLine - 1), maxLineIndex);
    const position = new vscode.Position(lineIndex, 0);
    const range = new vscode.Range(position, position);

    editor.selection = new vscode.Selection(position, position);
    editor.revealRange(
      range,
      options.revealType ?? vscode.TextEditorRevealType.InCenter,
    );

    return editor;
  }
}