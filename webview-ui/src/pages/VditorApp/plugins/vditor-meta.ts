export default function VditorMeta(content: string): string {
  const frontmatterRegex = /^---\n([\s\S]*?)\n---/;
  
  return content.replace(frontmatterRegex, (match, innerContent) => {
    const lines = innerContent.split('\n');
    let tableRows = '';
    lines.forEach((line: string) => {
      if (!line.trim()) return;
      const colonIndex = line.indexOf(':');
      if (colonIndex === -1) return;
      const key = line.substring(0, colonIndex).trim();
      let value = line.substring(colonIndex + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1).trim();
      }
      let renderValue = value;
      if (!value) {
        renderValue = `<span style="opacity: 0.3;">-</span>`;
      } 
      else if (/^(https?:\/\/|ssh:\/\/|git@)/i.test(value)) {
        renderValue = `<div class="meta-link-box"><i class="codicon codicon-link meta-icon"></i><a href="${value}" class="meta-link">${value}</a><i class="codicon codicon-copy meta-copy-btn" data-copy="${value}" title="复制链接"></i></div>`;
      } 
      else if (/^\[\[(.*?)\]\]$/.test(value)) {
        const tag = value.match(/^\[\[(.*?)\]\]$/)?.[1] || value;
        renderValue = `<div class="meta-tag"><i class="codicon codicon-tag meta-icon"></i><span>${tag}</span></div>`;
      } 
      else if (value.toLowerCase() === 'true' || value.toLowerCase() === 'false') {
        const isChecked = value.toLowerCase() === 'true';
        renderValue = `<div class="meta-checkbox"><input type="checkbox" ${isChecked ? 'checked' : ''} disabled /></div>`;
      } 
      else if (!isNaN(Date.parse(value)) && value.length >= 8 && /\d{4}/.test(value)) {
        renderValue = `<div class="meta-date"><i class="codicon codicon-calendar meta-icon"></i><span>${value}</span></div>`;
      }
      tableRows += `<tr><td class="meta-key">${key}</td><td class="meta-value">${renderValue}</td></tr>`;
    });

    if (!tableRows) return match;
    return `<div class="frontmatter-table-container"><table class="frontmatter-table"><tbody>${tableRows}</tbody></table></div>\n\n`;
  });
}