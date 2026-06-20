import * as vscode from 'vscode';
import { ExtensionContextProvider } from '../../common/providers/extension-context.provider';
import { WorkspaceContextService } from '../../common/services/workspace-context.service';
import type {
  UIAttribute,
  UIComponent,
  UILibraryGroup,
} from './component-intellisense.type';

export class ComponentIntellisenseService {
  public static inject = [ExtensionContextProvider, WorkspaceContextService];

  private components: UIComponent[] = [];
  private tagToComponentMap = new Map<string, UIComponent>();

  constructor(
    private readonly extensionContextProvider: ExtensionContextProvider,
    private readonly workspaceContextService: WorkspaceContextService,
  ) {}

  public async init(): Promise<void> {
    await this.workspaceContextService.waitUntilReady();
    await this.reload();
  }

  public async reload(): Promise<void> {
    this.components = [];
    this.tagToComponentMap.clear();

    await this.loadSnippetsFromResources();
  }

  public getComponents(): UIComponent[] {
    return [...this.components];
  }

  public getComponentByTag(tag: string): UIComponent | undefined {
    return this.tagToComponentMap.get(tag);
  }

  public toKebabCase(value: string): string {
    return value.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
  }

  public buildAttributeMarkdown(attr: UIAttribute): vscode.MarkdownString {
    let md = `**${attr.name}**\n\n${attr.description}\n\n`;

    md += `**类型**: \`${attr.type}\` | **默认值**: \`${attr.default || '—'}\`\n\n`;

    if (attr.options && attr.options.length > 0) {
      md += `**可选值说明**:\n\n`;

      attr.options.forEach(option => {
        md += `- \`${option.value}\` ${
          option.description ? `— ${option.description}` : ''
        }\n`;
      });
    }

    const markdown = new vscode.MarkdownString(md);

    markdown.supportHtml = true;

    return markdown;
  }

  public buildFullComponentMarkdown(
    comp: UIComponent,
    tag: string,
  ): vscode.MarkdownString {
    let doc = `## ${tag}\n${comp.description}\n\n`;

    if (comp.link) {
      doc += `[查看官方文档](${comp.link})\n\n---\n\n`;
    }

    if (comp.attributes && comp.attributes.length > 0) {
      doc += `### 属性 (Attributes)\n\n`;
      doc += `| 参数 | 说明 | 类型 | 可选值 | 默认值 |\n`;
      doc += `| :---: | :---: | :---: | :---: | :---: |\n`;

      comp.attributes.forEach(attr => {
        const optStr =
          attr.options
            ?.map(option => `\`${this.escapeMarkdownTablePipe(option.value)}\``)
            .join(', ') || '—';

        const typeStr = this.escapeMarkdownTablePipe(String(attr.type));
        const defaultStr = this.escapeMarkdownTablePipe(attr.default || '—');
        const descStr = this.escapeMarkdownTablePipe(attr.description);

        doc += `| **${attr.name}** | ${descStr} | \`${typeStr}\` | ${optStr} | \`${defaultStr}\` |\n`;
      });
    }

    if (comp.events && comp.events.length > 0) {
      doc += `\n### 事件 (Events)\n\n`;
      doc += `| 事件名 | 说明 | 回调参数 |\n`;
      doc += `| :---: | :---: | :---: |\n`;

      comp.events.forEach(event => {
        const descStr = this.escapeMarkdownTablePipe(event.description);
        const paramStr = this.escapeMarkdownTablePipe(event.parameters || '—');

        doc += `| **${event.name}** | ${descStr} | \`${paramStr}\` |\n`;
      });
    }

    if (comp.slots && comp.slots.length > 0) {
      doc += `\n### 插槽 (Slots)\n\n`;
      doc += `| 插槽名 | 说明 |\n`;
      doc += `| :---: | :---: |\n`;

      comp.slots.forEach(slot => {
        const descStr = this.escapeMarkdownTablePipe(slot.description);

        doc += `| **${slot.name}** | ${descStr} |\n`;
      });
    }

    if (comp.methods && comp.methods.length > 0) {
      doc += `\n### 实例方法 (Methods)\n\n`;
      doc += `| 方法名 | 说明 | 参数 |\n`;
      doc += `| :---: | :---: | :---: |\n`;

      comp.methods.forEach(method => {
        const descStr = this.escapeMarkdownTablePipe(method.description);
        const paramStr = this.escapeMarkdownTablePipe(method.parameters || '—');

        doc += `| **${method.name}** | ${descStr} | \`${paramStr}\` |\n`;
      });
    }

    const markdown = new vscode.MarkdownString(doc);

    markdown.supportHtml = true;

    return markdown;
  }

  public getCurrentTagForHover(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): string | null {
    const lineNumber = position.line;
    const charNumber = position.character;

    for (let lineIndex = lineNumber; lineIndex >= Math.max(0, lineNumber - 10); lineIndex--) {
      const lineText = document.lineAt(lineIndex).text;
      const endChar = lineIndex === lineNumber ? charNumber : lineText.length;
      const chunk = lineText.substring(0, endChar);

      const lastOpenIndex = chunk.lastIndexOf('<');
      const lastCloseIndex = chunk.lastIndexOf('>');

      if (lastOpenIndex > lastCloseIndex) {
        const tagMatch = chunk.substring(lastOpenIndex).match(/<([\w-]+)/);

        if (tagMatch) {
          const tagName = tagMatch[1];

          if (tagName.toLowerCase() === 'template') {
            return this.getNearestTag(
              document,
              new vscode.Position(lineIndex, lastOpenIndex),
            );
          }

          return tagName;
        }
      }
    }

    return this.getNearestTag(document, position);
  }

