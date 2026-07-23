import * as vscode from 'vscode';

import type { OnModuleInit } from '@core/lifecycle/lifecycle.interface';
import { ExtensionContextProvider } from '@common/providers/extension-context.provider';
import { EditorHistoryService } from '@modules/editor-history/editor-history.service';

export class EditorHistoryController implements OnModuleInit {
  public static inject = [ExtensionContextProvider, EditorHistoryService];

  private readonly id = 'EditorHistoryModule';

  constructor(
    private readonly extensionContextProvider: ExtensionContextProvider,
    private readonly editorHistoryService: EditorHistoryService,
  ) {}

  public onModuleInit(): void {
    this.initCurrentEditor();
    this.registerEditorChangeListener();
    this.registerEditorSelectionListener();
    this.registerCommands();
  }

  /**
   * @description 记录扩展启动时已经处于活动状态的编辑器
   */
  private initCurrentEditor(): void {
    const editor = vscode.window.activeTextEditor;

    if (editor) {
      this.editorHistoryService.pushEditor(editor);
    }
  }

  /**
   * @description 监听活动文件切换
   */
  private registerEditorChangeListener(): void {
    this.extensionContextProvider.register(
      vscode.window.onDidChangeActiveTextEditor(editor => {
        if (!editor) return;

        this.editorHistoryService.pushEditor(editor);
      }),
    );
  }

  /**
   * @description 监听当前文件中的光标聚焦位置
   */
  private registerEditorSelectionListener(): void {
    this.extensionContextProvider.register(
      vscode.window.onDidChangeTextEditorSelection(event => {
        this.editorHistoryService.scheduleEditorPosition(event.textEditor);
      }),
    );
  }

  /**
   * @description 注册文件历史与文件内位置历史命令
   */
  private registerCommands(): void {
    this.extensionContextProvider.register(
      vscode.commands.registerCommand('quickOps.switchPreviousEditor', async () => {
        await this.editorHistoryService.switchToPreviousEditor();
      }),

      vscode.commands.registerCommand('quickOps.switchNextEditor', async () => {
        await this.editorHistoryService.switchToNextEditor();
      }),

      vscode.commands.registerCommand('quickOps.switchPreviousEditorLocation', async () => {
        await this.editorHistoryService.switchToPreviousLocation();
      }),

      vscode.commands.registerCommand('quickOps.switchNextEditorLocation', async () => {
        await this.editorHistoryService.switchToNextLocation();
      }),
    );
  }
}
