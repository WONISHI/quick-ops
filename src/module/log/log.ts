import { CompletionItem } from 'vscode';
import { properties } from '../../global-object/properties';
import { LogSnippetString } from './constants';
import { getLabel } from '../../utils/getLable';
import { moduleConfig, parseModuleTemplate, parseSnippet, getVisualColumn } from '../../utils/moduleTemplate';

class ModuleCompletionItem extends CompletionItem {
  checkFn: ((dp: typeof properties) => boolean) | null | undefined;
}

const cngGen = (position: any) => {
  moduleConfig.line = position.line;
  moduleConfig.character = position.character;
  const codes = parseModuleTemplate('log');
  return LogSnippetString.reduce<ModuleCompletionItem[]>((prev, snippet, index) => {
    const module = parseSnippet(codes);
    const cng = new ModuleCompletionItem(getLabel(snippet.label));
    let format = `console.log(${module!.map((item) => `'${item}'`).join(',')});`;
    getVisualColumn(format);
    format = format.replace(/'\$0'/, '');
    cng.detail = `当前的console格式是${moduleConfig.format}`;
    cng.filterText = snippet.filterText;
    cng.commitCharacters = snippet.commitCharacters;
    cng.insertText = format;
    cng.checkFn = (dp) => {
      if (dp.fileType === 'js') return true;
      if (dp.fileType === 'vue' && dp.content.trim().includes('export default')) return true;
      return true;
    };
    cng.command = {
      command: 'scope-search.onCompletionSelected',
      title: '触发补全事件',
      arguments: [moduleConfig.line, moduleConfig.character],
    };
    return [...prev, cng];
  }, []);
};

export default cngGen;
