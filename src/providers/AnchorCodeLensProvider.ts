import * as vscode from 'vscode';
import * as path from 'path';
import { AnchorService } from '../services/AnchorService';
import { ColorUtils } from '../utils/ColorUtils'; // 引入工具

export class AnchorCodeLensProvider implements vscode.CodeLensProvider {
  private service: AnchorService;
  private _onDidChangeCodeLenses: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
  public readonly onDidChangeCodeLenses: vscode.Event<void> = this._onDidChangeCodeLenses.event;

  constructor() {
    this.service = AnchorService.getInstance();
    // 监听数据变化，刷新 CodeLens
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
      const range = new vscode.Range(anchor.line, 0, anchor.line, 0);

      // 🔥 修改 1: 获取该分组对应的 Emoji
      const emoji = ColorUtils.getEmoji(anchor.group);

      // 🔥 修改 2: 在 Title 前面加上 Emoji
      lenses.push(
        new vscode.CodeLens(range, {
          title: `${emoji} ${anchor.group}`,
          tooltip: '查看该组所有锚点',
          command: 'quick-ops.anchor.listByGroup',
          arguments: [anchor.group],
        }),
      );

      // 2. 上一个
      lenses.push(
        new vscode.CodeLens(range, {
          title: '$(arrow-up)',
          tooltip: '跳转到上一个锚点',
          command: 'quick-ops.anchor.navigate',
          arguments: [anchor.id, 'prev'],
        }),
      );

      // 3. 下一个
      lenses.push(
        new vscode.CodeLens(range, {
          title: '$(arrow-down)',
          tooltip: '跳转到下一个锚点',
          command: 'quick-ops.anchor.navigate',
          arguments: [anchor.id, 'next'],
        }),
      );

      // 4. 删除
      lenses.push(
        new vscode.CodeLens(range, {
          title: '$(trash)',
          tooltip: '删除该锚点',
          command: 'quick-ops.anchor.delete',
          arguments: [anchor.id],
        }),
      );
    }

    return lenses;
  }
}
