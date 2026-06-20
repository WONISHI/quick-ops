import * as vscode from 'vscode';
import { debounce } from 'lodash-es';
import { ConfigurationService } from '../../common/services/configuration.service';

export interface MarkStyle {
  backgroundColor: string;
  color?: string;
  fontWeight?: string;
  borderRadius?: string;
}

type DecorationPair = {
  text: vscode.TextEditorDecorationType;
};

export class MarkDecorationService {
  public static inject = [ConfigurationService];

  private readonly decorationTypes = new Map<string, DecorationPair>();
  private markRegex: RegExp | null = null;
  private marksConfigCache: Record<string, MarkStyle> = {};

  private readonly commentPatterns: RegExp[] = [
    /\/\/\s*$/,
    /\/\*\s*$/,
    /\*\s*$/,
    /<!--\s*$/,
    /#\s*$/,
    /\{\/\*\s*$/,
  ];

  private readonly debouncedUpdateDecorations = debounce(() => {
    this.triggerUpdateDecorations();
  }, 80);

  constructor(private readonly configurationService: ConfigurationService) {}

  public async reloadDecorations(): Promise<void> {
    this.disposeDecorations();

    this.marksConfigCache = this.getMarksConfig();

    for (const [markText, style] of Object.entries(this.marksConfigCache)) {
      const textDecoration = vscode.window.createTextEditorDecorationType({
        backgroundColor: style.backgroundColor,
        color: style.color || '#fff',
        fontWeight: style.fontWeight || '800',
        letterSpacing: '0.15px',
        borderRadius: style.borderRadius || '6px',
        textDecoration: `
          none;
          padding: 1px 6px;
        `,
        rangeBehavior: vscode.DecorationRangeBehavior.ClosedOpen,
      });

      this.decorationTypes.set(markText, {
        text: textDecoration,
      });
    }

    this.buildMarkRegex();
    this.triggerUpdateDecorations();
  }

  public updateDecorationsDebounced(): void {
    this.debouncedUpdateDecorations();
  }

  public provideMarkCompletions(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): vscode.CompletionItem[] | undefined {
    const lineText = document.lineAt(position).text;
    const prefix = lineText.substring(0, position.character);
    const atIndex = prefix.lastIndexOf('@');

    if (atIndex === -1) return undefined;

    const beforeAt = prefix.substring(0, atIndex);

    if (!this.isValidCommentStart(beforeAt)) return undefined;

    const replaceRange = new vscode.Range(
      position.line,
      atIndex,
      position.line,
      position.character,
    );

    return Object.keys(this.marksConfigCache).map(markText => {
      const item = new vscode.CompletionItem(
        {
          label: markText,
          description: `quick-ops/${markText}`,
        },
        vscode.CompletionItemKind.Color,
      );

      item.detail = `Mark: ${markText}:`;
      item.range = replaceRange;
      item.insertText = `${markText}: `;
      item.sortText = '!';

      return item;
    });
  }

  public dispose(): void {
    this.debouncedUpdateDecorations.cancel();
    this.disposeDecorations();
  }

  private triggerUpdateDecorations(): void {
    const editor = vscode.window.activeTextEditor;

    if (!editor || !this.markRegex) return;

    const document = editor.document;
    const text = document.getText();
    const rangesMap: Record<string, vscode.Range[]> = {};

    for (const key of Object.keys(this.marksConfigCache)) {
      rangesMap[key] = [];
    }

    this.markRegex.lastIndex = 0;

    let match: RegExpExecArray | null;

    while ((match = this.markRegex.exec(text))) {
      const matchedText = match[0];
      const markKey = matchedText.slice(0, -1);
      const startPos = document.positionAt(match.index);
      const lineText = document.lineAt(startPos.line).text;
      const beforeMatch = lineText.substring(0, startPos.character);

      if (!this.isValidCommentStart(beforeMatch)) continue;

      rangesMap[markKey].push(
        new vscode.Range(
          startPos,
          document.positionAt(match.index + matchedText.length),
        ),
      );
    }

    for (const [markText, decos] of this.decorationTypes.entries()) {
      editor.setDecorations(decos.text, rangesMap[markText] || []);
    }
  }

  private buildMarkRegex(): void {
    const keys = Object.keys(this.marksConfigCache);

    if (!keys.length) {
      this.markRegex = null;
      return;
    }

    this.markRegex = new RegExp(
      keys
        .map(key => this.escapeRegExp(key))
        .sort((a, b) => b.length - a.length)
        .map(key => `${key}:`)
        .join('|'),
      'g',
    );
  }

  private isValidCommentStart(text: string): boolean {
    const trimmed = text.trimEnd();

    if (this.commentPatterns.some(pattern => pattern.test(trimmed))) {
      return true;
    }

    return (
      Math.max(
        trimmed.lastIndexOf('//'),
        trimmed.lastIndexOf('/*'),
        trimmed.lastIndexOf('{/*'),
        trimmed.lastIndexOf('<!--'),
        trimmed.lastIndexOf('#'),
      ) !== -1
    );
  }

  private escapeRegExp(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private getMarksConfig(): Record<string, MarkStyle> {
    const defaultMarks: Record<string, MarkStyle> = {
      '@success': {
        backgroundColor: '#22C55E',
        color: '#FFFFFF',
      },
      '@warning': {
        backgroundColor: '#F59E0B',
        color: '#FFFFFF',
      },
      '@error': {
        backgroundColor: '#EF4444',
        color: '#FFFFFF',
      },
      '@todo': {
        backgroundColor: '#FACC15',
        color: '#111827',
      },
      '@note': {
        backgroundColor: '#06B6D4',
        color: '#FFFFFF',
      },
      '@blocker': {
        backgroundColor: '#B91C1C',
        color: '#FFFFFF',
      },
      '@xxx': {
        backgroundColor: '#9333EA',
        color: '#FFFFFF',
      },
    };

    const userMarks = this.configurationService.config.project?.marks || {};
    const finalMarks: Record<string, MarkStyle> = { ...defaultMarks };

    for (const [key, style] of Object.entries(userMarks)) {
      const markStyle = style as Partial<MarkStyle>;

      finalMarks[key] = finalMarks[key]
        ? {
            ...finalMarks[key],
            ...markStyle,
          }
        : {
            backgroundColor: markStyle.backgroundColor || '#64748B',
            color: markStyle.color || '#FFFFFF',
            fontWeight: markStyle.fontWeight,
            borderRadius: markStyle.borderRadius,
          };
    }

    return finalMarks;
  }

  private disposeDecorations(): void {
    for (const decos of this.decorationTypes.values()) {
      decos.text.dispose();
    }

    this.decorationTypes.clear();
  }
}