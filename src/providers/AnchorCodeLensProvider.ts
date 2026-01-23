import * as vscode from 'vscode';
import * as path from 'path';
import { AnchorService } from '../services/AnchorService';
import { ColorUtils } from '../utils/ColorUtils';

export class AnchorCodeLensProvider implements vscode.CodeLensProvider {
  private service: AnchorService;
  private _onDidChangeCodeLenses: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
  public readonly onDidChangeCodeLenses: vscode.Event<void> = this._onDidChangeCodeLenses.event;

  constructor() {
    this.service = AnchorService.getInstance();
    this.service.onDidChangeAnchors(() => {
      this._onDidChangeCodeLenses.fire();
    });
  }

  public provideCodeLenses(document: vscode.TextDocument, token: vscode.CancellationToken): vscode.CodeLens[] {
    const lenses: vscode.CodeLens[] = [];
    const rootPath = vscode.workspace.workspaceFolders?.[0].uri.fsPath || '';

    const relativePath = path.relative(rootPath, document.uri.fsPath).replace(/\\/g, '/');
    const anchors = this.service.getAnchors(relativePath);

    for (const anchor of anchors) {
      // 🔥🔥🔥 核心修复：
      // 文件里存的是 25 (UI行号)，VS Code 内部渲染需要 24 (0-based)
      // 所以必须 减 1
      let targetLineIndex = Math.max(0, anchor.line - 1);
      const docLineCount = document.lineCount;

      if (targetLineIndex >= docLineCount) {
        continue;
      }

      // 1. 内容校准逻辑
      const currentLineContent = document.lineAt(targetLineIndex).text.trim();

      if (currentLineContent !== anchor.content) {
        let foundLineIndex = -1;
        for (let i = 0; i < docLineCount; i++) {
          if (document.lineAt(i).text.trim() === anchor.content) {
            foundLineIndex = i;
            break;
          }
        }

        if (foundLineIndex !== -1) {
          targetLineIndex = foundLineIndex;
          // 🔥 修正存储：将找到的 0-based 转回 1-based (UI行号) 存起来
          this.service.updateAnchorLine(anchor.id, foundLineIndex + 1);
        } else {
          continue;
        }
      }

      // 2. 构造 CodeLens
      // 使用 0-based 索引，VS Code 会渲染在该行上方
      const range = new vscode.Range(targetLineIndex, 0, targetLineIndex, 0);
      const emoji = ColorUtils.getEmoji(anchor.group);

      lenses.push(
        new vscode.CodeLens(range, {
          title: `${emoji} ${anchor.group}`,
          tooltip: '查看该组所有锚点',
          command: 'quick-ops.anchor.listByGroup',
          arguments: [anchor.group],
        }),
      );

      lenses.push(
        new vscode.CodeLens(range, {
          title: '↑',
          tooltip: '上一个',
          command: 'quick-ops.anchor.navigate',
          arguments: [anchor.id, 'prev'],
        }),
      );

      lenses.push(
        new vscode.CodeLens(range, {
          title: '↓',
          tooltip: '下一个',
          command: 'quick-ops.anchor.navigate',
          arguments: [anchor.id, 'next'],
        }),
      );

      lenses.push(
        new vscode.CodeLens(range, {
          title: '$(trash)',
          tooltip: '删除',
          command: 'quick-ops.anchor.delete',
          arguments: [anchor.id],
        }),
      );
    }

    return lenses;
  }
}
