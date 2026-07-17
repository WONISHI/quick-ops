import { useCallback, useEffect, useMemo, useRef } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { json } from '@codemirror/lang-json';
import { SearchQuery, search, setSearchQuery } from '@codemirror/search';
import { EditorView } from '@codemirror/view';

import useVSCodeTheme from '@/hooks/use-response-code-mirror-theme';

import styles from './index.module.css';

import type { BaseCodeEditorProps, BaseCodeEditorSearchOptions, BaseCodeEditorSearchRange } from './type';

export type {
  BaseCodeEditorLanguage,
  BaseCodeEditorProps,
  BaseCodeEditorSearchAlign,
  BaseCodeEditorSearchOptions,
  BaseCodeEditorSearchRange,
  ResponseCodeMirrorEditorProps,
  ResponseEditorLanguage,
  ResponseSearchRange,
} from './type';

const baseCodeEditorSearch = search({
  top: true,
});

const baseCodeEditorTheme = EditorView.theme({
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
function getSearchRanges(view: EditorView, query: SearchQuery): BaseCodeEditorSearchRange[] {
  const result: BaseCodeEditorSearchRange[] = [];

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
 * @description 合并新旧搜索配置
 */
function normalizeSearchOptions(
  searchOptions: BaseCodeEditorSearchOptions | undefined,
  searchOpen: boolean | undefined,
  searchQuery: string | undefined,
  activeSearchIndex: number | undefined,
): BaseCodeEditorSearchOptions | undefined {
  if (searchOptions) {
    return searchOptions;
  }

  const hasLegacySearchOptions = searchOpen !== undefined || searchQuery !== undefined || activeSearchIndex !== undefined;

  if (!hasLegacySearchOptions) {
    return undefined;
  }

  return {
    open: searchOpen,
    query: searchQuery,
    activeIndex: activeSearchIndex,
  };
}

/**
 * @description 创建默认基础配置
 */
function createDefaultBasicSetup(editable: boolean, language: BaseCodeEditorProps['language']) {
  const isJson = language === 'json';

  return {
    lineNumbers: true,
    highlightActiveLineGutter: editable,
    highlightSpecialChars: false,
    history: editable,
    foldGutter: isJson,
    drawSelection: true,
    dropCursor: editable,
    allowMultipleSelections: false,
    indentOnInput: editable,
    syntaxHighlighting: true,
    bracketMatching: isJson,
    closeBrackets: editable && isJson,
    autocompletion: false,
    rectangularSelection: false,
    crosshairCursor: false,
    highlightActiveLine: editable,
    highlightSelectionMatches: false,
    closeBracketsKeymap: editable && isJson,
    defaultKeymap: editable,
    searchKeymap: false,
    historyKeymap: editable,
    foldKeymap: isJson,
    completionKeymap: false,
    lintKeymap: false,
  };
}

/**
 * @description 通用 CodeMirror 6 编辑器
 */
export default function BaseCodeEditor({
  value = '',
  language = 'plaintext',
  editable = false,
  width = '100%',
  height = '100%',
  className,
  theme,
  extensions: customExtensions = [],
  lineWrapping = true,
  indentWithTab = editable,
  basicSetup,
  search: searchOptions,
  searchOpen,
  searchQuery,
  activeSearchIndex,
  onChange,
  onCreateEditor,
  ...codeMirrorProps
}: BaseCodeEditorProps) {
  const vscodeTheme = useVSCodeTheme();

  const editorViewRef = useRef<EditorView | null>(null);

  const normalizedSearchOptions = normalizeSearchOptions(searchOptions, searchOpen, searchQuery, activeSearchIndex);

  const hasSearch = normalizedSearchOptions !== undefined;

  const normalizedSearchOpen = normalizedSearchOptions?.open ?? true;

  const normalizedSearchQuery = normalizedSearchOptions?.query ?? '';

  const normalizedActiveIndex = normalizedSearchOptions?.activeIndex ?? 0;

  const normalizedCaseSensitive = normalizedSearchOptions?.caseSensitive ?? false;

  const normalizedLiteral = normalizedSearchOptions?.literal ?? true;

  const normalizedTrim = normalizedSearchOptions?.trim ?? true;

  const normalizedSelectMatch = normalizedSearchOptions?.selectMatch ?? true;

  const normalizedScrollAlign = normalizedSearchOptions?.scrollAlign ?? 'center';

  /**
   * @description 计算 CodeMirror 扩展
   */
  const mergedExtensions = useMemo(() => {
    const result = [];

    if (language === 'json') {
      result.push(json());
    }

    if (hasSearch) {
      result.push(baseCodeEditorSearch);
    }

    result.push(baseCodeEditorTheme);

    if (lineWrapping) {
      result.push(EditorView.lineWrapping);
    }

    result.push(...customExtensions);

    return result;
  }, [customExtensions, hasSearch, language, lineWrapping]);

  /**
   * @description 计算 CodeMirror 基础配置
   */
  const mergedBasicSetup = useMemo(() => {
    if (basicSetup === false) {
      return false;
    }

    const defaultBasicSetup = createDefaultBasicSetup(editable, language);

    if (!basicSetup || basicSetup === true) {
      return defaultBasicSetup;
    }

    return {
      ...defaultBasicSetup,
      ...basicSetup,
    };
  }, [basicSetup, editable, language]);

  /**
   * @description 同步外部搜索条件到 CodeMirror
   */
  const syncSearch = useCallback(
    (targetView = editorViewRef.current) => {
      if (!targetView || !hasSearch) {
        return;
      }

      const sourceQuery = normalizedSearchOpen ? normalizedSearchQuery : '';

      const queryText = normalizedTrim ? sourceQuery.trim() : sourceQuery;

      const query = new SearchQuery({
        search: queryText,
        caseSensitive: normalizedCaseSensitive,
        literal: normalizedLiteral,
      });

      if (!queryText || !query.valid) {
        const currentHead = targetView.state.selection.main.head;

        targetView.dispatch({
          selection: {
            anchor: currentHead,
          },
          effects: setSearchQuery.of(query),
        });

        return;
      }

      const ranges = getSearchRanges(targetView, query);

      const safeActiveIndex = ranges.length > 0 ? Math.min(Math.max(normalizedActiveIndex, 0), ranges.length - 1) : 0;

      const activeRange = ranges[safeActiveIndex];

      if (!activeRange) {
        targetView.dispatch({
          effects: setSearchQuery.of(query),
        });

        return;
      }

      const scrollEffect = EditorView.scrollIntoView(activeRange.from, {
        y: normalizedScrollAlign,
      });

      if (normalizedSelectMatch) {
        targetView.dispatch({
          selection: {
            anchor: activeRange.from,
            head: activeRange.to,
          },
          effects: [setSearchQuery.of(query), scrollEffect],
        });

        return;
      }

      targetView.dispatch({
        effects: [setSearchQuery.of(query), scrollEffect],
      });
    },
    [
      hasSearch,
      normalizedActiveIndex,
      normalizedCaseSensitive,
      normalizedLiteral,
      normalizedScrollAlign,
      normalizedSearchOpen,
      normalizedSearchQuery,
      normalizedSelectMatch,
      normalizedTrim,
    ],
  );

  /**
   * @description 内容或搜索条件变化后同步编辑器
   */
  useEffect(() => {
    syncSearch();
  }, [language, syncSearch, value]);

  /**
   * @description 保存编辑器实例并触发外部创建事件
   */
  const handleCreateEditor = useCallback(
    (...args: Parameters<NonNullable<BaseCodeEditorProps['onCreateEditor']>>) => {
      const [view] = args;

      editorViewRef.current = view;
      syncSearch(view);
      onCreateEditor?.(...args);
    },
    [onCreateEditor, syncSearch],
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
      {...codeMirrorProps}
      className={[styles.editor, className].filter(Boolean).join(' ')}
      width={width}
      height={height}
      value={value}
      theme={theme ?? vscodeTheme}
      extensions={mergedExtensions}
      editable={editable}
      readOnly={!editable}
      indentWithTab={indentWithTab}
      basicSetup={mergedBasicSetup}
      onChange={onChange}
      onCreateEditor={handleCreateEditor}
    />
  );
}
