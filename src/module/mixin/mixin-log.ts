import { CompletionItemKind, MarkdownString } from 'vscode';
import extendCompletionItem from '../../services/ConditionalCompletionItem';
import { moduleConfig, parseModuleTemplate, parseSnippet, getVisualColumn } from '../../utils/moduleTemplate';

export const LogSnippetString = [
  {
    label: 'cng',
    detail: '',
    filterText: 'cng',
    commitCharacters: ['\t'],
  },
  {
    label: 'cg',
    detail: '',
    filterText: 'cg',
    commitCharacters: ['\t'],
  },
  {
    label: 'log',
    detail: '',
    filterText: 'log',
    commitCharacters: ['\t'],
  },
];

const provideCompletions = (position: any) => {
  moduleConfig.line = position.line;
  moduleConfig.character = position.character;
  const codes = parseModuleTemplate('log');
  return LogSnippetString.reduce<extendCompletionItem[]>((prev, snippet) => {
    const module = parseSnippet(codes);
    const cng = new extendCompletionItem(snippet.label);
    let format = `console.log(${module!.map((item) => `'${item}'`).join(', ')});`;
    getVisualColumn(format);
    format = format.replace(/'\$0'/, '');
    cng.kind = CompletionItemKind.Method;
    cng.detail = `当前的console格式是${moduleConfig.format}`;
    cng.documentation = new MarkdownString().appendCodeblock(format, 'js');
    cng.filterText = snippet.filterText;
    cng.commitCharacters = snippet.commitCharacters;
    cng.insertText = format;
    cng.checkFn = (dp) => {
      if (['ts', 'js', 'tsx', 'jsx', 'vue'].includes(dp.fileType!)) return true;
      return false;
    };
    cng.command = {
      command: 'quick-ops.onCompletionSelected',
      title: '触发补全事件',
      arguments: [moduleConfig.line, moduleConfig.character],
    };
    return [...prev, cng];
  }, []);
};

export default provideCompletions;
