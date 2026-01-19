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
    
    // 获取当前文件所有的锚点数据 (原始数据)
    const relativePath = path.relative(rootPath, document.uri.fsPath).replace(/\\/g, '/');
    const anchors = this.service.getAnchors(relativePath);

    // 🔥 优化：如果锚点对应的行内容对不上了，尝试在附近找一下
    for (const anchor of anchors) {
      let targetLine = anchor.line;
      const docLineCount = document.lineCount;

      // 1. 检查当前记录的行号，内容是否匹配
      // 注意：anchor.content 存的是 trim() 后的内容，所以比较时也要 trim()
      const currentLineContent = targetLine < docLineCount ? document.lineAt(targetLine).text.trim() : '';
      
      if (currentLineContent !== anchor.content) {
        // 🔥 内容不匹配！说明代码行号变了（比如上面插入了新行）
        // 尝试在附近查找 (比如上下 50 行内) 或者全文查找
        // 为了性能，我们先简单全文查找（如果文件极其巨大可能要优化）
        let foundLine = -1;
        
        // 简单策略：先找原行号附近，再扩大范围
        // 这里演示直接遍历全文查找 (最稳健但最耗时)
        for (let i = 0; i < docLineCount; i++) {
          if (document.lineAt(i).text.trim() === anchor.content) {
            foundLine = i;
            break;
          }
        }

        if (foundLine !== -1) {
          targetLine = foundLine;
          // 可选：静默更新 Service 里的行号，下次就不用找了
          this.service.updateAnchorLine(anchor.id, foundLine); 
        } else {
          // 彻底找不到了（可能代码被改了），那就只能显示在旧位置或者不显示
          // 这里的策略是：如果找不到内容，就不显示 CodeLens，避免误导
          continue; 
        }
      }

      const range = new vscode.Range(targetLine, 0, targetLine, 0);
      const emoji = ColorUtils.getEmoji(anchor.group);

      lenses.push(new vscode.CodeLens(range, {
        title: `${emoji} ${anchor.group}`, 
        tooltip: '查看该组所有锚点',
        command: 'quick-ops.anchor.listByGroup',
        arguments: [anchor.group]
      }));

      lenses.push(new vscode.CodeLens(range, {
        title: '↑',
        tooltip: '上一个',
        command: 'quick-ops.anchor.navigate',
        arguments: [anchor.id, 'prev']
      }));

      lenses.push(new vscode.CodeLens(range, {
        title: '↓',
        tooltip: '下一个',
        command: 'quick-ops.anchor.navigate',
        arguments: [anchor.id, 'next']
      }));

      lenses.push(new vscode.CodeLens(range, {
        title: '$(trash)',
        tooltip: '删除',
        command: 'quick-ops.anchor.delete',
        arguments: [anchor.id]
      }));
    }

    return lenses;
  }
}