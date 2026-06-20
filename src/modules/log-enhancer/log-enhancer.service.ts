import * as vscode from 'vscode';
import { LogHelper } from '../../utils/LogHelper';
import { ConfigurationService } from '../../common/services/configuration.service';
import { WorkspaceStateService } from '../../common/services/workspace-state.service';

export class LogEnhancerService {
  public static inject = [ConfigurationService, WorkspaceStateService];

  constructor(
    private readonly configurationService: ConfigurationService,
    private readonly workspaceStateService: WorkspaceStateService,
  ) {}

  public shouldTriggerSuggest(lineText: string): boolean {
    return /(\b(?:log|cg|cng|lg))(?:\??(?:>|>>).*|$)/.test(lineText);
  }

  public provideLogs(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): vscode.CompletionList {
    const lineText = document.lineAt(position.line).text.substring(0, position.character);

    /**
     * 复杂模式：
     *
     * log>foo
     * log>>foo
     * log?>foo
     */
    const complexMatch = lineText.match(/(\b(?:log|cg|cng|lg))(\??)((?:>|>>).*)$/);

    if (complexMatch) {
      const prefix = complexMatch[1];
      const modeSymbol = complexMatch[2];
      const remainder = complexMatch[3];
      const isRawMode = modeSymbol === '?';
      const matchLength = complexMatch[0].length;

      const item = this.generateComplexItem(
        document,
        position,
        prefix,
        remainder,
        isRawMode,
        matchLength,
      );

      return new vscode.CompletionList([item], true);
    }

    /**
     * 基础模式：
     *
     * log
     * cg
     * cng
     * lg
     */
    const simpleMatch = lineText.match(/(\b(?:log|cg|cng|lg))$/);

    if (simpleMatch) {
      const prefix = simpleMatch[1];
      const matchLength = simpleMatch[0].length;
      const item = this.generateSimpleItem(position, prefix, matchLength);

      return new vscode.CompletionList([item], false);
    }

    return new vscode.CompletionList([], false);
  }

  private generateSimpleItem(
    position: vscode.Position,
    prefix: string,
    matchLength: number,
  ): vscode.CompletionItem {
    const ctx = this.getLogContext(position);
    const templateStr = this.getLoggerTemplate();
    const baseArgs = LogHelper.parseTemplate(
      templateStr,
      ctx,
      this.configurationService.config as any,
    );

    const argsString = baseArgs
      .map(arg => {
        if (arg === '$0') return '$0';

        return `'${this.escapeSingleQuote(arg)}'`;
      })
      .join(', ');

    const insertText = `console.log(${argsString});`;

    const item = new vscode.CompletionItem(
      {
        label: prefix,
        description: `quick-ops/${prefix}`,
      },
      vscode.CompletionItemKind.Snippet,
    );

    item.detail = '从"quick-ops"导入添加';
    item.insertText = new vscode.SnippetString(insertText);
    item.documentation = new vscode.MarkdownString().appendCodeblock(
      insertText,
      'javascript',
    );

    item.range = new vscode.Range(
      position.line,
      position.character - matchLength,
      position.line,
      position.character,
    );

    item.sortText = '0';
    item.preselect = true;

    return item;
  }

  private generateComplexItem(
    _document: vscode.TextDocument,
    position: vscode.Position,
    prefix: string,
    remainder: string,
    isRawMode: boolean,
    matchLength: number,
  ): vscode.CompletionItem {
    const parsedArgs = this.parseComplexArgs(remainder);
    const ctx = this.getLogContext(position);

    let finalArgs: string[];

    if (isRawMode) {
      finalArgs = [...parsedArgs];
    } else {
      const templateStr = this.getLoggerTemplate();
      const baseArgs = LogHelper.parseTemplate(
        templateStr,
        ctx,
        this.configurationService.config as any,
      );

      finalArgs = this.injectFinalArgs(baseArgs, parsedArgs);
    }

    const insertText = `console.log(${finalArgs.join(', ')});`;
    const displayLabel = `${prefix}${isRawMode ? '?' : ''}${remainder}`;

    const item = new vscode.CompletionItem(
      {
        label: displayLabel,
        description: 'quick-ops',
      },
      vscode.CompletionItemKind.Snippet,
    );

    item.detail = 'console.log(...)';
    item.insertText = new vscode.SnippetString(insertText);

    item.range = new vscode.Range(
      position.line,
      position.character - matchLength,
      position.line,
      position.character,
    );

    item.filterText = displayLabel;
    item.sortText = '!';
    item.preselect = true;

    return item;
  }

  private parseComplexArgs(remainder: string): string[] {
    const trimmed = remainder.trim();

    if (trimmed === '>' || trimmed === '>>') {
      return [];
    }

    const parserRegex = /(>>?)([^>]*)/g;
    const parsedArgs: string[] = [];

    let match: RegExpExecArray | null;

    while ((match = parserRegex.exec(remainder)) !== null) {
      const operator = match[1];
      const content = match[2].trim();

      if (!content) continue;

      if (operator === '>>') {
        parsedArgs.push(`'${this.escapeSingleQuote(content)}'`);
      } else {
        parsedArgs.push(content);
      }
    }

    return parsedArgs;
  }

  private injectFinalArgs(baseArgs: string[], formattedInputs: string[]): string[] {
    if (formattedInputs.length === 0) {
      return baseArgs.map(arg => {
        if (arg === '$0') return '$0';

        return `'${this.escapeSingleQuote(arg)}'`;
      });
    }

    let hasReplaced = false;

    const newArgs = baseArgs.flatMap(arg => {
      if (arg === '$0') {
        hasReplaced = true;
        return formattedInputs;
      }

      return [`'${this.escapeSingleQuote(arg)}'`];
    });

    if (!hasReplaced) {
      newArgs.push(...formattedInputs);
    }

    return newArgs;
  }

  private getLoggerTemplate(): string {
    return this.configurationService.config.logger.template || '[icon]-[line]-[$0]';
  }

  private getLogContext(position: vscode.Position): {
    line: number;
    fileName: string;
    filePath: string;
    rootPath: string;
  } {
    return {
      line: position.line,
      fileName: this.workspaceStateService.state.fileName || 'unknown',
      filePath: this.workspaceStateService.state.uri?.fsPath || '',
      rootPath: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '',
    };
  }

  private escapeSingleQuote(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  }
}