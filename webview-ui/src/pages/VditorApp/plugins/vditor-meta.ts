const VditorMeta = {
  install(content: string): string {
    const frontmatterRegex = /^---\n([\s\S]*?)\n---/;
    return content.replace(frontmatterRegex, (match, innerContent) => {
      const lines = innerContent.split('\n');
      
      const entries: { key: string, values: string[] }[] = [];
      let currentEntry: { key: string, values: string[] } | null = null;

      lines.forEach((line: string) => {
        const trimmedLine = line.trim();
        if (!trimmedLine) return;

        const isListItem = trimmedLine.startsWith('- ') || /^-(https?:\/\/|ssh:\/\/|git@)/i.test(trimmedLine);
        
        if (isListItem) {
          let val = trimmedLine.replace(/^-/, '').trim();
          if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1).trim();
          }
          if (currentEntry && val) {
            currentEntry.values.push(val);
          }
          return;
        }

        const colonIndex = line.indexOf(':');
        if (colonIndex === -1) return;

        const key = line.substring(0, colonIndex).trim();
        let value = line.substring(colonIndex + 1).trim();

        if (value.startsWith('- ') || /^-(https?:\/\/|ssh:\/\/|git@)/i.test(value)) {
          value = value.replace(/^-/, '').trim();
        }

        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1).trim();
        }

        currentEntry = { key, values: [] };
        if (value) {
          currentEntry.values.push(value);
        }
        entries.push(currentEntry);
      });

      let tableRows = '';
      entries.forEach(entry => {
        let renderValue = '';
        
        if (entry.values.length === 0) {
          renderValue = `<span style="opacity: 0.3;">-</span>`;
        } else {
          renderValue = entry.values.map(val => {
            // 1. 链接类型
            if (/^(https?:\/\/|ssh:\/\/|git@)/i.test(val)) {
              return `<div class="meta-link-box"><i class="codicon codicon-link meta-icon"></i><a href="${val}" class="meta-link">${val}</a><i class="codicon codicon-copy meta-copy-btn" data-copy="${val}" title="复制链接"></i></div>`;
            } 
            // 2. Tag 类型
            if (/^\[\[(.*?)\]\]$/.test(val)) {
              const tag = val.match(/^\[\[(.*?)\]\]$/)?.[1] || val;
              return `<div class="meta-tag"><i class="codicon codicon-tag meta-icon"></i><span>${tag}</span></div>`;
            } 
            // 3. 布尔多选框类型
            if (val.toLowerCase() === 'true' || val.toLowerCase() === 'false') {
              const isChecked = val.toLowerCase() === 'true';
              return `<div class="meta-checkbox"><input type="checkbox" ${isChecked ? 'checked' : ''} disabled /></div>`;
            } 
            // 4. 日期类型
            if (!isNaN(Date.parse(val)) && val.length >= 8 && /\d{4}/.test(val)) {
              return `<div class="meta-date"><i class="codicon codicon-calendar meta-icon"></i><span>${val}</span></div>`;
            }
            
            // 5. 兜底类型（普通文本）
            return `<div class="meta-link-box" style="justify-content: space-between; width: 100%;"><span style="flex: 1; word-break: break-all;">${val}</span><i class="codicon codicon-copy meta-copy-btn" data-copy="${val}" title="复制内容"></i></div>`;
            
          }).join('<div style="margin-top: 6px;"></div>');
        }

        tableRows += `<tr><td class="meta-key">${entry.key}</td><td class="meta-value">${renderValue}</td></tr>`;
      });

      if (!tableRows) return match;
      return `<div class="frontmatter-table-container"><table class="frontmatter-table"><tbody>${tableRows}</tbody></table></div>\n\n`;
    });
  }
};

export default VditorMeta;