  public getNearestTag(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): string | null {
    const startLine = Math.max(0, position.line - 30);

    const text = document.getText(
      new vscode.Range(new vscode.Position(startLine, 0), position),
    );

    const tagRegex = /<\/?([\w-]+)/g;
    const tags: string[] = [];

    let match: RegExpExecArray | null;

    while ((match = tagRegex.exec(text)) !== null) {
      tags.push(match[0]);
    }

    let depth = 0;

    for (let index = tags.length - 1; index >= 0; index--) {
      const tag = tags[index];

      if (tag.startsWith('</')) {
        depth++;
        continue;
      }

      if (depth > 0) {
        depth--;
        continue;
      }

      const tagName = tag.substring(1);

      if (tagName.toLowerCase() === 'template') {
        continue;
      }

      return tagName;
    }

    return null;
  }

  public async exportSnippetsToWorkspace(): Promise<void> {
    const workspaceFolders = vscode.workspace.workspaceFolders;

    if (!workspaceFolders || this.components.length === 0) {
      vscode.window.showWarningMessage('没有可导出的 UI 代码片段');
      return;
    }

    try {
      const vscodeDirUri = vscode.Uri.joinPath(workspaceFolders[0].uri, '.vscode');

      const targetFileUri = vscode.Uri.joinPath(
        vscodeDirUri,
        'quick-ops-ui.code-snippets',
      );

      const vsCodeNativeSnippets: Record<
        string,
        {
          prefix: string;
          body: string[];
          description: string;
        }
      > = {};

      for (const comp of this.components) {
        for (const tag of comp.tags) {
          vsCodeNativeSnippets[`${comp.description} (${tag})`] = {
            prefix: tag,
            body: comp.snippet.replace(/\$TAG/g, tag).split('\n'),
            description: comp.description,
          };
        }
      }

      await vscode.workspace.fs.createDirectory(vscodeDirUri);

      await vscode.workspace.fs.writeFile(
        targetFileUri,
        Buffer.from(JSON.stringify(vsCodeNativeSnippets, null, 2), 'utf8'),
      );

      const doc = await vscode.workspace.openTextDocument(targetFileUri);

      await vscode.window.showTextDocument(doc);

      vscode.window.showInformationMessage('UI 库基础代码片段已成功导出！');
    } catch (error) {
      vscode.window.showErrorMessage(`导出失败: ${this.toErrorMessage(error)}`);
    }
  }

  public dispose(): void {
    this.components = [];
    this.tagToComponentMap.clear();
  }

  private async loadSnippetsFromResources(): Promise<void> {
    const context = this.extensionContextProvider.getContext();

    const snippetsDirUri = vscode.Uri.joinPath(
      context.extensionUri,
      'resources',
      'ui-snippets',
    );

    let files: [string, vscode.FileType][];

    try {
      files = await vscode.workspace.fs.readDirectory(snippetsDirUri);
    } catch {
      return;
    }

    const libraryGroups: Record<string, UILibraryGroup> = {};

    files.forEach(([fileName, fileType]) => {
      if (fileType !== vscode.FileType.File) return;
      if (!fileName.endsWith('.json')) return;

      const match = fileName.match(/^(.+?)(?:@v(\d+))?\.json$/);

      if (!match) return;

      const [, baseName, version] = match;

      if (!libraryGroups[baseName]) {
        libraryGroups[baseName] = {
          versions: {},
        };
      }

      if (version) {
        libraryGroups[baseName].versions[version] = fileName;
      } else {
        libraryGroups[baseName].unversioned = fileName;
      }
    });

    const workspaceContext = this.workspaceContextService.context;
    const dependencies = workspaceContext.dependencies || {};

    for (const [baseName, group] of Object.entries(libraryGroups)) {
      const configKey = this.toUseConfigKey(baseName);

      const isEnabled = vscode.workspace
        .getConfiguration('quick-ops.general.use')
        .get<boolean>(configKey, true);

      if (!isEnabled) {
        continue;
      }

      const dependencyVersionString = dependencies[baseName];

      if (!dependencyVersionString) {
        continue;
      }

      const installedMajorVersion = this.getMajorVersion(
        String(dependencyVersionString),
      );

      let targetFileToLoad: string | undefined;

      if (
        installedMajorVersion &&
        group.versions[installedMajorVersion]
      ) {
        targetFileToLoad = group.versions[installedMajorVersion];
      } else if (group.unversioned) {
        targetFileToLoad = group.unversioned;
      }

      if (!targetFileToLoad) {
        continue;
      }

      const targetFileUri = vscode.Uri.joinPath(
        snippetsDirUri,
        targetFileToLoad,
      );

      try {
        const fileData = await vscode.workspace.fs.readFile(targetFileUri);
        const content = Buffer.from(fileData).toString('utf8');
        const parsed = JSON.parse(content) as UIComponent[];

        if (!Array.isArray(parsed)) continue;

        this.components.push(...parsed);

        parsed.forEach(component => {
          component.tags.forEach(tag => {
            this.tagToComponentMap.set(tag, component);
          });
        });
      } catch {
        // 单个片段文件失败不影响其它 UI 库
      }
    }
  }

  private toUseConfigKey(baseName: string): string {
    return baseName
      .split('-')
      .map(word => {
        return word.charAt(0).toUpperCase() + word.slice(1);
      })
      .join('');
  }

  private getMajorVersion(version: string): string | null {
    const match = version.match(/(?:^|[^\d])(\d+)\./);

    return match ? match[1] : null;
  }

  private escapeMarkdownTablePipe(text: string): string {
    if (!text) return '';

    return text.replace(/\|/g, '\\|');
  }

  private toErrorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    if (typeof error === 'string') return error;

    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }
}