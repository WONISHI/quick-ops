import * as vscode from 'vscode';
import * as path from 'path';
import { TextDecoder } from 'util';

import { ConfigurationService } from '../../common/services/configuration.service';
import { EditorContextService } from '../../common/services/editor-context.service';
import { AstParser } from '../../utils/AstParser';

import type { ExportState, ParseResult } from '../../core/types/export';

export class ProjectExportService {
  public static inject = [ConfigurationService, EditorContextService];

  private state: ExportState = {
    namedExports: [],
    defaultExport: [],
    selectedExports: [],
  };

  constructor(
    private readonly configurationService: ConfigurationService,
    private readonly editorContextService: EditorContextService,
  ) {}

  public async providePathCompletion(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): Promise<vscode.CompletionItem[]> {
    const linePrefix = document.lineAt(position).text.substring(0, position.character);
    const match = linePrefix.match(/^\s*(['"]?)([^'"]*)$/);

    if (!match) return [];

    const currentDocUri = document.uri;
    const enteredPath = match[2];

    let targetDirUri: vscode.Uri | null = null;
    let importBase = '';

    const aliases = this.getAliasConfig();
    const aliasKeys = Object.keys(aliases);

    const matchedAliasKey = aliasKeys
      .sort((a, b) => b.length - a.length)
      .find(key => enteredPath.startsWith(key));

    if (matchedAliasKey) {
      const workspaceFolder = vscode.workspace.getWorkspaceFolder(currentDocUri);

      if (!workspaceFolder) return [];

      const rootUri = workspaceFolder.uri;
      const aliasValue = aliases[matchedAliasKey];
      const aliasRootUri = vscode.Uri.joinPath(rootUri, ...this.toPathParts(aliasValue));
      const remainingPath = enteredPath.slice(matchedAliasKey.length);

      targetDirUri = vscode.Uri.joinPath(aliasRootUri, ...this.toPathParts(remainingPath));

      try {
        const stats = await vscode.workspace.fs.stat(targetDirUri);

        if ((stats.type & vscode.FileType.Directory) === 0) {
          targetDirUri = vscode.Uri.joinPath(targetDirUri, '..');
        }
      } catch {
        targetDirUri = vscode.Uri.joinPath(targetDirUri, '..');
      }

      const relativeFromAliasRoot = path.posix.relative(
        aliasRootUri.path,
        targetDirUri.path,
      );

      importBase = path.posix.join(matchedAliasKey, relativeFromAliasRoot);

      if (
        matchedAliasKey.endsWith('/') &&
        !importBase.endsWith('/') &&
        relativeFromAliasRoot === ''
      ) {
        importBase = matchedAliasKey;
      }
    } else if (enteredPath.startsWith('.') || enteredPath.startsWith('/')) {
      const currentDirUri = vscode.Uri.joinPath(currentDocUri, '..');

      targetDirUri = vscode.Uri.joinPath(currentDirUri, ...this.toPathParts(enteredPath));

      try {
        const stats = await vscode.workspace.fs.stat(targetDirUri);

        if ((stats.type & vscode.FileType.Directory) === 0) {
          targetDirUri = vscode.Uri.joinPath(targetDirUri, '..');
        }
      } catch {
        targetDirUri = vscode.Uri.joinPath(targetDirUri, '..');
      }

      const relativeBaseStr = path.posix.relative(currentDirUri.path, targetDirUri.path);

      importBase =
        relativeBaseStr === ''
          ? '.'
          : relativeBaseStr.startsWith('.')
            ? relativeBaseStr
            : `./${relativeBaseStr}`;
    } else {
      return [];
    }

    if (!targetDirUri) return [];

    let entries: Array<{
      name: string;
      isDirectory: boolean;
    }> = [];

    try {
      const dirents = await vscode.workspace.fs.readDirectory(targetDirUri);

      entries = dirents.map(([name, type]) => ({
        name,
        isDirectory: (type & vscode.FileType.Directory) !== 0,
      }));
    } catch {
      return [];
    }

    return entries.map(entry => {
      const item = new vscode.CompletionItem(
        entry.name,
        entry.isDirectory
          ? vscode.CompletionItemKind.Folder
          : vscode.CompletionItemKind.File,
      );

      item.insertText = entry.name;
      item.sortText = entry.isDirectory ? '0' : '1';

      if (!entry.isDirectory) {
        item.command = {
          command: 'quick-ops.onPathSelected',
          title: 'Path Selected',
          arguments: [
            {
              fileName: entry.name,
              parentPathUri: targetDirUri!.toString(),
              importBase,
              isDirectory: entry.isDirectory,
            },
          ],
        };
      }

      return item;
    });
  }

  public async handlePathSelected(args: {
    fileName: string;
    parentPathUri: string;
    importBase: string;
    isDirectory: boolean;
  }): Promise<void> {
    if (args.isDirectory) return;

    const parentUri = vscode.Uri.parse(args.parentPathUri);
    const fullUri = vscode.Uri.joinPath(parentUri, args.fileName);

    let parseResult: ParseResult = {
      namedExports: [],
      defaultExport: [],
    };

    let vueName: string | null = null;

    try {
      const contentBytes = await vscode.workspace.fs.readFile(fullUri);
      const content = new TextDecoder('utf-8').decode(contentBytes);
      const fileKey = fullUri.toString();

      parseResult = AstParser.parseExports(fileKey, content);
      vueName = AstParser.parseVueComponentName(fileKey, content);
    } catch (error) {
      console.error('[ProjectExportService] AST Parse Failed:', error);
    }

    if (args.fileName.endsWith('.vue')) {
      if (!vueName) {
        vueName = this.getVueNameFromFileName(parentUri, args.fileName);
      }

      if (vueName) {
        parseResult.defaultExport = [vueName];
      }
    }

    this.state = {
      namedExports: parseResult.namedExports,
      defaultExport: parseResult.defaultExport,
      selectedExports: [],
    };

    let finalPath = path.posix.join(args.importBase, args.fileName);

    finalPath = finalPath.replace(/\.(ts|js|vue|tsx|jsx|d\.ts)$/, '');

    const aliases = this.getAliasConfig();
    const isAliasPath = Object.keys(aliases).some(aliasKey =>
      finalPath.startsWith(aliasKey),
    );

    if (!isAliasPath && !finalPath.startsWith('.') && !finalPath.startsWith('/')) {
      finalPath = `./${finalPath}`;
    }

    const importStatement = this.generateImportStatement(finalPath, parseResult);

    await this.replaceCurrentImportLine(importStatement);

    if (importStatement.includes('{ }')) {
      setTimeout(() => {
        void vscode.commands.executeCommand('editor.action.triggerSuggest');
      }, 50);
    }
  }

  public provideExportCompletion(
    _document: vscode.TextDocument,
    _position: vscode.Position,
  ): vscode.CompletionItem[] {
    const availableNamed = this.state.namedExports.filter(
      item => !this.state.selectedExports.includes(item.name),
    );

    const items: vscode.CompletionItem[] = [];

    for (const exportItem of availableNamed) {
      const label: vscode.CompletionItemLabel = {
        label: exportItem.name,
        description: 'quick-ops',
      };

      const item = new vscode.CompletionItem(
        label,
        vscode.CompletionItemKind.Function,
      );

      item.sortText = '!';
      item.insertText = exportItem.name;
      item.preselect = true;
      item.detail = 'Auto Import';

      if (exportItem.code) {
        const markdown = new vscode.MarkdownString();
        markdown.appendCodeblock(exportItem.code, 'typescript');
        item.documentation = markdown;
      }

      item.command = {
        command: 'quick-ops.onFuncSelected',
        title: '',
        arguments: [exportItem.name],
      };

      items.push(item);
    }

    if (this.state.defaultExport.length > 0) {
      const defaultName = this.state.defaultExport[0];
      const item = new vscode.CompletionItem(
        defaultName,
        vscode.CompletionItemKind.Variable,
      );

      item.detail = '(Default Export)';
      item.sortText = '!';
      item.preselect = true;

      items.push(item);
    }

    return items;
  }

  public resolveExportCompletion(
    item: vscode.CompletionItem,
  ): vscode.CompletionItem {
    return item;
  }

  public handleFuncSelected(name: string): void {
    if (!this.state.selectedExports.includes(name)) {
      this.state.selectedExports.push(name);
    }
  }

  private getAliasConfig(): Record<string, string> {
    const config = this.configurationService.config;
    const projectConfig = config?.project || {};

    return projectConfig.alias || {
      '@/': './src/',
    };
  }

  private generateImportStatement(
    relativePath: string,
    exports: ParseResult,
  ): string {
    if (exports.defaultExport.length > 0) {
      return `import ${exports.defaultExport[0]} from '${relativePath}';`;
    }

    if (exports.namedExports.length > 0) {
      return `import { } from '${relativePath}';`;
    }

    return `import '${relativePath}';`;
  }

  private async replaceCurrentImportLine(newText: string): Promise<void> {
    const { editor, cursorPos } = this.editorContextService.getActiveEditorInfo();

    if (!editor || !cursorPos) return;

    const lineRange = editor.document.lineAt(cursorPos.line).range;

    await editor.edit(editBuilder => {
      editBuilder.replace(lineRange, newText);
    });

    if (newText.includes('{ }')) {
      const braceIndex = newText.indexOf('{');
      const newPosition = new vscode.Position(cursorPos.line, braceIndex + 2);

      editor.selection = new vscode.Selection(newPosition, newPosition);
      return;
    }

    const newPosition = new vscode.Position(cursorPos.line, newText.length);
    editor.selection = new vscode.Selection(newPosition, newPosition);
  }

  private getVueNameFromFileName(parentUri: vscode.Uri, fileName: string): string | null {
    const ext = path.posix.extname(fileName);
    const baseName = path.posix.basename(fileName, ext);

    let rawName =
      baseName.toLowerCase() === 'index'
        ? path.posix.basename(parentUri.path)
        : baseName;

    if (!rawName) return null;

    rawName = rawName
      .replace(/[-_]+(\w)/g, (_, char: string) => char.toUpperCase())
      .replace(/^[a-z]/, char => char.toUpperCase());

    return rawName;
  }

  private toPathParts(value: string): string[] {
    return value
      .replace(/\\/g, '/')
      .split('/')
      .filter(Boolean);
  }
}