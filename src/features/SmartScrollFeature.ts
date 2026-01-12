import * as vscode from 'vscode';
import { IFeature } from '../core/interfaces/IFeature';
import { EditorContextService } from '../services/EditorContextService';

export class SmartScrollFeature implements IFeature {
  public readonly id = 'SmartScrollFeature';
  private editorService: EditorContextService;

  constructor() {
    // 依赖注入 EditorContextService
    this.editorService = EditorContextService.getInstance();
  }

  public activate(context: vscode.ExtensionContext): void {
    // 注册回到顶部命令
    const topCmd = vscode.commands.registerCommand('myExtension.scrollToTop', () => {
      this.scrollToTop();
    });

    // 注册回到底部命令
    const bottomCmd = vscode.commands.registerCommand('myExtension.scrollToBottom', () => {
      this.scrollToBottom();
    });

    context.subscriptions.push(topCmd, bottomCmd);
    console.log(`[${this.id}] Commands registered.`);
  }

  private scrollToTop() {
    try {
      this.editorService.revealLine(0, vscode.TextEditorRevealType.AtTop);
    } catch (error) {
      vscode.window.showWarningMessage('无法滚动：当前没有活跃的编辑器');
    }
  }

  private scrollToBottom() {
    try {
      const editor = this.editorService.getActiveEditor();
      const lastLine = editor.document.lineCount - 1;
      this.editorService.revealLine(lastLine, vscode.TextEditorRevealType.InCenter);
    } catch (error) {
      vscode.window.showWarningMessage('无法滚动：当前没有活跃的编辑器');
    }
  }
}
