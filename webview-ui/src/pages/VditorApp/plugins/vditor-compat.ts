export interface CompatOptions {
  title?: string;
}

const VditorCompat = {
  install(content: string, options?: CompatOptions): string {
    let processedContent = content;
    const tagRegex = /\[\[(.*?)\]\]/g;
    processedContent = processedContent.replace(tagRegex, (match, tagText) => {
      return `<span class="meta-tag" style="margin: 0 4px; vertical-align: middle;"><i class="codicon codicon-tag meta-icon"></i><span>${tagText}</span></span>`;
    });
    const linkRegex = /(^|[^!])\[(.*?)\]\((.*?)\)/g;
    processedContent = processedContent.replace(linkRegex, (match, prefix, text, url) => {
      return `${prefix}<a href="${url}" class="meta-link" target="_blank">${text}</a>`;
    });
    if (options && options.title) {
      processedContent = `# ${options.title}\n\n${processedContent}`;
    }

    return processedContent;
  }
};

export default VditorCompat;