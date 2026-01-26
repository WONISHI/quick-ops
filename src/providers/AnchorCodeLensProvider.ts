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

    for (const i in anchors) {
      const anchor = anchors[i];
      let targetLineIndex = Math.max(0, anchor.line - 1);
      const docLineCount = document.lineCount;

      if (targetLineIndex >= docLineCount) {
        continue;
      }

      const currentLineContent = document.lineAt(targetLineIndex).text.trim();

      // 如果内部不同的话
      if (currentLineContent !== anchor.content) {
        let foundLineIndex = -1;
        for (let i = 0; i < docLineCount; i++) {
          if (document.lineAt(i).text.trim() === anchor.content) {
            foundLineIndex = i;
            break;
          }
        }

        // 修正line
        if (foundLineIndex !== -1) {
          targetLineIndex = foundLineIndex;
          this.service.updateAnchorLine(anchor.id, foundLineIndex + 1);
        } else {
          continue;
        }
      }

      const range = new vscode.Range(targetLineIndex, 0, targetLineIndex, 0);

      /**
       * CodeLens
       * - 按 range.start.line 分组
       * - 同一行上的多个 CodeLens → 横向排列显示
       */

      const emoji = ColorUtils.getEmoji(anchor.group);

      lenses.push(
        new vscode.CodeLens(range, {
          title: `${emoji} ${anchor.group}-${i}`,
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
