import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { IFeature } from '../core/interfaces/IFeature';
import { WorkspaceContextService } from '../services/WorkspaceContextService';

// ==========================================
// 工具函数：驼峰转短横线 (kebab-case)
// ==========================================
function toKebabCase(str: string): string {
  return str.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}

// ==========================================
// 标准化数据接口
// ==========================================
export interface UIOption {
  value: string;
  description?: string;
}

export interface UIAttribute {
  name: string;
  description: string;
  type: 'boolean' | 'string' | 'number' | 'enum' | 'any';
  default?: string;
  options?: UIOption[];
}

export interface UIEvent {
  name: string;
  description: string;
  parameters?: string;
}

export interface UISlot {
  name: string;
  description: string;
}

export interface UIMethod {
  name: string;
  description: string;
  parameters?: string;
}

export interface UIComponent {
  tags: string[];
  description: string;
  snippet: string;
  link?: string;
  attributes?: UIAttribute[];
  events?: UIEvent[];
  slots?: UISlot[];
  methods?: UIMethod[];
}

export class ComponentIntellisenseFeature implements IFeature {
  public readonly id = 'ComponentIntellisenseFeature';

  private components: UIComponent[] = [];
  private tagToComponentMap: Map<string, UIComponent> = new Map();
  private providerDisposable?: vscode.Disposable;
  private hoverDisposable?: vscode.Disposable;

  constructor(private contextService: WorkspaceContextService = WorkspaceContextService.getInstance()) {}

