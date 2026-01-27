import * as vscode from 'vscode';
import * as path from 'path';
import { AnchorService } from '../services/AnchorService';
import { ColorUtils } from '../utils/ColorUtils';

export class AnchorCodeLensProvider implements vscode.CodeLensProvider {
  private service: AnchorService;
  private _onDidChangeCodeLenses: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
  public readonly onDidChangeCodeLenses: vscode.Event<void> = this._onDidChangeCodeLenses.event;

  private isInternalUpdate = false;
  private debounceTimer: NodeJS.Timeout | undefined;

  constructor() {
    this.service = AnchorService.getInstance();

    this.service.onDidChangeAnchors(() => {
      if (this.isInternalUpdate) return;

      if (this.debounceTimer) clearTimeout(this.debounceTimer);
      this.debounceTimer = setTimeout(() => {
        this._onDidChangeCodeLenses.fire();
      }, 200);
    });
  }

  public provideCodeLenses(document: vscode.TextDocument, token: vscode.CancellationToken): vscode.CodeLens[] {
    const lenses: vscode.CodeLens[] = [];
    const rootPath = vscode.workspace.workspaceFolders?.[0].uri.fsPath || '';
    const relativePath = path.relative(rootPath, document.uri.fsPath).replace(/\\/g, '/');
    const anchors = this.service.getAnchors(relativePath);

    let contentToLinesMap: Map<string, number[]> | null = null;

    for (const i in anchors) {
      const anchor = anchors[i];
      let targetLineIndex = Math.max(0, anchor.line - 1);
      const docLineCount = document.lineCount;

      if (targetLineIndex >= docLineCount) {
        continue; // 越界忽略
      }

      const currentLineContent = document.lineAt(targetLineIndex).text.trim();

      if (currentLineContent !== anchor.content) {
        let foundLineIndex = -1;

        if (!contentToLinesMap) {
          contentToLinesMap = new Map();
          for (let l = 0; l < docLineCount; l++) {
            const lineText = document.lineAt(l).text.trim();
            if (!lineText) continue;
            if (!contentToLinesMap.has(lineText)) {
              contentToLinesMap.set(lineText, []);
            }
            contentToLinesMap.get(lineText)!.push(l);
          }
        }

        const candidates = contentToLinesMap.get(anchor.content);

        if (candidates && candidates.length > 0) {
          // 在所有内容匹配的行中，找到离“原位置”最近的那一行
          foundLineIndex = candidates.reduce((prev, curr) => {
            return Math.abs(curr - targetLineIndex) < Math.abs(prev - targetLineIndex) ? curr : prev;
          });
        }

        // 修正逻辑
        if (foundLineIndex !== -1) {
          targetLineIndex = foundLineIndex;
          this.isInternalUpdate = true;
          this.service.updateAnchorLine(anchor.id, foundLineIndex + 1);
          this.isInternalUpdate = false;
        } else {
          continue;
        }
      }

      // --- 构造 CodeLens ---
      const range = new vscode.Range(targetLineIndex, 0, targetLineIndex, 0);
      const emoji = ColorUtils.getEmoji(anchor.group);

      lenses.push(
        new vscode.CodeLens(range, {
          title: `${emoji} ${anchor.group}-${i + 1}`,
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
