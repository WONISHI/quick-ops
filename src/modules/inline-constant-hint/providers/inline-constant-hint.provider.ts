import * as vscode from 'vscode';
import {
  InlineConstantHintEntry,
  InlineConstantHintService,
} from '../inline-constant-hint.service';

export class InlineConstantHintProvider implements vscode.InlayHintsProvider {
  public static inject = [InlineConstantHintService];

  private readonly changeEmitter = new vscode.EventEmitter<void>();

  public readonly onDidChangeInlayHints = this.changeEmitter.event;

  constructor(
    private readonly inlineConstantHintService: InlineConstantHintService,
  ) {}

  public provideInlayHints(
    document: vscode.TextDocument,
    range: vscode.Range,
    _token: vscode.CancellationToken,
  ): vscode.InlayHint[] {
    if (!this.inlineConstantHintService.shouldHandleDocument(document)) {
      return [];
    }

    const entries = this.inlineConstantHintService.getHints(document);

    if (entries.length === 0) return [];

    const text = document.getText(range);
    const hints: vscode.InlayHint[] = [];
    const maxHints = this.inlineConstantHintService.getMaxHintsPerDocument();

    for (const entry of entries) {
      if (hints.length >= maxHints) break;

      this.collectHintsForEntry(document, range, text, entry, hints, maxHints);
    }

    return hints;
  }

  public refresh(): void {
    this.changeEmitter.fire();
  }

  public dispose(): void {
    this.changeEmitter.dispose();
  }

  private collectHintsForEntry(
    document: vscode.TextDocument,
    range: vscode.Range,
    text: string,
    entry: InlineConstantHintEntry,
    hints: vscode.InlayHint[],
    maxHints: number,
  ): void {
    const escapedName = this.escapeRegExp(entry.name);

    /**
     * 常量：
     *   STATUS_SUCCESS
     *
     * 枚举/对象：
     *   Status.Success
     *   STATUS_MAP.SUCCESS
     */
    const reg =
      entry.name.includes('.')
        ? new RegExp(`(?<![\\w$])${escapedName}(?![\\w$])`, 'g')
        : new RegExp(`(?<![\\w$])${escapedName}(?![\\w$])`, 'g');

    let match: RegExpExecArray | null;

    while ((match = reg.exec(text))) {
      if (hints.length >= maxHints) break;

      const absoluteStartOffset = document.offsetAt(range.start) + match.index;
      const absoluteEndOffset = absoluteStartOffset + match[0].length;
      const position = document.positionAt(absoluteEndOffset);

      if (this.shouldSkipMatch(document, position, entry)) {
        continue;
      }

      const hint = new vscode.InlayHint(
        position,
        ` = ${entry.value}`,
        vscode.InlayHintKind.Type,
      );

      hint.paddingLeft = true;
      hint.paddingRight = true;
      hint.tooltip = this.createTooltip(entry);

      hints.push(hint);
    }
  }

  private shouldSkipMatch(
    document: vscode.TextDocument,
    position: vscode.Position,
    entry: InlineConstantHintEntry,
  ): boolean {
    const lineText = document.lineAt(position.line).text;

    /**
     * 声明行不显示：
     * const STATUS = 'xxx'
     * enum Status { Success = 'success' }
     */
    if (position.line === entry.declarationLine) {
      return true;
    }

    /**
     * import / export 类型行不显示。
     */
    if (/^\s*(import|export)\s+/.test(lineText)) {
      return true;
    }

    /**
     * 注释行不显示。
     */
    if (/^\s*\/\//.test(lineText) || /^\s*\*/.test(lineText)) {
      return true;
    }

    /**
     * 对象 key 声明不显示：
     * STATUS_SUCCESS: xxx
     */
    const beforeText = lineText.slice(0, position.character);

    if (new RegExp(`${this.escapeRegExp(entry.name)}\\s*:\\s*$`).test(beforeText)) {
      return true;
    }

    return false;
  }

  private createTooltip(entry: InlineConstantHintEntry): vscode.MarkdownString {
    const markdown = new vscode.MarkdownString();

    markdown.supportThemeIcons = true;
    markdown.appendMarkdown(`**QuickOps 常量提示**\n\n`);
    markdown.appendMarkdown(`- 名称：\`${entry.name}\`\n`);
    markdown.appendMarkdown(`- 值：\`${entry.value}\`\n`);
    markdown.appendMarkdown(`- 类型：\`${entry.kind}\`\n`);

    return markdown;
  }

  private escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}