  public async activate(context: vscode.ExtensionContext) {
    await this.contextService.waitUntilReady();
    this.loadSnippetsFromResources(context);

    const contextChangeDisposable = this.contextService.onDidChangeContext(() => {
      console.log('[Quick Ops] 监听到项目依赖发生变化，正在重新挂载 UI 提示库...');
      this.reload(context);
    });

    // ==========================================
    // 注册代码补全 (Completion)
    // ==========================================
    this.providerDisposable = vscode.languages.registerCompletionItemProvider(
      ['vue', 'html', 'javascriptreact', 'typescriptreact'],
      {
        provideCompletionItems: (document: vscode.TextDocument, position: vscode.Position): vscode.CompletionItem[] | undefined => {
          // 1. 获取当前行光标前的文本 (用于判断当前正在敲击的属性名/事件名)
          const lineTextBeforeCursor = document.lineAt(position.line).text.substring(0, position.character);
          
          // 2. 🌟 核心修复：向上获取最多 15 行的文本，用于跨行匹配组件标签名
          const startLine = Math.max(0, position.line - 15);
          const multiLineTextBeforeCursor = document.getText(new vscode.Range(new vscode.Position(startLine, 0), position));

          const completionItems: vscode.CompletionItem[] = [];

          // 3. 🌟 跨行正则匹配：寻找最近的 <标签名，且中间没有被 > 闭合
          const insideTagMatch = multiLineTextBeforeCursor.match(/<([\w-]+)[^>]*$/);

          if (insideTagMatch) {
            const currentTag = insideTagMatch[1];
            let comp = this.tagToComponentMap.get(currentTag);

            // 提取当前行光标前正在输入的单词 (例如 @cl, :pro, #he)
            const currentWordMatch = lineTextBeforeCursor.match(/(?:^|\s)([@#:]?[\w-]*)$/);
            const currentWord = currentWordMatch ? currentWordMatch[1] : '';
            const replaceRange = new vscode.Range(position.line, position.character - currentWord.length, position.line, position.character);

            if (currentWord.startsWith('@')) {
              if (comp && comp.events) {
                comp.events.forEach((ev) => {
                  const label = `@${ev.name}`;
                  const item = new vscode.CompletionItem(label, vscode.CompletionItemKind.Event);
                  const handlerName = `on${ev.name.charAt(0).toUpperCase() + ev.name.slice(1)}`;

                  item.insertText = new vscode.SnippetString(`${label}="\${1:${handlerName}}"`);
                  item.range = replaceRange;
                  item.filterText = label;
                  item.sortText = `  ${ev.name}`;
                  
                  const md = new vscode.MarkdownString(`**<span style="color: #409EFF;">${label}</span>**\n\n${ev.description}\n\n**回调参数**: \`${ev.parameters || '—'}\``);
                  md.supportHtml = true;
                  item.documentation = md;
                  
                  item.detail = `[Event] ${ev.description}`;
                  completionItems.push(item);
                });
              }
              return completionItems;
            }

            if (currentWord.startsWith('#')) {
              if (currentTag.toLowerCase() === 'template') {
                const parentTag = this.getNearestTag(document, position);
                if (parentTag) comp = this.tagToComponentMap.get(parentTag);
              }
              if (comp && comp.slots) {
                comp.slots.forEach((slot) => {
                  const label = `#${slot.name}`;
                  const item = new vscode.CompletionItem(label, vscode.CompletionItemKind.Field);

                  item.insertText = new vscode.SnippetString(label);
                  item.range = replaceRange;
                  item.filterText = label;
                  item.sortText = `  ${slot.name}`;
                  
                  const md = new vscode.MarkdownString(`**<span style="color: #409EFF;">${label}</span>**\n\n${slot.description}`);
                  md.supportHtml = true;
                  item.documentation = md;
                  
                  item.detail = `[Slot] ${comp?.tags[0]}`;
                  completionItems.push(item);
                });
              }
              return completionItems;
            }

            if (comp && comp.attributes) {
              const isBind = currentWord.startsWith(':');
              const prefix = isBind ? ':' : '';

              comp.attributes.forEach((attr) => {
                const primaryAttrName = attr.name.split('/')[0].trim();
                const kebabName = toKebabCase(primaryAttrName);
                const label = `${prefix}${kebabName}`;
                
                const item = new vscode.CompletionItem(label, vscode.CompletionItemKind.Property);

                if (attr.type === 'boolean' && !isBind) {
                  item.insertText = kebabName;
                } else if (attr.options && attr.options.length > 0) {
                  const enumValues = attr.options.map((o) => o.value).join(',');
                  item.insertText = new vscode.SnippetString(`${label}="\${1|${enumValues}|}"`);
                } else {
                  item.insertText = new vscode.SnippetString(`${label}="$1"`);
                }

                item.range = replaceRange;
                item.filterText = label;
                item.sortText = `  ${kebabName}`;
                item.documentation = this.buildAttributeMarkdown(attr);
                item.detail = `[Prop] ${attr.name}`; 
                completionItems.push(item);
              });
            }
            return completionItems;
          }

          // 匹配组件标签自身 (<xxx)
          const tagMatch = lineTextBeforeCursor.match(/(<[a-zA-Z0-9-]*|[a-zA-Z0-9-]+)$/);
          if (tagMatch) {
            const matchString = tagMatch[1];
            const hasBracket = matchString.startsWith('<');
            const replaceRange = new vscode.Range(position.line, position.character - matchString.length, position.line, position.character);

            for (const comp of this.components) {
              for (const tag of comp.tags) {
                const item = new vscode.CompletionItem(tag, vscode.CompletionItemKind.Snippet);
                const snippetStr = comp.snippet.replace(/\$TAG/g, tag);

                item.insertText = new vscode.SnippetString(snippetStr);
                item.range = replaceRange;
                item.filterText = hasBracket ? `<${tag}` : tag;
                item.documentation = this.buildFullComponentMarkdown(comp, tag);
                item.detail = comp.description;
                item.sortText = `   ${tag}`;
                completionItems.push(item);
              }
            }
            return completionItems;
          }

          return undefined;
        },
      },
      '<', ' ', '@', ':', '-', '#'
    );

    // ==========================================
    // 注册悬停提示 (Hover)
    // ==========================================
    this.hoverDisposable = vscode.languages.registerHoverProvider(['vue', 'html', 'javascriptreact', 'typescriptreact'], {
      provideHover: (document: vscode.TextDocument, position: vscode.Position): vscode.Hover | undefined => {
        const wordRange = document.getWordRangeAtPosition(position, /[@#]?[\w:-]+/);
        if (!wordRange) return undefined;

        const word = document.getText(wordRange);

        let comp = this.tagToComponentMap.get(word);
        if (comp) {
          return new vscode.Hover(this.buildFullComponentMarkdown(comp, word), wordRange);
        }

        const currentTag = this.getCurrentTagForHover(document, position);
        if (!currentTag) return undefined;

        comp = this.tagToComponentMap.get(currentTag);
        if (!comp) return undefined;

        let cleanWord = word;
        let isEvent = false,
          isSlot = false;

        if (word.startsWith('@') || word.startsWith('v-on:')) {
          isEvent = true;
          cleanWord = word.replace(/^@|v-on:/, '');
        } else if (word.startsWith('#') || word.startsWith('v-slot:')) {
          isSlot = true;
          cleanWord = word.replace(/^#|v-slot:/, '');
        } else {
          cleanWord = word.replace(/^:|v-bind:|v-model:/, '');
        }

        if (isEvent && comp.events) {
          const ev = comp.events.find((e) => e.name === cleanWord);
          if (ev) {
            const md = new vscode.MarkdownString(`**<span style="color: #409EFF;">@${ev.name}</span>**\n\n${ev.description}\n\n**回调参数**: \`${ev.parameters || '—'}\``);
            md.supportHtml = true;
            return new vscode.Hover(md, wordRange);
          }
        }

        if (isSlot && comp.slots) {
          const slot = comp.slots.find((s) => s.name === cleanWord);
          if (slot) {
            const md = new vscode.MarkdownString(`**<span style="color: #409EFF;">#${slot.name}</span>**\n\n${slot.description}`);
            md.supportHtml = true;
            return new vscode.Hover(md, wordRange);
          }
        }

        if (comp.attributes && !isEvent && !isSlot) {
          const targetKebab = toKebabCase(cleanWord);
          
          const attr = comp.attributes.find((a) => {
            const attrNamesKebab = a.name.split('/').map(n => toKebabCase(n.trim()));
            return attrNamesKebab.includes(targetKebab);
          });
          
          if (attr) {
            return new vscode.Hover(this.buildAttributeMarkdown(attr), wordRange);
          }
        }

        return undefined;
      },
    });

    const exportCommand = vscode.commands.registerCommand('quick-ops.exportSnippets', async () => {
      await this.exportSnippetsToWorkspace();
    });

    context.subscriptions.push(this.providerDisposable, this.hoverDisposable, exportCommand, contextChangeDisposable);
  }

  private reload(context: vscode.ExtensionContext) {
    this.components = [];
    this.tagToComponentMap.clear();
    this.loadSnippetsFromResources(context);
  }

  private buildAttributeMarkdown(attr: UIAttribute): vscode.MarkdownString {
    let md = `**<span style="color: #409EFF;">${attr.name}</span>**\n\n${attr.description}\n\n`;
    md += `**类型**: \`${attr.type}\` | **默认值**: \`${attr.default || '—'}\`\n\n`;
    if (attr.options && attr.options.length > 0) {
      md += `**可选值说明**:\n\n`;
      attr.options.forEach((opt) => {
        md += `- \`${opt.value}\` ${opt.description ? '— ' + opt.description : ''}\n`;
      });
    }
    const mds = new vscode.MarkdownString(md);
    mds.supportHtml = true;
    return mds;
  }

  private buildFullComponentMarkdown(comp: UIComponent, tag: string): vscode.MarkdownString {
    let doc = `## ${tag}\n${comp.description}\n\n`;
    if (comp.link) doc += `[查看官方文档](${comp.link})\n\n---\n\n`;

    if (comp.attributes && comp.attributes.length > 0) {
      doc += `### 属性 (Attributes)\n\n`;
      doc += `| 参数 | 说明 | 类型 | 可选值 | 默认值 |\n| :---: | --- | --- | --- | --- |\n`;
      comp.attributes.forEach((a) => {
        const optStr = a.options?.map((o) => `\`${o.value}\``).join(', ') || '—';
        doc += `| <span style="color: #409EFF;">**${a.name}**</span> | ${a.description} | \`${a.type}\` | ${optStr} | \`${a.default || '—'}\` |\n`;
      });
    }

    if (comp.events && comp.events.length > 0) {
      doc += `\n### 事件 (Events)\n\n`;
      doc += `| 事件名 | 说明 | 回调参数 |\n| :---: | --- | --- |\n`;
      comp.events.forEach((e) => {
        doc += `| <span style="color: #409EFF;">**${e.name}**</span> | ${e.description} | \`${e.parameters || '—'}\` |\n`;
      });
    }

    if (comp.slots && comp.slots.length > 0) {
      doc += `\n### 插槽 (Slots)\n\n`;
      doc += `| 插槽名 | 说明 |\n| :---: | --- |\n`;
      comp.slots.forEach((s) => {
        doc += `| <span style="color: #409EFF;">**${s.name}**</span> | ${s.description} |\n`;
      });
    }

    if (comp.methods && comp.methods.length > 0) {
      doc += `\n### 实例方法 (Methods)\n\n`;
      doc += `| 方法名 | 说明 | 参数 |\n| :---: | --- | --- |\n`;
      comp.methods.forEach((m) => {
        doc += `| <span style="color: #409EFF;">**${m.name}**</span> | ${m.description} | \`${m.parameters || '—'}\` |\n`;
      });
    }

    const mds = new vscode.MarkdownString(doc);
    mds.supportHtml = true;
    return mds;
  }

  private getCurrentTagForHover(document: vscode.TextDocument, position: vscode.Position): string | null {
    let lineNum = position.line;
    let charNum = position.character;

    for (let i = lineNum; i >= Math.max(0, lineNum - 10); i--) {
      const lineText = document.lineAt(i).text;
      const endChar = i === lineNum ? charNum : lineText.length;
      const chunk = lineText.substring(0, endChar);

      const lastOpenIdx = chunk.lastIndexOf('<');
      const lastCloseIdx = chunk.lastIndexOf('>');

      if (lastOpenIdx > lastCloseIdx) {
        const tagMatch = chunk.substring(lastOpenIdx).match(/<([\w-]+)/);
        if (tagMatch) {
          const tagName = tagMatch[1];
          if (tagName.toLowerCase() === 'template') {
            return this.getNearestTag(document, new vscode.Position(i, lastOpenIdx));
          }
          return tagName;
        }
      }
    }

    return this.getNearestTag(document, position);
  }

  private getNearestTag(document: vscode.TextDocument, position: vscode.Position): string | null {
    const startLine = Math.max(0, position.line - 30);
    const text = document.getText(new vscode.Range(new vscode.Position(startLine, 0), position));
    const tagRegex = /<\/?([\w-]+)/g;
    let match;
    const tags: string[] = [];
    while ((match = tagRegex.exec(text)) !== null) {
      tags.push(match[0]);
    }

    let depth = 0;
    for (let i = tags.length - 1; i >= 0; i--) {
      const tag = tags[i];
      if (tag.startsWith('</')) {
        depth++;
      } else {
        if (depth > 0) {
          depth--;
        } else {
          const tagName = tag.substring(1);
          if (tagName.toLowerCase() === 'template') continue;
          return tagName;
        }
      }
    }
    return null;
  }

  private loadSnippetsFromResources(context: vscode.ExtensionContext) {
    const snippetsDir = path.join(context.extensionPath, 'resources', 'ui-snippets');
    if (!fs.existsSync(snippetsDir)) return;

    const files = fs.readdirSync(snippetsDir);
    const libraryGroups: Record<string, { unversioned?: string; versions: Record<string, string> }> = {};

    files.forEach((file) => {
      if (!file.endsWith('.json')) return;

      const match = file.match(/^(.+?)(?:@v(\d+))?\.json$/);
      if (!match) return;

      const [, baseName, version] = match;

      if (!libraryGroups[baseName]) {
        libraryGroups[baseName] = { versions: {} };
      }

      if (version) {
        libraryGroups[baseName].versions[version] = file;
      } else {
        libraryGroups[baseName].unversioned = file;
      }
    });

    const ctx = this.contextService.context;
    const dependencies = ctx.dependencies || {};

    for (const [baseName, group] of Object.entries(libraryGroups)) {
      const configKey = baseName
        .split('-')
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join('');

      const isEnabled = vscode.workspace.getConfiguration('quick-ops.general.use').get<boolean>(configKey, true);
      if (!isEnabled) {
        console.log(`[Quick Ops] 已拦截加载: ${baseName} (全局配置项 ${configKey} 未开启)`);
        continue;
      }

      const depVersionString = dependencies[baseName];
      if (!depVersionString) {
        console.log(`[Quick Ops] 已拦截加载: ${baseName} (当前项目 package.json 中未安装该依赖)`);
        continue;
      }

      let installedMajorVersion: string | null = null;

      const majorMatch = depVersionString.match(/(?:^|[^\d])(\d+)\./);
      if (majorMatch) {
        installedMajorVersion = majorMatch[1];
      }

      let targetFileToLoad: string | undefined;

      if (installedMajorVersion && group.versions[installedMajorVersion]) {
        targetFileToLoad = group.versions[installedMajorVersion];
      } else if (group.unversioned) {
        targetFileToLoad = group.unversioned;
      }

      if (!targetFileToLoad) {
        console.log(`[Quick Ops] 未加载 ${baseName}，因为既没有匹配的版本文件，也没有兜底的默认文件。`);
        continue;
      }

      const content = fs.readFileSync(path.join(snippetsDir, targetFileToLoad), 'utf8');
      try {
        const parsed: UIComponent[] = JSON.parse(content);
        this.components.push(...parsed);
        parsed.forEach((c) => c.tags.forEach((t) => this.tagToComponentMap.set(t, c)));
        console.log(`[Quick Ops] 成功加载 ${baseName} 的片段库: ${targetFileToLoad}`);
      } catch (e) {
        console.error(`[Quick Ops] 解析文件失败: ${targetFileToLoad}`, e);
      }
    }
  }
  
  private async exportSnippetsToWorkspace() {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || this.components.length === 0) return;

    try {
      const targetFile = vscode.Uri.joinPath(workspaceFolders[0].uri, '.vscode', 'quick-ops-ui.code-snippets');
      const vsCodeNativeSnippets: Record<string, any> = {};
      
      for (const comp of this.components) {
        for (const tag of comp.tags) {
          vsCodeNativeSnippets[`${comp.description} (${tag})`] = {
            prefix: tag,
            body: comp.snippet.replace(/\$TAG/g, tag).split('\n'),
            description: comp.description
          };
        }
      }

      await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(workspaceFolders[0].uri, '.vscode'));
      await vscode.workspace.fs.writeFile(targetFile, Buffer.from(JSON.stringify(vsCodeNativeSnippets, null, 2), 'utf8'));

      const doc = await vscode.workspace.openTextDocument(targetFile);
      await vscode.window.showTextDocument(doc);
      vscode.window.showInformationMessage('🎉 UI 库基础代码片段已成功导出！');
    } catch (error) {
      vscode.window.showErrorMessage(`导出失败: ${error}`);
    }
  }

  public dispose() {
    this.providerDisposable?.dispose();
    this.hoverDisposable?.dispose();
    this.components = [];
    this.tagToComponentMap.clear();
  }
}