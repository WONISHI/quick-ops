import * as vscode from 'vscode';
import ColorLog from '../../utils/ColorLog';
import type { OnModuleInit } from '../../core/lifecycle/lifecycle.interface';
import { ExtensionContextProvider } from '../../common/providers/extension-context.provider';
import { EditorHistoryService } from './editor-history.service';

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
    this.registerCommands();

    ColorLog.black(`[${this.id}]`, 'Activated.');
  }

  private initCurrentEditor(): void {
    const editor = vscode.window.activeTextEditor;

    if (editor) {
      this.editorHistoryService.pushEditor(editor);
    }
  }

  private registerEditorChangeListener(): void {
    this.extensionContextProvider.register(
      vscode.window.onDidChangeActiveTextEditor(editor => {
        if (!editor) return;

        this.editorHistoryService.pushEditor(editor);
      }),
    );
  }

  private registerCommands(): void {
    this.extensionContextProvider.register(
      vscode.commands.registerCommand('quick-ops.switchPreviousEditor', async () => {
        await this.editorHistoryService.switchToPreviousEditor();
      }),
    );
  }
}