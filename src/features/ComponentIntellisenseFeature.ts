import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { IFeature } from '../core/interfaces/IFeature';
import { WorkspaceContextService } from '../services/WorkspaceContextService';

// ==========================================
// 1. 标准化数据接口
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

export interface UIComponent {
  tags: string[];
  description: string;
  snippet: string;
  link?: string;
  attributes?: UIAttribute[];
  events?: UIEvent[];
  slots?: UISlot[];
}

export class ComponentIntellisenseFeature implements IFeature {
  public readonly id = 'ComponentIntellisenseFeature';

  private components: UIComponent[] = [];
  private tagToComponentMap: Map<string, UIComponent> = new Map();
  private providerDisposable?: vscode.Disposable;
  // 🌟 新增：悬停提示的资源清理句柄
  private hoverDisposable?: vscode.Disposable;

  public activate(context: vscode.ExtensionContext) {
    this.loadSnippetsFromResources(context);

    // ==========================================
    // 注册代码补全 (Completion)
    // ==========================================
    this.providerDisposable = vscode.languages.registerCompletionItemProvider(
      ['vue', 'html', 'javascriptreact', 'typescriptreact'],
      {
        provideCompletionItems: (document: vscode.TextDocument, position: vscode.Position): vscode.CompletionItem[] | undefined => {
          const lineText = document.lineAt(position.line).text;
          const textBeforeCursor = lineText.substring(0, position.character);
          const completionItems: vscode.CompletionItem[] = [];

          const insideTagMatch = textBeforeCursor.match(/<([\w-]+)\s+[^>]*$/);

          if (insideTagMatch) {
            const currentTag = insideTagMatch[1];
            let comp = this.tagToComponentMap.get(currentTag);

            const currentWordMatch = textBeforeCursor.match(/(?:^|\s)([@#:]?[\w-]*)$/);
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
                  item.documentation = new vscode.MarkdownString(`**${label}**\n\n${ev.description}\n\n**回调参数**: \`${ev.parameters || '—'}\``);
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
                  item.documentation = new vscode.MarkdownString(`**${label}**\n\n${slot.description}`);
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
                const label = `${prefix}${attr.name}`;
                const item = new vscode.CompletionItem(label, vscode.CompletionItemKind.Property);

                if (attr.type === 'boolean' && !isBind) {
                  item.insertText = attr.name;
                } else if (attr.options && attr.options.length > 0) {
                  const enumValues = attr.options.map((o) => o.value).join(',');
                  item.insertText = new vscode.SnippetString(`${label}="\${1|${enumValues}|}"`);
                } else {
                  item.insertText = new vscode.SnippetString(`${label}="$1"`);
                }

                item.range = replaceRange;
                item.filterText = label;
                item.sortText = `  ${attr.name}`;
                item.documentation = this.buildAttributeMarkdown(attr);
                item.detail = `[Prop] ${attr.description}`;
                completionItems.push(item);
              });
            }
            return completionItems;
          }

          const tagMatch = textBeforeCursor.match(/(<[a-zA-Z0-9-]*|[a-zA-Z0-9-]+)$/);
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
      '<',
      ' ',
      '@',
      ':',
      '-',
      '#',
    );

    // ==========================================
    // 🌟 新增：注册悬停提示 (Hover)
    // ==========================================
    this.hoverDisposable = vscode.languages.registerHoverProvider(['vue', 'html', 'javascriptreact', 'typescriptreact'], {
      provideHover: (document: vscode.TextDocument, position: vscode.Position): vscode.Hover | undefined => {
        // 获取鼠标当前悬停的单词（支持匹配 v-model:prop, @click, #header 等格式）
        const wordRange = document.getWordRangeAtPosition(position, /[@#]?[\w:-]+/);
        if (!wordRange) return undefined;

        const word = document.getText(wordRange);

        // 1. 如果悬停的是组件标签自身 (例如 el-button)
        let comp = this.tagToComponentMap.get(word);
        if (comp) {
          return new vscode.Hover(this.buildFullComponentMarkdown(comp, word), wordRange);
        }

        // 2. 如果悬停的是属性/事件/插槽，我们需要找到它所属的组件标签
        const currentTag = this.getCurrentTagForHover(document, position);
        if (!currentTag) return undefined;

        comp = this.tagToComponentMap.get(currentTag);
        if (!comp) return undefined;

        // 剥离修饰符，提取纯粹的属性名/事件名/插槽名
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
          // 移除 :, v-bind:, v-model: 提取核心属性名
          cleanWord = word.replace(/^:|v-bind:|v-model:/, '');
        }

        // 匹配事件
        if (isEvent && comp.events) {
          const ev = comp.events.find((e) => e.name === cleanWord);
          if (ev) {
            const md = new vscode.MarkdownString(`**@${ev.name}**\n\n${ev.description}\n\n**回调参数**: \`${ev.parameters || '—'}\``);
            return new vscode.Hover(md, wordRange);
          }
        }

        // 匹配插槽
        if (isSlot && comp.slots) {
          const slot = comp.slots.find((s) => s.name === cleanWord);
          if (slot) {
            const md = new vscode.MarkdownString(`**#${slot.name}**\n\n${slot.description}`);
            return new vscode.Hover(md, wordRange);
          }
        }

        // 匹配属性
        if (comp.attributes && !isEvent && !isSlot) {
          const attr = comp.attributes.find((a) => a.name === cleanWord);
          if (attr) {
            return new vscode.Hover(this.buildAttributeMarkdown(attr), wordRange);
          }
        }

        return undefined;
      },
    });
  }

  // 构建属性 Markdown 表格
  private buildAttributeMarkdown(attr: UIAttribute): vscode.MarkdownString {
    let md = `**${attr.name}**\n\n${attr.description}\n\n`;
    md += `**类型**: \`${attr.type}\` | **默认值**: \`${attr.default || '—'}\`\n\n`;
    if (attr.options && attr.options.length > 0) {
      md += `**可选值说明**:\n\n`;
      attr.options.forEach((opt) => {
        md += `- \`${opt.value}\` ${opt.description ? '— ' + opt.description : ''}\n`;
      });
    }
    return new vscode.MarkdownString(md);
  }

  // 构建完整组件文档
  private buildFullComponentMarkdown(comp: UIComponent, tag: string): vscode.MarkdownString {
    let doc = `## ${tag}\n${comp.description}\n\n`;
    if (comp.link) doc += `[查看官方文档](${comp.link})\n\n---\n\n`;

    if (comp.attributes && comp.attributes.length > 0) {
      doc += `### 属性 (Attributes)\n\n`;
      doc += `| 参数 | 说明 | 类型 | 可选值 | 默认值 |\n| --- | --- | --- | --- | --- |\n`;
      comp.attributes.forEach((a) => {
        const optStr = a.options?.map((o) => `\`${o.value}\``).join(', ') || '—';
        doc += `| \`${a.name}\` | ${a.description} | \`${a.type}\` | ${optStr} | \`${a.default || '—'}\` |\n`;
      });
    }

    if (comp.events && comp.events.length > 0) {
      doc += `\n### 事件 (Events)\n\n`;
      doc += `| 事件名 | 说明 | 回调参数 |\n| --- | --- | --- |\n`;
      comp.events.forEach((e) => {
        doc += `| \`${e.name}\` | ${e.description} | \`${e.parameters || '—'}\` |\n`;
      });
    }

    if (comp.slots && comp.slots.length > 0) {
      doc += `\n### 插槽 (Slots)\n\n`;
      doc += `| 插槽名 | 说明 |\n| --- | --- |\n`;
      comp.slots.forEach((s) => {
        doc += `| \`${s.name}\` | ${s.description} |\n`;
      });
    }

    const mds = new vscode.MarkdownString(doc);
    mds.supportHtml = true;
    return mds;
  }

  // 🌟 新增：为 Hover 专门设计的闭包标签查找器
  private getCurrentTagForHover(document: vscode.TextDocument, position: vscode.Position): string | null {
    let lineNum = position.line;
    let charNum = position.character;

    // 从当前行往前找最近的 "<"
    for (let i = lineNum; i >= Math.max(0, lineNum - 10); i--) {
      const lineText = document.lineAt(i).text;
      const endChar = i === lineNum ? charNum : lineText.length;
      const chunk = lineText.substring(0, endChar);

      const lastOpenIdx = chunk.lastIndexOf('<');
      const lastCloseIdx = chunk.lastIndexOf('>');

      // 如果 "<" 出现在 ">" 之后，说明我们正身处一个标签的内部
      if (lastOpenIdx > lastCloseIdx) {
        const tagMatch = chunk.substring(lastOpenIdx).match(/<([\w-]+)/);
        if (tagMatch) {
          const tagName = tagMatch[1];
          // 如果悬停在 template 内的属性上，向上寻找真实的父组件
          if (tagName.toLowerCase() === 'template') {
            return this.getNearestTag(document, new vscode.Position(i, lastOpenIdx));
          }
          return tagName;
        }
      }
    }

    // 如果没有处于标签内部，则可能是悬停在包裹元素内的 slot 上，使用经典 getNearestTag 往外找
    return this.getNearestTag(document, position);
  }

  // 向上寻找父组件（支持嵌套插槽推断）
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

  // 加载 JSON
  private loadSnippetsFromResources(context: vscode.ExtensionContext) {
    const snippetsDir = path.join(context.extensionPath, 'resources', 'ui-snippets');
    if (!fs.existsSync(snippetsDir)) return;

    const files = fs.readdirSync(snippetsDir);

    // 1. 将文件按组件库基础名称进行分组
    // 数据结构示例: { 'ant-design-vue': { unversioned: 'ant-design-vue.json', versions: { '4': 'ant-design-vue@v4.json' } } }
    const libraryGroups: Record<string, { unversioned?: string; versions: Record<string, string> }> = {};

    files.forEach((file) => {
      if (!file.endsWith('.json')) return;

      // 使用正则提取基础库名和大版本号，例如 "ant-design-vue@v4.json" -> baseName: "ant-design-vue", version: "4"
      const match = file.match(/^(.+?)(?:@v(\d+))?\.json$/);
      if (!match) return;

      const [, baseName, version] = match;

      if (!libraryGroups[baseName]) {
        libraryGroups[baseName] = { versions: {} };
      }

      if (version) {
        libraryGroups[baseName].versions[version] = file; // 记录带版本的文件
      } else {
        libraryGroups[baseName].unversioned = file; // 记录不带版本的兜底文件
      }
    });

    // 2. 获取当前项目安装的所有依赖
    const dependencies = WorkspaceContextService.getInstance().context.dependencies || {};

    // 3. 遍历分组，根据依赖和配置决定加载哪个文件
    for (const [baseName, group] of Object.entries(libraryGroups)) {
      // 组装配置项的 Key (例: ant-design-vue -> AntDesignVue)
      const configKey = baseName
        .split('-')
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join('');

      // 检查全局设置是否开启了该组件库的提示
      const isEnabled = vscode.workspace.getConfiguration('quick-ops.general.use').get<boolean>(configKey, true);
      if (!isEnabled) {
        console.log(`[Quick Ops] 已拦截加载: ${baseName} (因为全局配置项 ${configKey} 未开启)`);
        continue; // 直接跳过这个库，处理下一个
      }

      // 解析当前项目安装的该依赖的大版本号
      let installedMajorVersion: string | null = null;
      const depVersionString = dependencies[baseName];

      if (depVersionString) {
        // 使用正则提取版本号中的第一个主数字 (例如 "^4.2.1" -> "4", "~2.0.0" -> "2", "3.1.2" -> "3")
        const majorMatch = depVersionString.match(/(?:^|[^\d])(\d+)\./);
        if (majorMatch) {
          installedMajorVersion = majorMatch[1];
        }
      }

      // 核心逻辑：决定最终使用哪个 JSON 文件
      let targetFileToLoad: string | undefined;

      if (installedMajorVersion && group.versions[installedMajorVersion]) {
        // 场景 A: 成功匹配到对应大版本的专属文件 (如 ant-design-vue@v4.json)
        targetFileToLoad = group.versions[installedMajorVersion];
      } else if (group.unversioned) {
        // 场景 B: 没匹配上大版本，或者项目中根本没装这个依赖，降级使用兜底文件 (如 ant-design-vue.json)
        targetFileToLoad = group.unversioned;
      }

      // 如果连兜底文件都没有，或者啥也没匹配上，直接不处理该组件库
      if (!targetFileToLoad) {
        console.log(`[Quick Ops] 未加载 ${baseName}，因为既没有匹配的版本文件，也没有兜底的默认文件。`);
        continue;
      }

      // 4. 读取并解析最终选定的 JSON 文件
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

  public dispose() {
    this.providerDisposable?.dispose();
    this.hoverDisposable?.dispose(); // 清理 Hover 资源
    this.components = [];
    this.tagToComponentMap.clear();
  }
}
