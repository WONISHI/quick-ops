import { useCallback, useEffect, useMemo, useRef } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { json } from '@codemirror/lang-json';
import { SearchQuery, search, setSearchQuery } from '@codemirror/search';
import { EditorView } from '@codemirror/view';

import useResponseCodeMirrorTheme from '@/hooks/use-response-code-mirror-theme';

import styles from './index.module.css';

import type { ResponseCodeMirrorEditorProps, ResponseSearchRange } from './type';

export type { ResponseCodeMirrorEditorProps, ResponseEditorLanguage, ResponseSearchRange } from './type';

const responseCodeMirrorSearch = search({
  top: true,
});

const responseCodeMirrorTheme = EditorView.theme({
  '&': {
    height: '100%',
    color: 'var(--vscode-editor-foreground)',
    backgroundColor: 'var(--vscode-editor-background)',
  },
  '&.cm-focused': {
    outline: 'none',
  },
  '.cm-scroller': {
    overflow: 'auto',
    fontFamily: 'var(--vscode-editor-font-family, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace)',
    fontSize: 'var(--vscode-editor-font-size, 12px)',
    lineHeight: 'var(--vscode-editor-line-height, 1.45)',
  },
  '.cm-content': {
    padding: '8px 0',
    caretColor: 'var(--vscode-editorCursor-foreground)',
  },
  '.cm-line': {
    padding: '0 8px',
  },
  '.cm-gutters': {
    color: 'var(--vscode-editorLineNumber-foreground)',
    backgroundColor: 'var(--vscode-editor-background)',
    border: 'none',
  },
  '.cm-activeLine': {
    backgroundColor: 'transparent',
  },
  '.cm-activeLineGutter': {
    color: 'var(--vscode-editorLineNumber-activeForeground)',
    backgroundColor: 'transparent',
  },
  '.cm-foldGutter .cm-gutterElement': {
    color: 'var(--vscode-icon-foreground)',
  },
  '.cm-selectionBackground, ::selection': {
    backgroundColor: 'var(--vscode-editor-selectionBackground) !important',
  },
  '.cm-searchMatch': {
    padding: '0 1px',
    borderRadius: '2px',
    backgroundColor: 'var(--vscode-editor-findMatchHighlightBackground, rgba(234, 92, 0, 0.35))',
  },
  '.cm-searchMatch.cm-searchMatch-selected': {
    color: 'var(--vscode-editor-findMatchForeground, inherit)',
    backgroundColor: 'var(--vscode-editor-findMatchBackground, rgba(81, 92, 106, 0.75))',
    outline: '1px solid var(--vscode-editor-findMatchBorder, var(--vscode-focusBorder))',
  },
  '.cm-panels': {
    display: 'none',
  },
});

/**
 * @description 获取当前搜索条件的全部匹配范围
 */
function getResponseSearchRanges(view: EditorView, query: SearchQuery): ResponseSearchRange[] {
  const result: ResponseSearchRange[] = [];

  const cursor = query.getCursor(view.state);

  while (true) {
    const current = cursor.next();

    if (current.done) {
      break;
    }

    result.push({
      from: current.value.from,
      to: current.value.to,
    });
  }

  return result;
}

/**
 * @description 使用 CodeMirror 6 显示或编辑代码内容
 */
export default function ResponseCodeMirrorEditor({
  value,
  language,
  editable = false,
  onChange,
  searchOpen = false,
  searchQuery = '',
  activeSearchIndex = 0,
}: ResponseCodeMirrorEditorProps) {
  const theme = useResponseCodeMirrorTheme();

  const editorViewRef = useRef<EditorView | null>(null);

  /**
   * @description 计算 CodeMirror 扩展
   */
  const extensions = useMemo(() => {
    return [...(language === 'json' ? [json()] : []), responseCodeMirrorSearch, responseCodeMirrorTheme, EditorView.lineWrapping];
  }, [language]);

  /**
   * @description 同步悬浮搜索条件到 CodeMirror
   */
  const syncSearch = useCallback(
    (targetView = editorViewRef.current) => {
      if (!targetView) return;

      const normalizedQuery = searchOpen ? searchQuery.trim() : '';

      const query = new SearchQuery({
        search: normalizedQuery,
        caseSensitive: false,
        literal: true,
      });

      if (!normalizedQuery || !query.valid) {
        const currentHead = targetView.state.selection.main.head;

        targetView.dispatch({
          selection: {
            anchor: currentHead,
          },
          effects: setSearchQuery.of(query),
        });

        return;
      }

      const ranges = getResponseSearchRanges(targetView, query);

      const safeActiveIndex = ranges.length > 0 ? Math.min(Math.max(activeSearchIndex, 0), ranges.length - 1) : 0;

      const activeRange = ranges[safeActiveIndex];

      if (!activeRange) {
        targetView.dispatch({
          effects: setSearchQuery.of(query),
        });

        return;
      }

      targetView.dispatch({
        selection: {
          anchor: activeRange.from,
          head: activeRange.to,
        },
        effects: [
          setSearchQuery.of(query),
          EditorView.scrollIntoView(activeRange.from, {
            y: 'center',
          }),
        ],
      });
    },
    [activeSearchIndex, searchOpen, searchQuery],
  );

  /**
   * @description 内容或搜索条件变化后同步编辑器
   */
  useEffect(() => {
    syncSearch();
  }, [language, syncSearch, value]);

  /**
   * @description 保存 CodeMirror 编辑器实例
   */
  const handleCreateEditor = useCallback(
    (view: EditorView) => {
      editorViewRef.current = view;
      syncSearch(view);
    },
    [syncSearch],
  );

  /**
   * @description 组件销毁时清理编辑器引用
   */
  useEffect(() => {
    return () => {
      editorViewRef.current = null;
    };
  }, []);

  return (
    <CodeMirror
      className={styles.editor}
      width="100%"
      height="100%"
      value={value}
      theme={theme}
      extensions={extensions}
      editable={editable}
      readOnly={!editable}
      indentWithTab={editable}
      onChange={(nextValue) => {
        if (!editable) return;

        onChange?.(nextValue);
      }}
      onCreateEditor={handleCreateEditor}
      basicSetup={{
        lineNumbers: true,
        highlightActiveLineGutter: editable,
        highlightSpecialChars: false,
        history: editable,
        foldGutter: language === 'json',
        drawSelection: true,
        dropCursor: editable,
        allowMultipleSelections: false,
        indentOnInput: editable,
        syntaxHighlighting: true,
        bracketMatching: language === 'json',
        closeBrackets: editable && language === 'json',
        autocompletion: false,
        rectangularSelection: false,
        crosshairCursor: false,
        highlightActiveLine: editable,
        highlightSelectionMatches: false,
        closeBracketsKeymap: editable && language === 'json',
        defaultKeymap: editable,
        searchKeymap: false,
        historyKeymap: editable,
        foldKeymap: language === 'json',
        completionKeymap: false,
        lintKeymap: false,
      }}
    />
  );
}
