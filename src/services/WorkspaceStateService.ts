import * as vscode from 'vscode';
import * as path from 'path';
import { IService } from '../core/interfaces/IService';

export interface ICurrentFileState {
  uri: vscode.Uri | null;
  fileName: string;
  fileType: string;
  content: string;
  isDirty: boolean;
}

export class WorkspaceStateService implements IService {
  public readonly serviceId = 'WorkspaceStateService';
  private static _instance: WorkspaceStateService;

  // 响应式状态：当前活跃文件的信息
  private _currentState: ICurrentFileState = {
    uri: null,
    fileName: '',
    fileType: '',
    content: '',
    isDirty: false,
  };

  private constructor() {}

  public static getInstance(): WorkspaceStateService {
    if (!this._instance) {
      this._instance = new WorkspaceStateService();
    }
    return this._instance;
  }

  public init(): void {
    // 初始化时读取一次
    this.updateState(vscode.window.activeTextEditor?.document);

    // 监听文件切换
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      this.updateState(editor?.document);
    });

    // 监听文件内容变化 (可选，根据性能需求决定是否实时监听内容)
    vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document === vscode.window.activeTextEditor?.document) {
        this.updateState(e.document);
      }
    });

    console.log(`[${this.serviceId}] Initialized.`);
  }

  public get state(): Readonly<ICurrentFileState> {
    return this._currentState;
  }

  private updateState(document: vscode.TextDocument | undefined) {
    if (!document) {
      this._currentState = {
        uri: null,
        fileName: '',
        fileType: '',
        content: '',
        isDirty: false,
      };
      return;
    }

    const filePath = document.uri.fsPath;
    this._currentState = {
      uri: document.uri,
      fileName: path.basename(filePath),
      fileType: path.extname(filePath).replace('.', '').toLowerCase(),
      content: document.getText(), // 注意：大文件可能影响性能
      isDirty: document.isDirty,
    };
  }
}
