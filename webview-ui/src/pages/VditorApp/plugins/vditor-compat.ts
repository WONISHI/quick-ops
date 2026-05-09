export interface CompatOptions {
  title?: string;
}

const LINK_TOKEN_PREFIX = '%%QUICK_OPS_HTML_LINK_';
const LINK_TOKEN_SUFFIX = '%%';

const escapeHtml = (value: string): string => {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
};

const escapeAttr = (value: string): string => {
  return escapeHtml(value).replace(/"/g, '&quot;');
};

const shouldKeepWikiLinkRaw = (value: string): boolean => {
  const text = value.trim();

  if (!text) return true;

  // Obsidian 链接别名：[[file|alias]]
  // 这种一定不要当 tag 处理，否则 [[ 和 ]] 会被吃掉
  if (text.includes('|')) return true;

  // 常见附件 / 文件链接，建议也保留原样
  if (/\.(png|jpe?g|gif|webp|svg|bmp|pdf|md|docx?|xlsx?|pptx?|zip|rar|7z)$/i.test(text)) {
    return true;
  }

  return false;
};

const renderMetaTags = (content: string): string => {
  const tagRegex = /(?<![!\\])\[\[([^\]\n]*?)\]\]/g;

  return content.replace(tagRegex, (match, tagText) => {
    const text = String(tagText || '').trim();

    // 空的 [[]] 保留
    if (!text) return match;

    // [[xxx|Open: xxx]] / [[xxx.png]] 这类 Obsidian 语法保留
    if (shouldKeepWikiLinkRaw(text)) return match;

    return `<span class="meta-tag" style="margin: 0 4px; vertical-align: middle;"><i class="codicon codicon-tag meta-icon"></i><span>${escapeHtml(text)}</span></span>`;
  });
};

const findMarkdownLinkTextEnd = (content: string, openBracketIndex: number): number => {
  let depth = 0;

  for (let i = openBracketIndex + 1; i < content.length; i++) {
    const char = content[i];

    if (char === '\\') {
      i++;
      continue;
    }

    if (char === '\n') {
      return -1;
    }

    if (char === '[') {
      depth++;
      continue;
    }

    if (char === ']') {
      if (depth > 0) {
        depth--;
        continue;
      }

      return i;
    }
  }

  return -1;
};

const findMarkdownLinkUrlEnd = (content: string, openParenIndex: number): number => {
  let depth = 0;

  for (let i = openParenIndex + 1; i < content.length; i++) {
    const char = content[i];

    if (char === '\\') {
      i++;
      continue;
    }

    if (char === '\n') {
      return -1;
    }

    if (char === '(') {
      depth++;
      continue;
    }

    if (char === ')') {
      if (depth > 0) {
        depth--;
        continue;
      }

      return i;
    }
  }

  return -1;
};

const renderMarkdownLinksToTokens = (content: string) => {
  const links: string[] = [];
  let result = '';
  let index = 0;

  while (index < content.length) {
    const char = content[index];

    // 跳过图片语法：![xxx](url)
    if (char !== '[' || content[index - 1] === '!') {
      result += char;
      index++;
      continue;
    }

    const closeBracketIndex = findMarkdownLinkTextEnd(content, index);

    if (closeBracketIndex === -1) {
      result += char;
      index++;
      continue;
    }

    // 关键：跳过 checkbox 的 [x]
    // - [x] [url](href)
    // [x] 后面是空格，不是 (
    if (content[closeBracketIndex + 1] !== '(') {
      result += content.slice(index, closeBracketIndex + 1);
      index = closeBracketIndex + 1;
      continue;
    }

    const openParenIndex = closeBracketIndex + 1;
    const closeParenIndex = findMarkdownLinkUrlEnd(content, openParenIndex);

    if (closeParenIndex === -1) {
      result += char;
      index++;
      continue;
    }

    const text = content.slice(index + 1, closeBracketIndex);
    const url = content.slice(openParenIndex + 1, closeParenIndex);

    const htmlLink = `<a href="${escapeAttr(url)}" class="meta-link" target="_blank" rel="noopener noreferrer">${escapeHtml(text)}</a>`;
    const token = `${LINK_TOKEN_PREFIX}${links.length}${LINK_TOKEN_SUFFIX}`;

    links.push(htmlLink);
    result += token;

    index = closeParenIndex + 1;
  }

  return { content: result, links };
};

const restoreHtmlLinks = (content: string, links: string[]): string => {
  let result = content;

  links.forEach((link, index) => {
    const token = `${LINK_TOKEN_PREFIX}${index}${LINK_TOKEN_SUFFIX}`;
    result = result.split(token).join(link);
  });

  return result;
};

const VditorCompat = {
  install(content: string, options?: CompatOptions): string {
    let processedContent = content;

    // 1. 先把 Markdown 链接转成 a 标签，并用 token 临时保护
    const linkResult = renderMarkdownLinksToTokens(processedContent);
    processedContent = linkResult.content;

    // 2. 再解析非链接区域里的 [[tag]]
    //    [[xxx|Open: xxx]] 会被保留原样，不会吃掉 [[ 和 ]]
    processedContent = renderMetaTags(processedContent);

    // 3. 最后恢复 a 标签
    processedContent = restoreHtmlLinks(processedContent, linkResult.links);

    if (options && options.title) {
      processedContent = `# ${options.title}\n\n${processedContent}`;
    }

    return processedContent;
  },
};

export default VditorCompat;