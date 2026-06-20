import * as vscode from 'vscode';
import { ComponentIntellisenseService } from '../component-intellisense.service';
import type {
  UIAttribute,
  UIComponent,
  UIEvent,
  UISlot,
} from '../component-intellisense.type';

export class ComponentCompletionProvider
  implements vscode.CompletionItemProvider, vscode.HoverProvider
{
  public static inject = [ComponentIntellisenseService];

  constructor(
    private readonly componentIntellisenseService: ComponentIntellisenseService,
  ) {}

  public provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): vscode.CompletionItem[] | undefined {
    const lineTextBeforeCursor = document
      .lineAt(position.line)
      .text.substring(0, position.character);

    const startLine = Math.max(0, position.line - 15);

    const multiLineTextBeforeCursor = document.getText(
      new vscode.Range(new vscode.Position(startLine, 0), position),
    );

    const completionItems: vscode.CompletionItem[] = [];

    const insideTagMatch = multiLineTextBeforeCursor.match(/<([\w-]+)[^>]*$/);

    if (insideTagMatch) {
      return this.provideInsideTagCompletions(
        document,
        position,
        lineTextBeforeCursor,
        insideTagMatch[1],
      );
    }

    const tagMatch = lineTextBeforeCursor.match(/(<[a-zA-Z0-9-]*|[a-zA-Z0-9-]+)$/);

    if (!tagMatch) {
      return undefined;
    }

    const matchString = tagMatch[1];
    const hasBracket = matchString.startsWith('<');

    const replaceRange = new vscode.Range(
      position.line,
      position.character - matchString.length,
      position.line,
      position.character,
    );

    const components = this.componentIntellisenseService.getComponents();

    for (const comp of components) {
      for (const tag of comp.tags) {
        const item = new vscode.CompletionItem(
          tag,
          vscode.CompletionItemKind.Snippet,
        );

        const snippet = comp.snippet.replace(/\$TAG/g, tag);

        item.insertText = new vscode.SnippetString(snippet);
        item.range = replaceRange;
        item.filterText = hasBracket ? `<${tag}` : tag;
        item.documentation =
          this.componentIntellisenseService.buildFullComponentMarkdown(comp, tag);
        item.detail = comp.description;
        item.sortText = ` ${tag}`;

        completionItems.push(item);
      }
    }

    return completionItems;
  }

  public provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): vscode.Hover | undefined {
    const wordRange = document.getWordRangeAtPosition(position, /[@#]?[\w:-]+/);

    if (!wordRange) return undefined;

    const word = document.getText(wordRange);

    let comp = this.componentIntellisenseService.getComponentByTag(word);

    if (comp) {
      return new vscode.Hover(
        this.componentIntellisenseService.buildFullComponentMarkdown(comp, word),
        wordRange,
      );
    }

    const currentTag = this.componentIntellisenseService.getCurrentTagForHover(
      document,
      position,
    );

    if (!currentTag) return undefined;

    comp = this.componentIntellisenseService.getComponentByTag(currentTag);

    if (!comp) return undefined;

    let cleanWord = word;
    let isEvent = false;
    let isSlot = false;

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
      const event = comp.events.find(item => item.name === cleanWord);

      if (event) {
        return new vscode.Hover(this.buildEventMarkdown(event), wordRange);
      }
    }

    if (isSlot && comp.slots) {
      const slot = comp.slots.find(item => item.name === cleanWord);

      if (slot) {
        return new vscode.Hover(this.buildSlotMarkdown(slot), wordRange);
      }
    }

    if (comp.attributes && !isEvent && !isSlot) {
      const targetKebab = this.componentIntellisenseService.toKebabCase(cleanWord);

      const attr = comp.attributes.find(item => {
        const attrNamesKebab = item.name.split('/').map(name => {
          return this.componentIntellisenseService.toKebabCase(name.trim());
        });

        return attrNamesKebab.includes(targetKebab);
      });

      if (attr) {
        return new vscode.Hover(
          this.componentIntellisenseService.buildAttributeMarkdown(attr),
          wordRange,
        );
      }
    }

    return undefined;
  }

  public dispose(): void {
    // 当前 provider 没有自己持有 Disposable。
  }

  private provideInsideTagCompletions(
    document: vscode.TextDocument,
    position: vscode.Position,
    lineTextBeforeCursor: string,
    currentTag: string,
  ): vscode.CompletionItem[] {
    const completionItems: vscode.CompletionItem[] = [];

    let comp = this.componentIntellisenseService.getComponentByTag(currentTag);

    const currentWordMatch = lineTextBeforeCursor.match(/(?:^|\s)([@#:]?[\w-]*)$/);
    const currentWord = currentWordMatch ? currentWordMatch[1] : '';

    const replaceRange = new vscode.Range(
      position.line,
      position.character - currentWord.length,
      position.line,
      position.character,
    );

    if (currentWord.startsWith('@')) {
      if (comp?.events) {
        comp.events.forEach(event => {
          completionItems.push(
            this.createEventCompletionItem(event, replaceRange),
          );
        });
      }

      return completionItems;
    }

    if (currentWord.startsWith('#')) {
      if (currentTag.toLowerCase() === 'template') {
        const parentTag = this.componentIntellisenseService.getNearestTag(
          document,
          position,
        );

        if (parentTag) {
          comp = this.componentIntellisenseService.getComponentByTag(parentTag);
        }
      }

      if (comp?.slots) {
        comp.slots.forEach(slot => {
          completionItems.push(
            this.createSlotCompletionItem(slot, comp!, replaceRange),
          );
        });
      }

      return completionItems;
    }

    if (comp?.attributes) {
      const isBind = currentWord.startsWith(':');
      const prefix = isBind ? ':' : '';

      comp.attributes.forEach(attr => {
        completionItems.push(
          this.createAttributeCompletionItem(attr, prefix, isBind, replaceRange),
        );
      });
    }

    return completionItems;
  }

  private createEventCompletionItem(
    event: UIEvent,
    range: vscode.Range,
  ): vscode.CompletionItem {
    const label = `@${event.name}`;
    const handlerName = `on${event.name.charAt(0).toUpperCase()}${event.name.slice(1)}`;

    const item = new vscode.CompletionItem(
      label,
      vscode.CompletionItemKind.Event,
    );

    item.insertText = new vscode.SnippetString(`${label}="\${1:${handlerName}}"`);
    item.range = range;
    item.filterText = label;
    item.sortText = ` ${event.name}`;
    item.documentation = this.buildEventMarkdown(event);
    item.detail = `[Event] ${event.description}`;

    return item;
  }

  private createSlotCompletionItem(
    slot: UISlot,
    comp: UIComponent,
    range: vscode.Range,
  ): vscode.CompletionItem {
    const label = `#${slot.name}`;

    const item = new vscode.CompletionItem(
      label,
      vscode.CompletionItemKind.Field,
    );

    item.insertText = new vscode.SnippetString(label);
    item.range = range;
    item.filterText = label;
    item.sortText = ` ${slot.name}`;
    item.documentation = this.buildSlotMarkdown(slot);
    item.detail = `[Slot] ${comp.tags[0]}`;

    return item;
  }

  private createAttributeCompletionItem(
    attr: UIAttribute,
    prefix: string,
    isBind: boolean,
    range: vscode.Range,
  ): vscode.CompletionItem {
    const primaryAttrName = attr.name.split('/')[0].trim();
    const kebabName = this.componentIntellisenseService.toKebabCase(primaryAttrName);
    const label = `${prefix}${kebabName}`;

    const item = new vscode.CompletionItem(
      label,
      vscode.CompletionItemKind.Property,
    );

    if (attr.type === 'boolean' && !isBind) {
      item.insertText = kebabName;
    } else if (attr.options && attr.options.length > 0) {
      const enumValues = attr.options.map(option => option.value).join(',');

      item.insertText = new vscode.SnippetString(`${label}="\${1|${enumValues}|}"`);
    } else {
      item.insertText = new vscode.SnippetString(`${label}="$1"`);
    }

    item.range = range;
    item.filterText = label;
    item.sortText = ` ${kebabName}`;
    item.documentation =
      this.componentIntellisenseService.buildAttributeMarkdown(attr);
    item.detail = `[Prop] ${attr.name}`;

    return item;
  }

  private buildEventMarkdown(event: UIEvent): vscode.MarkdownString {
    const markdown = new vscode.MarkdownString(
      `**@${event.name}**\n\n${event.description}\n\n**回调参数**: \`${
        event.parameters || '—'
      }\``,
    );

    markdown.supportHtml = true;

    return markdown;
  }

  private buildSlotMarkdown(slot: UISlot): vscode.MarkdownString {
    const markdown = new vscode.MarkdownString(
      `**#${slot.name}**\n\n${slot.description}`,
    );

    markdown.supportHtml = true;

    return markdown;
  }
}