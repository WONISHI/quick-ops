import { LogSnippetString } from './constants';
import { getLabel } from '../../utils/getLable';
import extendCompletionItem from '../../utils/extendCompletionItem';
import { moduleConfig, parseModuleTemplate, parseSnippet, getVisualColumn } from '../../utils/moduleTemplate';

const provideCompletions = (position: any) => {
  moduleConfig.line = position.line;
  moduleConfig.character = position.character;
  const codes = parseModuleTemplate('log');
  return LogSnippetString.reduce<extendCompletionItem[]>((prev, snippet) => {
    const module = parseSnippet(codes);
    const cng = new extendCompletionItem(getLabel(snippet.label));
    let format = `console.log(${module!.map(item => `'${item}'`).join(', ')});`;
    getVisualColumn(format);
    format = format.replace(/'\$0'/, '');
    cng.detail = `当前的console格式是${moduleConfig.format}`;
    cng.filterText = snippet.filterText;
    cng.commitCharacters = snippet.commitCharacters;
    cng.insertText = format;
    cng.checkFn = (dp) => {
      console.log('dp',dp)
      if (dp.fileType === 'js') return true;
      if (dp.fileType === 'vue') return true;
      return false;
    };
    cng.command = {
      command: 'scope-search.onCompletionSelected',
      title: '触发补全事件',
      arguments: [moduleConfig.line, moduleConfig.character],
    };
    return [...prev, cng];
  }, []);
};

export default provideCompletions;
