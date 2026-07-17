import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { json } from '@codemirror/lang-json';
import { SearchQuery, search, setSearchQuery } from '@codemirror/search';
import { EditorView } from '@codemirror/view';
import { vscode } from '@utils/vscode';
import styles from '@pages/api-dev-tools-app/index.module.css';
import BaseDialog from '@components/BaseDialog';
import BaseSearch from '@components/BaseSearch';
import { buildApiDocsHtml } from '@/pages/api-dev-tools-app/src/api-docs-builder';
import type {
  HttpMethod,
  RequestTab,
  ResponseTab,
  BodyType,
  AuthType,
  KeyValueItem,
  GlobalVariable,
  ApiRequestConfig,
  ApiInterfaceItem,
  ApiProject,
  HistoryItem,
  ApiResponsePayload,
  PersistedState,
  ManageDialog,
  LeaveConfirmAction,
  LeaveConfirmDialog,
  ApiDevToolsViewTitleAction,
} from '@/pages/api-dev-tools-app/src/type';

import {
  HTTP_METHODS,
  REQUEST_TABS,
  RESPONSE_TABS,
  BOTTOM_PANEL_COLLAPSED_SIZE,
  BOTTOM_PANEL_DEFAULT_SIZE,
  BOTTOM_PANEL_MAX_SIZE,
  RESPONSE_PANEL_RESERVED_SIZE,
  RESPONSE_HEAD_SIZE,
  RESPONSE_TABS_SIZE,
  BOTTOM_RESIZER_SIZE,
  WORKSPACE_PANE_DEFAULT_WIDTH,
  WORKSPACE_PANE_MIN_WIDTH,
  WORKSPACE_PANE_MAX_WIDTH,
  WORKSPACE_RESIZER_SIZE,
} from '@/pages/api-dev-tools-app/src/constants';

/**
 * @description 将数值限制在指定的最小值和最大值之间
 */
function clampNumber(value: number, min: number, max: number) {
  const safeMax = Math.max(min, max);
  return Math.min(Math.max(value, min), safeMax);
}

/**
 * @description 创建带指定前缀的唯一标识
 */
function createId(prefix = 'id') {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/**
 * @description 创建键值配置项
 */
function createKeyValue(key = '', value = '', enabled = true): KeyValueItem {
  return {
    id: createId('kv'),
    enabled,
    key,
    value,
  };
}

/**
 * @description 创建默认接口请求配置
 */
function createDefaultRequest(): ApiRequestConfig {
  return {
    id: createId('req'),
    name: '未命名请求',
    method: 'GET',
    url: '{{baseUrl}}',
    params: [createKeyValue()],
    headers: [createKeyValue('Content-Type', 'application/json', false)],
    cookies: [createKeyValue()],
    bodyType: 'json',
    bodyRaw: '{\n  \n}',
    bodyForm: [createKeyValue()],
    auth: {
      type: 'none',
      token: '{{token}}',
      username: '',
      password: '',
    },
    preScript: '// 可修改 request / globals\n// request.headers["X-Debug"] = "1";',
    postScript: '// 可读取 response / globals\n// console.log(response.status);',
    timeout: 30000,
  };
}

/**
 * @description 创建默认全局变量列表
 */
function createDefaultGlobals(): GlobalVariable[] {
  return [createKeyValue('baseUrl', 'http://localhost:3000', true), createKeyValue('token', '', true)];
}

/**
 * @description 创建接口项目
 */
function createProject(name = '默认项目'): ApiProject {
  const now = Date.now();

  return {
    id: createId('project'),
    name,
    description: '',
    interfaces: [],
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * @description 根据请求配置创建接口记录
 */
function createInterfaceFromRequest(request: ApiRequestConfig, name?: string): ApiInterfaceItem {
  const now = Date.now();
  const snapshot = cloneRequest({
    ...request,
    name: name || request.name || request.url || '未命名接口',
  });

  return {
    id: createId('api-item'),
    name: snapshot.name,
    description: '',
    method: snapshot.method,
    url: snapshot.url,
    request: snapshot,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * @description 规范化键值配置列表
 */
function normalizeKeyValueList(list: unknown): KeyValueItem[] {
  if (!Array.isArray(list)) return [createKeyValue()];

  const normalized = list.map((item: any) => ({
    id: item?.id || createId('kv'),
    enabled: item?.enabled !== false,
    key: String(item?.key || ''),
    value: String(item?.value || ''),
    description: String(item?.description || ''),
  }));

  return normalized.length > 0 ? normalized : [createKeyValue()];
}

/**
 * @description 规范化接口请求配置
 */
function normalizeRequest(raw: unknown): ApiRequestConfig {
  const def = createDefaultRequest();
  const item = raw as Partial<ApiRequestConfig> | undefined;

  if (!item || typeof item !== 'object') return def;

  return {
    ...def,
    ...item,
    id: item.id || def.id,
    name: item.name || def.name,
    method: HTTP_METHODS.includes(item.method as HttpMethod) ? (item.method as HttpMethod) : def.method,
    url: String(item.url || ''),
    params: normalizeKeyValueList(item.params),
    headers: normalizeKeyValueList(item.headers),
    cookies: normalizeKeyValueList(item.cookies),
    bodyType: ['none', 'json', 'raw', 'form-urlencoded'].includes(item.bodyType as string) ? (item.bodyType as BodyType) : def.bodyType,
    bodyRaw: String(item.bodyRaw ?? def.bodyRaw),
    bodyForm: normalizeKeyValueList(item.bodyForm),
    auth: {
      ...def.auth,
      ...(item.auth || {}),
      type: ['none', 'bearer', 'basic'].includes(item.auth?.type as string) ? (item.auth?.type as AuthType) : def.auth.type,
    },
    preScript: String(item.preScript ?? def.preScript),
    postScript: String(item.postScript ?? def.postScript),
    timeout: Number(item.timeout) || def.timeout,
  };
}

/**
 * @description 规范化接口记录
 */
function normalizeInterface(raw: unknown): ApiInterfaceItem | null {
  const item = raw as Partial<ApiInterfaceItem> | undefined;

  if (!item || typeof item !== 'object') return null;

  const request = normalizeRequest(item.request || item);
  const now = Date.now();

  return {
    id: item.id || createId('api-item'),
    name: String(item.name || request.name || request.url || '未命名接口'),
    description: String(item.description || ''),
    method: HTTP_METHODS.includes(item.method as HttpMethod) ? (item.method as HttpMethod) : request.method,
    url: String(item.url || request.url || ''),
    request,
    createdAt: Number(item.createdAt) || now,
    updatedAt: Number(item.updatedAt) || now,
  };
}

/**
 * @description 规范化接口项目
 */
function normalizeProject(raw: unknown): ApiProject | null {
  const item = raw as Partial<ApiProject> | undefined;

  if (!item || typeof item !== 'object') return null;

  const now = Date.now();
  const interfaces = Array.isArray(item.interfaces) ? (item.interfaces.map(normalizeInterface).filter(Boolean) as ApiInterfaceItem[]) : [];

  return {
    id: item.id || createId('project'),
    name: String(item.name || '未命名项目'),
    description: String(item.description || ''),
    interfaces,
    createdAt: Number(item.createdAt) || now,
    updatedAt: Number(item.updatedAt) || now,
  };
}

/**
 * @description 规范化持久化状态
 */
function normalizePersistedState(raw: unknown): PersistedState {
  const state = raw as Partial<PersistedState> | undefined;
  const projects = Array.isArray(state?.projects) ? (state!.projects.map(normalizeProject).filter(Boolean) as ApiProject[]) : [];

  return {
    globals: normalizeKeyValueList(state?.globals).map((item) => ({ ...item })),
    request: normalizeRequest(state?.request),
    history: Array.isArray(state?.history) ? state!.history.slice(0, 50) : [],
    projects,
    activeProjectId: String(state?.activeProjectId || projects[0]?.id || ''),
    activeInterfaceId: String(state?.activeInterfaceId || ''),
  };
}

/**
 * @description 替换文本中的全局变量占位符
 */
function interpolateVariables(value: string, variables: Record<string, string>) {
  return String(value || '').replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_, key) => {
    return Object.prototype.hasOwnProperty.call(variables, key) ? variables[key] : '';
  });
}

/**
 * @description 将启用的键值项转换为对象
 */
function getEnabledObject(list: KeyValueItem[], variables: Record<string, string>) {
  const result: Record<string, string> = {};

  list.forEach((item) => {
    const key = item.key.trim();

    if (!item.enabled || !key) return;

    result[interpolateVariables(key, variables)] = interpolateVariables(item.value, variables);
  });

  return result;
}

/**
 * @description 尝试格式化 JSON 文本
 */
function tryFormatJson(text: string) {
  const value = String(text || '').trim();

  if (!value) return '';

  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return text;
  }
}

/**
 * @description 获取响应内容类型
 */
function getResponseContentType(response: ApiResponsePayload | null) {
  if (!response) return '';

  const key = Object.keys(response.headers || {}).find((item) => item.toLowerCase() === 'content-type');

  return key ? response.headers[key] : '';
}

/**
 * @description 获取用于展示的响应内容
 */
function getDisplayResponseBody(response: ApiResponsePayload | null) {
  if (!response) return '';

  const contentType = getResponseContentType(response).toLowerCase();

  if (contentType.includes('application/json') || /^[{[]/.test(response.body.trim())) {
    return tryFormatJson(response.body);
  }

  return response.body || '';
}

/**
 * @description 格式化字节大小
 */
function formatSize(size: number) {
  if (!size) return '0 B';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * @description 将文本安全转换为 Base64
 */
function safeBase64(value: string) {
  try {
    return btoa(unescape(encodeURIComponent(value)));
  } catch {
    return btoa(value);
  }
}

/**
 * @description 深拷贝接口请求配置
 */
function cloneRequest(request: ApiRequestConfig): ApiRequestConfig {
  return JSON.parse(JSON.stringify(request));
}

/**
 * @description 获取用于比较的键值列表
 */
function getComparableKeyValueList(list: KeyValueItem[]) {
  return (list || []).map((item) => ({
    enabled: item.enabled !== false,
    key: String(item.key || ''),
    value: String(item.value || ''),
    description: String(item.description || ''),
  }));
}

/**
 * @description 获取用于比较的请求快照
 */
function getComparableRequest(request: ApiRequestConfig) {
  return {
    name: String(request.name || ''),
    method: request.method,
    url: String(request.url || ''),
    params: getComparableKeyValueList(request.params),
    headers: getComparableKeyValueList(request.headers),
    cookies: getComparableKeyValueList(request.cookies),
    bodyType: request.bodyType,
    bodyRaw: String(request.bodyRaw || ''),
    bodyForm: getComparableKeyValueList(request.bodyForm),
    auth: {
      type: request.auth?.type || 'none',
      token: String(request.auth?.token || ''),
      username: String(request.auth?.username || ''),
      password: String(request.auth?.password || ''),
    },
    preScript: String(request.preScript || ''),
    postScript: String(request.postScript || ''),
    timeout: Number(request.timeout) || 30000,
  };
}

/**
 * @description 判断两个请求配置是否一致
 */
function isSameRequest(left: ApiRequestConfig, right: ApiRequestConfig) {
  return JSON.stringify(getComparableRequest(left)) === JSON.stringify(getComparableRequest(right));
}

/**
 * @description 判断请求是否为默认配置
 */
function isDefaultRequestSnapshot(request: ApiRequestConfig) {
  return isSameRequest(request, createDefaultRequest());
}

type ResponseEditorLanguage = 'json' | 'plaintext';

type ResponseCodeMirrorTheme = 'light' | 'dark';

interface ResponseCodeMirrorEditorProps {
  /**
   * @description 编辑器显示内容
   */
  value: string;

  /**
   * @description 编辑器语言
   */
  language: ResponseEditorLanguage;

  /**
   * @description 悬浮搜索框是否打开
   */
  searchOpen: boolean;

  /**
   * @description 当前搜索关键词
   */
  searchQuery: string;

  /**
   * @description 当前激活搜索结果下标
   */
  activeSearchIndex: number;
}

interface ResponseSearchRange {
  from: number;
  to: number;
}

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
 * @description 获取适配 VS Code 当前颜色模式的 CodeMirror 主题
 */
function getResponseCodeMirrorTheme(): ResponseCodeMirrorTheme {
  const classList = document.body.classList;

  const isDark = classList.contains('vscode-dark') || classList.contains('vscode-high-contrast');

  return isDark ? 'dark' : 'light';
}

/**
 * @description 监听 VS Code Webview 主题变化
 */
function useResponseCodeMirrorTheme(): ResponseCodeMirrorTheme {
  const [theme, setTheme] = useState<ResponseCodeMirrorTheme>(getResponseCodeMirrorTheme);

  useEffect(() => {
    const observer = new MutationObserver(() => {
      const nextTheme = getResponseCodeMirrorTheme();

      setTheme((currentTheme) => {
        return currentTheme === nextTheme ? currentTheme : nextTheme;
      });
    });

    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ['class'],
    });

    return () => {
      observer.disconnect();
    };
  }, []);

  return theme;
}

/**
 * @description 判断文本是否可能为 JSON
 */
function isJsonLikeText(value: string): boolean {
  const firstCharacter = String(value || '')
    .trim()
    .charAt(0);

  return firstCharacter === '{' || firstCharacter === '[';
}

/**
 * @description 获取响应编辑器语言
 */
function getResponseEditorLanguage(response: ApiResponsePayload | null, responseTab: ResponseTab, value: string): ResponseEditorLanguage {
  if (!response || response.error) {
    return 'plaintext';
  }

  if (responseTab === 'headers') {
    return 'json';
  }

  const contentType = getResponseContentType(response).toLowerCase();

  if (contentType.includes('application/json') || contentType.includes('+json') || isJsonLikeText(value)) {
    return 'json';
  }

  return 'plaintext';
}

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
 * @description 使用 CodeMirror 6 显示只读响应内容
 */
function ResponseCodeMirrorEditor({ value, language, searchOpen, searchQuery, activeSearchIndex }: ResponseCodeMirrorEditorProps) {
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
      className={styles['response-code-mirror']}
      width="100%"
      height={searchOpen ? 'calc(100% - 42px)' : '100%'}
      value={value}
      theme={theme}
      extensions={extensions}
      editable={false}
      readOnly
      indentWithTab={false}
      onCreateEditor={handleCreateEditor}
      basicSetup={{
        lineNumbers: true,
        highlightActiveLineGutter: false,
        highlightSpecialChars: false,
        history: false,
        foldGutter: language === 'json',
        drawSelection: true,
        dropCursor: false,
        allowMultipleSelections: false,
        indentOnInput: false,
        syntaxHighlighting: true,
        bracketMatching: language === 'json',
        closeBrackets: false,
        autocompletion: false,
        rectangularSelection: false,
        crosshairCursor: false,
        highlightActiveLine: false,
        highlightSelectionMatches: false,
        closeBracketsKeymap: false,
        defaultKeymap: false,
        searchKeymap: false,
        historyKeymap: false,
        foldKeymap: language === 'json',
        completionKeymap: false,
        lintKeymap: false,
      }}
    />
  );
}

/**
 * @description 渲染键值编辑器
 */
function KeyValueEditor(props: { items: KeyValueItem[]; onChange: (items: KeyValueItem[]) => void; keyPlaceholder?: string; valuePlaceholder?: string }) {
  const { items, onChange, keyPlaceholder = '名称', valuePlaceholder = '值' } = props;

  /**
   * @description 更新键值配置项
   */
  const updateItem = (id: string, patch: Partial<KeyValueItem>) => {
    onChange(items.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  };

  /**
   * @description 删除键值配置项
   */
  const removeItem = (id: string) => {
    const next = items.filter((item) => item.id !== id);
    onChange(next.length > 0 ? next : [createKeyValue()]);
  };

  /**
   * @description 添加键值配置项
   */
  const addItem = () => {
    onChange([...items, createKeyValue()]);
  };

  return (
    <div className={styles['kv-editor']}>
      <div className={styles['kv-head']}>
        <span />
        <span>{keyPlaceholder}</span>
        <span>{valuePlaceholder}</span>
        <span />
      </div>

      {items.map((item) => (
        <div className={styles['kv-row']} key={item.id}>
          <input type="checkbox" checked={item.enabled} onChange={(event) => updateItem(item.id, { enabled: event.target.checked })} />
          <input value={item.key} placeholder={keyPlaceholder} onChange={(event) => updateItem(item.id, { key: event.target.value })} />
          <input value={item.value} placeholder={valuePlaceholder} onChange={(event) => updateItem(item.id, { value: event.target.value })} />
          <button className={styles['icon-btn']} onClick={() => removeItem(item.id)}>
            ×
          </button>
        </div>
      ))}

      <button className={styles['ghost-btn']} onClick={addItem}>
        + 添加一行
      </button>
    </div>
  );
}

/**
 * @description 渲染 API 调试工具主页面
 */
export default function ApiDevToolsApp() {
  const [globals, setGlobals] = useState<GlobalVariable[]>(createDefaultGlobals);
  const [request, setRequest] = useState<ApiRequestConfig>(createDefaultRequest);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [projects, setProjects] = useState<ApiProject[]>([]);
  const [activeProjectId, setActiveProjectId] = useState('');
  const [activeInterfaceId, setActiveInterfaceId] = useState('');
  const [requestTab, setRequestTab] = useState<RequestTab>('params');
  const [responseTab, setResponseTab] = useState<ResponseTab>('body');
  const [isResponseSearchOpen, setIsResponseSearchOpen] = useState(false);
  const [response, setResponse] = useState<ApiResponsePayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [showGlobals, setShowGlobals] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [bottomPanelSize, setBottomPanelSize] = useState(BOTTOM_PANEL_DEFAULT_SIZE);
  const [isResizingBottomPanel, setIsResizingBottomPanel] = useState(false);
  const [workspacePaneWidth, setWorkspacePaneWidth] = useState(WORKSPACE_PANE_DEFAULT_WIDTH);
  const [isResizingWorkspacePane, setIsResizingWorkspacePane] = useState(false);
  const [sharedDocUrl, setSharedDocUrl] = useState('');
  const [isShareSelecting, setIsShareSelecting] = useState(false);
  const [shareSelectedInterfaceIds, setShareSelectedInterfaceIds] = useState<string[]>([]);
  const [manageDialog, setManageDialog] = useState<ManageDialog>(null);
  const [manageDialogValue, setManageDialogValue] = useState('');
  const [leaveConfirmDialog, setLeaveConfirmDialog] = useState<LeaveConfirmDialog>(null);

  const pendingRequestIdRef = useRef('');
  const globalsRef = useRef(globals);
  const requestRef = useRef(request);
  const historyRef = useRef(history);
  const projectsRef = useRef(projects);
  const activeProjectIdRef = useRef(activeProjectId);
  const activeInterfaceIdRef = useRef(activeInterfaceId);
  const shareSelectedInterfaceIdsRef = useRef(shareSelectedInterfaceIds);
  const globalVariablesRef = useRef<Record<string, string>>({});
  const rightPaneRef = useRef<HTMLElement | null>(null);
  const bottomPanelSizeRef = useRef(BOTTOM_PANEL_DEFAULT_SIZE);
  const workspacePaneWidthRef = useRef(WORKSPACE_PANE_DEFAULT_WIDTH);
  const dragStartYRef = useRef(0);
  const dragStartXRef = useRef(0);
  const dragStartSizeRef = useRef(BOTTOM_PANEL_DEFAULT_SIZE);
  const leaveConfirmResolverRef = useRef<((action: LeaveConfirmAction) => void) | null>(null);
  const dragStartWidthRef = useRef(WORKSPACE_PANE_DEFAULT_WIDTH);
  const isDraggingBottomPanelRef = useRef(false);
  const isDraggingWorkspacePaneRef = useRef(false);
  const bodyCursorRef = useRef('');
  const bodyUserSelectRef = useRef('');
  const bottomResizerRef = useRef<HTMLDivElement | null>(null);
  const bottomResizerPointerIdRef = useRef<number | null>(null);
  const workspaceResizerRef = useRef<HTMLDivElement | null>(null);
  const workspaceResizerPointerIdRef = useRef<number | null>(null);
  const loadedStateRef = useRef(false);
  const viewTitleActionRef = useRef<(action: ApiDevToolsViewTitleAction) => void>(() => undefined);

  /**
   * @description 计算已启用的全局变量映射
   */
  const globalVariables = useMemo(() => {
    const result: Record<string, string> = {};

    globals.forEach((item) => {
      if (!item.enabled || !item.key.trim()) return;
      result[item.key.trim()] = item.value;
    });

    return result;
  }, [globals]);

  /**
   * @description 计算当前选中的项目
   */
  const activeProject = useMemo(() => projects.find((project) => project.id === activeProjectId) || null, [projects, activeProjectId]);

  /**
   * @description 计算当前选中的接口
   */
  const activeInterface = useMemo(() => {
    if (!activeProject) return null;
    return activeProject.interfaces.find((item) => item.id === activeInterfaceId) || null;
  }, [activeProject, activeInterfaceId]);

  /**
   * @description 计算当前请求的项目绑定提示
   */
  const requestBindText = useMemo(() => {
    if (activeProject && activeInterface) {
      return `绑定项目：${activeProject.name}`;
    }

    if (activeProject) {
      return `将保存到：${activeProject.name}`;
    }

    return '未绑定项目';
  }, [activeProject, activeInterface]);

  /**
   * @description 同步全局变量引用
   */
  useEffect(() => {
    globalsRef.current = globals;
  }, [globals]);

  /**
   * @description 同步响应搜索框偏移引用
   */
  /**
   * @description 同步当前请求引用
   */
  useEffect(() => {
    requestRef.current = request;
  }, [request]);

  /**
   * @description 同步请求历史引用
   */
  useEffect(() => {
    historyRef.current = history;
  }, [history]);

  /**
   * @description 同步项目列表引用
   */
  useEffect(() => {
    projectsRef.current = projects;
  }, [projects]);

  /**
   * @description 同步当前项目标识引用
   */
  useEffect(() => {
    activeProjectIdRef.current = activeProjectId;
  }, [activeProjectId]);

  /**
   * @description 同步当前接口标识引用
   */
  useEffect(() => {
    activeInterfaceIdRef.current = activeInterfaceId;
  }, [activeInterfaceId]);

  /**
   * @description 同步文档分享接口选择引用
   */
  useEffect(() => {
    shareSelectedInterfaceIdsRef.current = shareSelectedInterfaceIds;
  }, [shareSelectedInterfaceIds]);

  /**
   * @description 同步全局变量映射引用
   */
  useEffect(() => {
    globalVariablesRef.current = globalVariables;
  }, [globalVariables]);

  /**
   * @description 同步底部面板高度引用
   */
  useEffect(() => {
    bottomPanelSizeRef.current = bottomPanelSize;
  }, [bottomPanelSize]);

  /**
   * @description 同步底部面板高度引用
   */
  useEffect(() => {
    workspacePaneWidthRef.current = workspacePaneWidth;
  }, [workspacePaneWidth]);

  /**
   * @description 获取底部面板允许的最大高度
   */
  const getBottomPanelMaxSize = useCallback(() => {
    const pane = rightPaneRef.current;

    if (!pane) {
      return BOTTOM_PANEL_MAX_SIZE;
    }

    const paneHeight = pane.getBoundingClientRect().height;

    if (!paneHeight || paneHeight < 300) {
      return BOTTOM_PANEL_MAX_SIZE;
    }

    const available = paneHeight - RESPONSE_HEAD_SIZE - RESPONSE_TABS_SIZE - BOTTOM_RESIZER_SIZE - RESPONSE_PANEL_RESERVED_SIZE;

    return Math.min(BOTTOM_PANEL_MAX_SIZE, Math.max(BOTTOM_PANEL_COLLAPSED_SIZE, available));
  }, []);

  /**
   * @description 安全设置底部面板高度
   */
  const setSafeBottomPanelSize = useCallback(
    (size: number) => {
      const nextSize = clampNumber(size, BOTTOM_PANEL_COLLAPSED_SIZE, getBottomPanelMaxSize());

      bottomPanelSizeRef.current = nextSize;
      setBottomPanelSize(nextSize);
    },
    [getBottomPanelMaxSize],
  );

  /**
   * @description 停止调整底部面板高度
   */
  const stopBottomResize = useCallback(() => {
    isDraggingBottomPanelRef.current = false;
    setIsResizingBottomPanel(false);

    const element = bottomResizerRef.current;
    const pointerId = bottomResizerPointerIdRef.current;

    if (element && pointerId !== null) {
      try {
        if (element.hasPointerCapture(pointerId)) {
          element.releasePointerCapture(pointerId);
        }
      } catch {
        // VS Code Webview 里 pointer capture 偶发不可用，直接忽略即可
      }
    }

    bottomResizerRef.current = null;
    bottomResizerPointerIdRef.current = null;

    document.body.style.cursor = bodyCursorRef.current;
    document.body.style.userSelect = bodyUserSelectRef.current;
  }, []);

  /**
   * @description 处理底部面板拖拽开始事件
   */
  const handleBottomResizerPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();

    dragStartYRef.current = event.clientY;
    dragStartSizeRef.current = bottomPanelSizeRef.current;
    isDraggingBottomPanelRef.current = true;

    bottomResizerRef.current = event.currentTarget;
    bottomResizerPointerIdRef.current = event.pointerId;

    bodyCursorRef.current = document.body.style.cursor;
    bodyUserSelectRef.current = document.body.style.userSelect;

    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';

    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // VS Code Webview 里 pointer capture 偶发失败，下面 window/document 监听兜底
    }

    setIsResizingBottomPanel(true);
  }, []);

  /**
   * @description 监听底部面板拖拽事件
   */
  useEffect(() => {
    if (!isResizingBottomPanel) return;

    /**
     * @description 处理PointerMove
     */
    const handlePointerMove = (event: PointerEvent) => {
      if (!isDraggingBottomPanelRef.current) return;

      event.preventDefault();

      const deltaY = dragStartYRef.current - event.clientY;
      const nextSize = dragStartSizeRef.current + deltaY;

      setSafeBottomPanelSize(nextSize);
    };

    /**
     * @description 处理PointerEnd
     */
    const handlePointerEnd = () => {
      stopBottomResize();
    };

    /**
     * @description 处理VisibilityChange
     */
    const handleVisibilityChange = () => {
      if (document.hidden) {
        stopBottomResize();
      }
    };

    /**
     * @description 处理MouseLeaveWebview
     */
    const handleMouseLeaveWebview = () => {
      stopBottomResize();
    };

    window.addEventListener('pointermove', handlePointerMove, { passive: false });
    window.addEventListener('pointerup', handlePointerEnd);
    window.addEventListener('pointercancel', handlePointerEnd);
    window.addEventListener('blur', handlePointerEnd);

    document.addEventListener('pointerup', handlePointerEnd);
    document.addEventListener('pointercancel', handlePointerEnd);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    document.documentElement.addEventListener('mouseleave', handleMouseLeaveWebview);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerEnd);
      window.removeEventListener('pointercancel', handlePointerEnd);
      window.removeEventListener('blur', handlePointerEnd);

      document.removeEventListener('pointerup', handlePointerEnd);
      document.removeEventListener('pointercancel', handlePointerEnd);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      document.documentElement.removeEventListener('mouseleave', handleMouseLeaveWebview);
    };
  }, [isResizingBottomPanel, setSafeBottomPanelSize, stopBottomResize]);

  /**
   * @description 安全设置项目面板宽度
   */
  const setSafeWorkspacePaneWidth = useCallback((width: number) => {
    const nextWidth = clampNumber(width, WORKSPACE_PANE_MIN_WIDTH, WORKSPACE_PANE_MAX_WIDTH);

    workspacePaneWidthRef.current = nextWidth;
    setWorkspacePaneWidth(nextWidth);
  }, []);

  /**
   * @description 停止调整项目面板宽度
   */
  const stopWorkspaceResize = useCallback(() => {
    isDraggingWorkspacePaneRef.current = false;
    setIsResizingWorkspacePane(false);

    const element = workspaceResizerRef.current;
    const pointerId = workspaceResizerPointerIdRef.current;

    if (element && pointerId !== null) {
      try {
        if (element.hasPointerCapture(pointerId)) {
          element.releasePointerCapture(pointerId);
        }
      } catch {
        // VS Code Webview 里 pointer capture 偶发不可用，直接忽略即可
      }
    }

    workspaceResizerRef.current = null;
    workspaceResizerPointerIdRef.current = null;

    document.body.style.cursor = bodyCursorRef.current;
    document.body.style.userSelect = bodyUserSelectRef.current;
  }, []);

  /**
   * @description 处理项目面板拖拽开始事件
   */
  const handleWorkspaceResizerPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();

    dragStartXRef.current = event.clientX;
    dragStartWidthRef.current = workspacePaneWidthRef.current;
    isDraggingWorkspacePaneRef.current = true;

    workspaceResizerRef.current = event.currentTarget;
    workspaceResizerPointerIdRef.current = event.pointerId;

    bodyCursorRef.current = document.body.style.cursor;
    bodyUserSelectRef.current = document.body.style.userSelect;

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // VS Code Webview 里 pointer capture 偶发失败，下面 window/document 监听兜底
    }

    setIsResizingWorkspacePane(true);
  }, []);

  /**
   * @description 监听项目面板拖拽事件
   */
  useEffect(() => {
    if (!isResizingWorkspacePane) return;

    /**
     * @description 处理PointerMove
     */
    const handlePointerMove = (event: PointerEvent) => {
      if (!isDraggingWorkspacePaneRef.current) return;

      event.preventDefault();

      const deltaX = event.clientX - dragStartXRef.current;
      const nextWidth = dragStartWidthRef.current + deltaX;

      setSafeWorkspacePaneWidth(nextWidth);
    };

    /**
     * @description 处理PointerEnd
     */
    const handlePointerEnd = () => {
      stopWorkspaceResize();
    };

    /**
     * @description 处理VisibilityChange
     */
    const handleVisibilityChange = () => {
      if (document.hidden) {
        stopWorkspaceResize();
      }
    };

    /**
     * @description 处理MouseLeaveWebview
     */
    const handleMouseLeaveWebview = () => {
      stopWorkspaceResize();
    };

    window.addEventListener('pointermove', handlePointerMove, { passive: false });
    window.addEventListener('pointerup', handlePointerEnd);
    window.addEventListener('pointercancel', handlePointerEnd);
    window.addEventListener('blur', handlePointerEnd);

    document.addEventListener('pointerup', handlePointerEnd);
    document.addEventListener('pointercancel', handlePointerEnd);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    document.documentElement.addEventListener('mouseleave', handleMouseLeaveWebview);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerEnd);
      window.removeEventListener('pointercancel', handlePointerEnd);
      window.removeEventListener('blur', handlePointerEnd);

      document.removeEventListener('pointerup', handlePointerEnd);
      document.removeEventListener('pointercancel', handlePointerEnd);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      document.documentElement.removeEventListener('mouseleave', handleMouseLeaveWebview);
    };
  }, [isResizingWorkspacePane, setSafeWorkspacePaneWidth, stopWorkspaceResize]);

  /**
   * @description 同步当前项目标识引用
   */
  useEffect(() => {
    const target = rightPaneRef.current;

    if (!target) return;

    const observer = new ResizeObserver(() => {
      setSafeBottomPanelSize(bottomPanelSizeRef.current);
    });

    observer.observe(target);

    return () => {
      observer.disconnect();
    };
  }, [setSafeBottomPanelSize]);

  /**
   * @description 保存 API 调试工具状态
   */
  const saveState = useCallback((nextState?: Partial<PersistedState>) => {
    if (!loadedStateRef.current) return;

    const state: PersistedState = {
      globals: globalsRef.current,
      request: requestRef.current,
      history: historyRef.current,
      projects: projectsRef.current,
      activeProjectId: activeProjectIdRef.current,
      activeInterfaceId: activeInterfaceIdRef.current,
      ...nextState,
    };

    vscode?.postMessage({
      type: 'saveApiDevToolsState',
      state,
    });
  }, []);

  /**
   * @description 追加运行日志
   */
  const setLog = useCallback((message: string) => {
    setLogs((prev) => [`${new Date().toLocaleTimeString()} ${message}`, ...prev].slice(0, 20));
  }, []);

  /**
   * @description 执行请求前置脚本
   */
  const runPreScript = useCallback(
    (script: string, draft: ApiRequestConfig) => {
      const code = String(script || '').trim();

      if (!code) return draft;

      try {
        const mutableRequest = cloneRequest(draft);
        const mutableGlobals = { ...globalVariablesRef.current };
        const fn = new Function('request', 'globals', 'console', code);

        fn(mutableRequest, mutableGlobals, {
          log: (...args: unknown[]) => setLog(args.map(String).join(' ')),
        });

        return mutableRequest;
      } catch (error: any) {
        setLog(`前置操作失败：${error?.message || String(error)}`);
        return draft;
      }
    },
    [setLog],
  );

  /**
   * @description 执行响应后置脚本
   */
  const runPostScript = useCallback(
    (script: string, payload: ApiResponsePayload) => {
      const code = String(script || '').trim();

      if (!code) return;

      try {
        const fn = new Function('response', 'globals', 'console', code);

        fn(
          payload,
          { ...globalVariablesRef.current },
          {
            log: (...args: unknown[]) => setLog(args.map(String).join(' ')),
          },
        );
      } catch (error: any) {
        setLog(`后置操作失败：${error?.message || String(error)}`);
      }
    },
    [setLog],
  );

  /**
   * @description 注册 VS Code 消息监听并请求初始化状态
   */
  useEffect(() => {
    vscode?.postMessage({ type: 'apiDevToolsReady' });

    /**
     * @description 处理 Extension 发送的消息
     */
    const handleMessage = (event: MessageEvent) => {
      const message = event.data;

      if (message?.type === 'apiDevToolsViewTitleAction') {
        viewTitleActionRef.current(message.action as ApiDevToolsViewTitleAction);
        return;
      }

      if (message?.type === 'apiDevToolsState') {
        const state = normalizePersistedState(message.state);

        loadedStateRef.current = true;

        setGlobals(state.globals.length ? state.globals : createDefaultGlobals());
        setRequest(state.request);
        setHistory(state.history || []);
        setProjects(state.projects || []);
        setActiveProjectId(state.activeProjectId || state.projects[0]?.id || '');
        setActiveInterfaceId(state.activeInterfaceId || '');
        return;
      }

      if (message?.type === 'apiResponse') {
        const payload = message.payload as ApiResponsePayload;

        if (payload.requestId !== pendingRequestIdRef.current) return;

        const currentRequest = requestRef.current;

        setLoading(false);
        setResponse(payload);
        setResponseTab('body');

        const nextHistoryItem: HistoryItem = {
          id: createId('history'),
          name: currentRequest.name || currentRequest.url || '未命名请求',
          method: currentRequest.method,
          url: payload.url || currentRequest.url,
          status: payload.status,
          duration: payload.duration,
          timestamp: Date.now(),
          request: cloneRequest(currentRequest),
        };

        setHistory((prev) => {
          const next = [nextHistoryItem, ...prev].slice(0, 50);

          historyRef.current = next;
          saveState({ history: next });

          return next;
        });

        runPostScript(currentRequest.postScript, payload);
        return;
      }

      if (message?.type === 'apiDocsShared') {
        const url = String(message.payload?.url || '');
        setSharedDocUrl(url);
        if (url) setLog(`接口文档已开启局域网分享：${url}`);
        return;
      }

      if (message?.type === 'apiDocsShareStopped') {
        setSharedDocUrl('');
        setLog('已关闭接口文档分享');
        return;
      }

      if (message?.type === 'apiDocsExported') {
        setLog(`接口文档已导出：${message.payload?.path || ''}`);
      }
    };

    window.addEventListener('message', handleMessage);

    return () => {
      window.removeEventListener('message', handleMessage);
    };
  }, [runPostScript, saveState, setLog]);

  /**
   * @description 延迟持久化 API 调试工具状态
   */
  useEffect(() => {
    const timer = window.setTimeout(() => {
      saveState();
    }, 300);

    return () => window.clearTimeout(timer);
  }, [globals, request, history, projects, activeProjectId, activeInterfaceId, saveState]);

  /**
   * @description 局部更新当前请求配置
   */
  const patchRequest = (patch: Partial<ApiRequestConfig>) => {
    setRequest((prev) => {
      const next = { ...prev, ...patch };

      requestRef.current = next;

      return next;
    });
  };

  /**
   * @description 构建待发送的请求参数
   */
  const buildRequestPayload = () => {
    const finalRequest = runPreScript(request.preScript, request);
    const variables = { ...globalVariables };
    let url = interpolateVariables(finalRequest.url, variables).trim();

    if (!/^https?:\/\//i.test(url)) {
      url = url.replace(/^\/+/, '');
      const baseUrl = interpolateVariables(variables.baseUrl || '', variables).replace(/\/+$/, '');
      url = baseUrl ? `${baseUrl}/${url}` : url;
    }

    const urlObject = new URL(url);

    finalRequest.params.forEach((item) => {
      if (!item.enabled || !item.key.trim()) return;

      urlObject.searchParams.set(interpolateVariables(item.key, variables), interpolateVariables(item.value, variables));
    });

    const headers = getEnabledObject(finalRequest.headers, variables);
    const cookies = getEnabledObject(finalRequest.cookies, variables);

    if (Object.keys(cookies).length > 0) {
      headers.Cookie = Object.entries(cookies)
        .map(([key, value]) => `${key}=${value}`)
        .join('; ');
    }

    if (finalRequest.auth.type === 'bearer') {
      const token = interpolateVariables(finalRequest.auth.token, variables).trim();

      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }
    }

    if (finalRequest.auth.type === 'basic') {
      const username = interpolateVariables(finalRequest.auth.username, variables);
      const password = interpolateVariables(finalRequest.auth.password, variables);

      headers.Authorization = `Basic ${safeBase64(`${username}:${password}`)}`;
    }

    let body: string | undefined;

    if (!['GET', 'HEAD'].includes(finalRequest.method)) {
      if (finalRequest.bodyType === 'json' || finalRequest.bodyType === 'raw') {
        body = interpolateVariables(finalRequest.bodyRaw, variables);

        if (finalRequest.bodyType === 'json' && !headers['Content-Type'] && !headers['content-type']) {
          headers['Content-Type'] = 'application/json';
        }
      }

      if (finalRequest.bodyType === 'form-urlencoded') {
        const params = new URLSearchParams();

        finalRequest.bodyForm.forEach((item) => {
          if (!item.enabled || !item.key.trim()) return;

          params.set(interpolateVariables(item.key, variables), interpolateVariables(item.value, variables));
        });

        body = params.toString();
        headers['Content-Type'] = 'application/x-www-form-urlencoded';
      }
    }

    return {
      finalRequest,
      payload: {
        requestId: createId('api'),
        method: finalRequest.method,
        url: urlObject.toString(),
        headers,
        body,
        timeout: finalRequest.timeout,
      },
    };
  };

  /**
   * @description 发送当前接口请求
   */
  const sendRequest = () => {
    try {
      const { payload } = buildRequestPayload();

      pendingRequestIdRef.current = payload.requestId;
      setLoading(true);
      setResponse(null);
      setLog(`发送请求：${payload.method} ${payload.url}`);

      vscode?.postMessage({
        type: 'sendApiRequest',
        payload,
      });
    } catch (error: any) {
      setLoading(false);
      setResponse({
        requestId: createId('error'),
        ok: false,
        url: request.url,
        status: 0,
        statusText: 'Invalid Request',
        duration: 0,
        size: 0,
        headers: {},
        body: '',
        error: error?.message || String(error),
      });
    }
  };

  /**
   * @description 清空 API 调试工具全部数据
   */
  const clearAllData = () => {
    const nextRequest = createDefaultRequest();
    const nextGlobals = createDefaultGlobals();

    setRequest(nextRequest);
    setGlobals(nextGlobals);
    setHistory([]);
    setProjects([]);
    setActiveProjectId('');
    setActiveInterfaceId('');
    setResponse(null);
    setLogs([]);
    setSharedDocUrl('');
    setSafeBottomPanelSize(BOTTOM_PANEL_DEFAULT_SIZE);

    vscode?.postMessage({ type: 'clearApiDevToolsState' });
  };

  /**
   * @description 打开清空全部数据确认框
   */
  const clearAll = () => {
    setManageDialog({
      kind: 'clear-all',
      title: '清空全部数据',
      message: '确定要清空所有项目、接口、历史记录、变量和当前响应吗？此操作不可撤销。',
    });
  };

  /**
   * @description 加载历史请求
   */
  const loadHistory = async (item: HistoryItem) => {
    if (!(await confirmSaveBeforeLeave())) return;

    const nextRequest = cloneRequest(item.request);

    requestRef.current = nextRequest;
    activeInterfaceIdRef.current = '';

    setRequest(nextRequest);
    setActiveInterfaceId('');
    setRequestTab('params');
    setResponse(null);
  };

  /**
   * @description 关闭项目或接口管理弹窗
   */
  const closeManageDialog = () => {
    setManageDialog(null);
    setManageDialogValue('');
  };

  /**
   * @description 根据标识获取项目
   */
  const getProjectById = (projectId: string) => {
    return projectsRef.current.find((project) => project.id === projectId) || null;
  };

  /**
   * @description 根据标识获取接口
   */
  const getInterfaceById = (projectId: string, interfaceId: string) => {
    const project = getProjectById(projectId);
    return project?.interfaces.find((item) => item.id === interfaceId) || null;
  };

  /**
   * @description 判断当前请求是否存在未保存变更
   */
  const hasUnsavedRequest = () => {
    const currentRequest = requestRef.current;
    const currentProjectId = activeProjectIdRef.current;
    const currentInterfaceId = activeInterfaceIdRef.current;

    if (currentProjectId && currentInterfaceId) {
      const currentInterface = getInterfaceById(currentProjectId, currentInterfaceId);

      if (!currentInterface) {
        return !isDefaultRequestSnapshot(currentRequest);
      }

      return !isSameRequest(currentRequest, currentInterface.request);
    }

    return !isDefaultRequestSnapshot(currentRequest);
  };

  /**
   * @description 重置指定项目的请求编辑器
   */
  const resetEditorForProject = (projectId: string) => {
    const nextRequest = createDefaultRequest();

    activeProjectIdRef.current = projectId;
    activeInterfaceIdRef.current = '';
    requestRef.current = nextRequest;

    setActiveProjectId(projectId);
    setActiveInterfaceId('');
    setRequest(nextRequest);
    setRequestTab('params');
    setResponse(null);
    setResponseTab('body');
  };

  /**
   * @description 将当前请求保存到项目
   */
  const saveCurrentRequestToProject = (options?: { silent?: boolean }) => {
    const now = Date.now();
    const snapshot = cloneRequest(requestRef.current);
    const requestName = snapshot.name || snapshot.url || '未命名接口';

    snapshot.name = requestName;

    let targetProjectId = activeProjectIdRef.current;
    let targetInterfaceId = activeInterfaceIdRef.current;
    let nextProjects = projectsRef.current.map((project) => ({
      ...project,
      interfaces: project.interfaces.map((api) => ({ ...api })),
    }));

    if (!targetProjectId || !nextProjects.some((project) => project.id === targetProjectId)) {
      const project = createProject('默认项目');

      targetProjectId = project.id;
      nextProjects = [project, ...nextProjects];
    }

    let savedRequest = cloneRequest(snapshot);
    let savedInterfaceName = requestName;
    let savedType: '新增' | '更新' = '新增';

    nextProjects = nextProjects.map((project) => {
      if (project.id !== targetProjectId) return project;

      const hasInterface = !!targetInterfaceId && project.interfaces.some((api) => api.id === targetInterfaceId);

      if (!hasInterface) {
        const api = createInterfaceFromRequest(snapshot, requestName);

        targetInterfaceId = api.id;
        savedRequest = cloneRequest(api.request);
        savedInterfaceName = api.name;

        return {
          ...project,
          updatedAt: now,
          interfaces: [api, ...project.interfaces],
        };
      }

      savedType = '更新';

      return {
        ...project,
        updatedAt: now,
        interfaces: project.interfaces.map((api) => {
          if (api.id !== targetInterfaceId) return api;

          savedInterfaceName = requestName;
          savedRequest = cloneRequest(snapshot);

          return {
            ...api,
            name: requestName,
            method: snapshot.method,
            url: snapshot.url,
            request: cloneRequest(snapshot),
            updatedAt: now,
          };
        }),
      };
    });

    projectsRef.current = nextProjects;
    activeProjectIdRef.current = targetProjectId;
    activeInterfaceIdRef.current = targetInterfaceId;
    requestRef.current = savedRequest;

    setProjects(nextProjects);
    setActiveProjectId(targetProjectId);
    setActiveInterfaceId(targetInterfaceId);
    setRequest(savedRequest);

    saveState({
      projects: nextProjects,
      activeProjectId: targetProjectId,
      activeInterfaceId: targetInterfaceId,
      request: savedRequest,
    });

    if (!options?.silent) {
      setLog(`已${savedType}接口：${savedInterfaceName}`);
    }

    return true;
  };

  /**
   * @description 放弃当前请求未保存的修改，并恢复到修改前的快照
   *
   * 说明：
   * - 当前绑定了接口时，恢复为该接口已保存的 request。
   * - 当前没有绑定接口时，恢复为默认空请求。
   * - 该方法只负责恢复当前编辑器内容，不负责切换目标项目或接口。
   */
  const discardCurrentRequestChanges = () => {
    const currentProjectId = activeProjectIdRef.current;
    const currentInterfaceId = activeInterfaceIdRef.current;
    const currentInterface = currentProjectId && currentInterfaceId ? getInterfaceById(currentProjectId, currentInterfaceId) : null;

    const restoredRequest = currentInterface ? cloneRequest(currentInterface.request) : createDefaultRequest();

    requestRef.current = restoredRequest;

    setRequest(restoredRequest);
    setResponse(null);
    setResponseTab('body');

    saveState({
      request: restoredRequest,
      activeProjectId: currentProjectId,
      activeInterfaceId: currentInterfaceId,
    });

    setLog('已放弃未保存修改');
  };

  /**
   * @description 关闭未保存确认弹窗
   */
  const closeLeaveConfirmDialog = (action: LeaveConfirmAction) => {
    const resolver = leaveConfirmResolverRef.current;

    leaveConfirmResolverRef.current = null;
    setLeaveConfirmDialog(null);

    resolver?.(action);
  };

  /**
   * @description 打开未保存确认弹窗，并等待用户选择
   *
   * 说明：
   * - VS Code Webview 里 window.confirm 体验不稳定，部分场景不会弹出。
   * - 所以这里使用 React 自定义弹窗，确保切换项目 / 接口时一定可见。
   */
  const showLeaveConfirmDialog = (): Promise<LeaveConfirmAction> => {
    if (leaveConfirmResolverRef.current) {
      leaveConfirmResolverRef.current('cancel');
      leaveConfirmResolverRef.current = null;
    }

    setLeaveConfirmDialog({
      title: '当前接口有未保存修改',
      message: '是否需要先保存当前修改？',
    });

    return new Promise((resolve) => {
      leaveConfirmResolverRef.current = resolve;
    });
  };

  /**
   * @description 离开当前接口或项目前确认是否保存未保存修改
   *
   * 交互逻辑：
   * - 没有修改：直接继续切换。
   * - 保存并切换：保存当前修改，然后继续切换。
   * - 不保存并切换：恢复到修改前内容，然后继续切换。
   * - 取消切换：留在当前接口。
   */
  const confirmSaveBeforeLeave = async () => {
    if (!hasUnsavedRequest()) return true;

    const action = await showLeaveConfirmDialog();

    if (action === 'save') {
      return saveCurrentRequestToProject({ silent: true });
    }

    if (action === 'discard') {
      discardCurrentRequestChanges();
      return true;
    }

    return false;
  };

  /**
   * @description 切换当前项目
   */
  const switchProject = async (project: ApiProject) => {
    const firstInterface = project.interfaces[0] || null;
    const targetInterfaceId = firstInterface?.id || '';
    const isSameProjectAndTargetInterface = activeProjectIdRef.current === project.id && activeInterfaceIdRef.current === targetInterfaceId;

    if (isSameProjectAndTargetInterface) return;

    if (!(await confirmSaveBeforeLeave())) return;

    if (firstInterface) {
      const nextRequest = cloneRequest(firstInterface.request);

      activeProjectIdRef.current = project.id;
      activeInterfaceIdRef.current = firstInterface.id;
      requestRef.current = nextRequest;

      setActiveProjectId(project.id);
      setActiveInterfaceId(firstInterface.id);
      setRequest(nextRequest);
      setRequestTab('params');
      setResponse(null);
      setResponseTab('body');
      setLog(`已打开接口：${firstInterface.name}`);
      return;
    }

    resetEditorForProject(project.id);
    setLog(`已切换项目：${project.name}`);
  };

  /**
   * @description 打开新增项目弹窗
   */
  const addProject = () => {
    const value = `项目 ${projectsRef.current.length + 1}`;

    setManageDialog({
      kind: 'project-create',
      title: '添加项目',
      label: '项目名称',
      value,
    });
    setManageDialogValue(value);
  };

  /**
   * @description 打开项目重命名弹窗
   */
  const renameProject = (project: ApiProject) => {
    setManageDialog({
      kind: 'project-rename',
      title: '重命名项目',
      label: '项目名称',
      value: project.name,
      projectId: project.id,
    });
    setManageDialogValue(project.name);
  };

  /**
   * @description 打开删除项目确认框
   */
  const removeProject = (project: ApiProject) => {
    setManageDialog({
      kind: 'project-delete',
      title: '删除项目',
      message: `确定删除项目「${project.name}」吗？项目下接口也会一起删除。`,
      projectId: project.id,
      projectName: project.name,
    });
    setManageDialogValue('');
  };

  /**
   * @description 打开新增接口弹窗
   */
  const addInterface = () => {
    const value = requestRef.current.name || requestRef.current.url || '未命名接口';

    setManageDialog({
      kind: 'interface-create',
      title: '添加接口',
      label: '接口名称',
      value,
    });
    setManageDialogValue(value);
  };

  /**
   * @description 保存当前接口
   */
  const saveInterface = () => {
    saveCurrentRequestToProject();
  };

  /**
   * @description 加载指定接口
   */
  const loadInterface = async (project: ApiProject, api: ApiInterfaceItem) => {
    if (activeProjectIdRef.current === project.id && activeInterfaceIdRef.current === api.id) {
      return;
    }

    if (!(await confirmSaveBeforeLeave())) return;

    const nextRequest = cloneRequest(api.request);

    activeProjectIdRef.current = project.id;
    activeInterfaceIdRef.current = api.id;
    requestRef.current = nextRequest;

    setActiveProjectId(project.id);
    setActiveInterfaceId(api.id);
    setRequest(nextRequest);
    setRequestTab('params');
    setResponse(null);
    setResponseTab('body');
    setLog(`已打开接口：${api.name}`);
  };

  /**
   * @description 打开删除接口确认框
   */
  const removeInterface = (project: ApiProject, api: ApiInterfaceItem) => {
    setManageDialog({
      kind: 'interface-delete',
      title: '删除接口',
      message: `确定删除接口「${api.name}」吗？`,
      projectId: project.id,
      interfaceId: api.id,
      interfaceName: api.name,
    });
    setManageDialogValue('');
  };

  /**
   * @description 确认项目或接口管理操作
   */
  const confirmManageDialog = async () => {
    if (!manageDialog) return;

    const value = manageDialogValue.trim();

    if (manageDialog.kind === 'clear-all') {
      clearAllData();
      closeManageDialog();
      return;
    }

    if (manageDialog.kind === 'project-create') {
      if (!value) return;
      if (!(await confirmSaveBeforeLeave())) return;

      const project = createProject(value);
      const nextProjects = [project, ...projectsRef.current];

      projectsRef.current = nextProjects;
      setProjects(nextProjects);
      resetEditorForProject(project.id);
      saveState({
        projects: nextProjects,
        activeProjectId: project.id,
        activeInterfaceId: '',
        request: requestRef.current,
      });
      setLog(`已添加项目：${value}`);
      closeManageDialog();
      return;
    }

    if (manageDialog.kind === 'project-rename') {
      if (!value || value === manageDialog.value) {
        closeManageDialog();
        return;
      }

      setProjects((prev) => prev.map((item) => (item.id === manageDialog.projectId ? { ...item, name: value, updatedAt: Date.now() } : item)));
      setLog(`已重命名项目：${value}`);
      closeManageDialog();
      return;
    }

    if (manageDialog.kind === 'interface-create') {
      if (!value) return;

      const now = Date.now();
      const snapshot = cloneRequest({ ...requestRef.current, name: value });
      let projectId = activeProjectIdRef.current;
      let nextProjects = projectsRef.current.map((project) => ({
        ...project,
        interfaces: project.interfaces.map((api) => ({ ...api })),
      }));

      if (!projectId || !nextProjects.some((project) => project.id === projectId)) {
        const project = createProject('默认项目');

        projectId = project.id;
        nextProjects = [project, ...nextProjects];
      }

      const api = createInterfaceFromRequest(snapshot, value);

      nextProjects = nextProjects.map((project) => (project.id === projectId ? { ...project, interfaces: [api, ...project.interfaces], updatedAt: now } : project));

      projectsRef.current = nextProjects;
      activeProjectIdRef.current = projectId;
      activeInterfaceIdRef.current = api.id;
      requestRef.current = cloneRequest(api.request);

      setProjects(nextProjects);
      setRequest(cloneRequest(api.request));
      setActiveProjectId(projectId);
      setActiveInterfaceId(api.id);
      saveState({
        projects: nextProjects,
        activeProjectId: projectId,
        activeInterfaceId: api.id,
        request: api.request,
      });
      setLog(`已添加接口：${value}`);
      closeManageDialog();
      return;
    }

    if (manageDialog.kind === 'project-delete') {
      const nextProjects = projectsRef.current.filter((item) => item.id !== manageDialog.projectId);
      const nextProject = nextProjects[0];

      projectsRef.current = nextProjects;
      setProjects(nextProjects);

      if (activeProjectIdRef.current === manageDialog.projectId) {
        if (nextProject) {
          resetEditorForProject(nextProject.id);
        } else {
          const nextRequest = createDefaultRequest();

          activeProjectIdRef.current = '';
          activeInterfaceIdRef.current = '';
          requestRef.current = nextRequest;
          setActiveProjectId('');
          setActiveInterfaceId('');
          setRequest(nextRequest);
          setResponse(null);
        }
      }

      saveState({
        projects: nextProjects,
        activeProjectId: activeProjectIdRef.current,
        activeInterfaceId: activeInterfaceIdRef.current,
        request: requestRef.current,
      });
      setLog(`已删除项目：${manageDialog.projectName}`);
      closeManageDialog();
      return;
    }

    if (manageDialog.kind === 'interface-delete') {
      const nextProjects = projectsRef.current.map((item) =>
        item.id === manageDialog.projectId
          ? {
              ...item,
              interfaces: item.interfaces.filter((current) => current.id !== manageDialog.interfaceId),
              updatedAt: Date.now(),
            }
          : item,
      );

      projectsRef.current = nextProjects;
      setProjects(nextProjects);

      if (activeInterfaceIdRef.current === manageDialog.interfaceId) {
        resetEditorForProject(activeProjectIdRef.current || manageDialog.projectId);
      }

      saveState({
        projects: nextProjects,
        activeProjectId: activeProjectIdRef.current,
        activeInterfaceId: activeInterfaceIdRef.current,
        request: requestRef.current,
      });
      setLog(`已删除接口：${manageDialog.interfaceName}`);
      closeManageDialog();
    }
  };

  /**
   * @description 获取全部接口标识
   */
  const getAllInterfaceIds = () => projectsRef.current.flatMap((project) => project.interfaces.map((api) => api.id));

  /**
   * @description 获取选中用于分享的项目数据
   */
  const getShareProjects = (selectedIds = shareSelectedInterfaceIdsRef.current) => {
    const selectedIdSet = new Set(selectedIds);
    const activeProjectIdValue = activeProjectIdRef.current;
    const activeInterfaceIdValue = activeInterfaceIdRef.current;

    return projectsRef.current
      .map((project) => {
        const interfaces = project.interfaces
          .filter((api) => selectedIdSet.has(api.id))
          .map((api) => {
            if (project.id !== activeProjectIdValue || api.id !== activeInterfaceIdValue) {
              return {
                ...api,
                request: cloneRequest(api.request),
              };
            }

            const liveRequest = cloneRequest(requestRef.current);
            const liveName = liveRequest.name || api.name || '未命名接口';

            return {
              ...api,
              name: liveName,
              method: liveRequest.method,
              url: liveRequest.url,
              request: liveRequest,
              updatedAt: Date.now(),
            };
          });

        return {
          ...project,
          interfaces,
        };
      })
      .filter((project) => project.interfaces.length > 0);
  };

  /**
   * @description 创建接口文档 HTML
   */
  const createDocsHtml = (docsProjects = projectsRef.current): string => {
    return buildApiDocsHtml({
      projects: docsProjects,
      globals: globalsRef.current,
      currentRequest: requestRef.current,
      activeProjectId: activeProjectIdRef.current,
      activeInterfaceId: activeInterfaceIdRef.current,
    });
  };

  /**
   * @description 进入接口文档分享选择状态
   */
  const shareDocs = () => {
    const allInterfaceIds = getAllInterfaceIds();

    if (allInterfaceIds.length === 0) {
      setLog('没有可分享的接口');
      return;
    }

    setShareSelectedInterfaceIds((current) => {
      const validIdSet = new Set(allInterfaceIds);
      const next = current.filter((id) => validIdSet.has(id));

      return next.length > 0 ? next : allInterfaceIds;
    });
    setIsShareSelecting(true);
    setLog('请选择需要分享的接口');
  };

  /**
   * @description 确认分享选中的接口文档
   */
  const confirmShareDocs = () => {
    const shareProjects = getShareProjects();

    if (shareProjects.length === 0) {
      setLog('请至少选择一个需要分享的接口');
      return;
    }

    vscode?.postMessage({
      type: 'shareApiDocs',
      payload: {
        html: createDocsHtml(shareProjects),
        fileName: 'q-ops-api-docs.html',
      },
    });
    setIsShareSelecting(false);
  };

  /**
   * @description 取消接口文档分享选择
   */
  const cancelShareSelect = () => {
    setIsShareSelecting(false);
  };

  /**
   * @description 切换接口文档分享选择状态
   */
  const toggleShareInterface = (interfaceId: string) => {
    setShareSelectedInterfaceIds((current) => (current.includes(interfaceId) ? current.filter((id) => id !== interfaceId) : [...current, interfaceId]));
  };

  /**
   * @description 导出接口文档
   */
  const exportDocs = () => {
    vscode?.postMessage({ type: 'exportApiDocsHtml', payload: { html: createDocsHtml(), fileName: 'q-ops-api-docs.html' } });
  };

  /**
   * @description 处理组件副作用
   */
  useEffect(() => {
    if (!sharedDocUrl || !loadedStateRef.current) return;

    const timer = window.setTimeout(() => {
      const shareProjects = getShareProjects();

      if (shareProjects.length === 0) return;

      vscode?.postMessage({
        type: 'updateApiDocsShare',
        payload: { html: createDocsHtml(shareProjects), fileName: 'q-ops-api-docs.html' },
      });
    }, 300);

    return () => window.clearTimeout(timer);
  }, [globals, request, projects, activeProjectId, activeInterfaceId, sharedDocUrl, shareSelectedInterfaceIds]);

  /**
   * @description 停止接口文档分享
   */
  const stopShareDocs = () => {
    vscode?.postMessage({ type: 'stopApiDocsShare' });
  };

  /**
   * @description 复制接口文档分享地址
   */
  const copySharedUrl = () => {
    if (!sharedDocUrl) return;
    navigator.clipboard?.writeText(sharedDocUrl);
    setLog('已复制分享地址');
  };

  /**
   * @description 打开接口文档分享地址
   */
  const openSharedUrl = () => {
    if (!sharedDocUrl) return;

    vscode?.postMessage({
      type: 'openExternalUrl',
      payload: {
        url: sharedDocUrl,
      },
    });
  };

  const responseBody = getDisplayResponseBody(response);

  /**
   * @description 计算当前响应页签的编辑器内容
   */
  const responseEditorValue = useMemo(() => {
    if (!response) return '';

    if (response.error) {
      return response.error;
    }

    if (responseTab === 'headers') {
      return JSON.stringify(response.headers, null, 2);
    }

    if (responseTab === 'raw') {
      return response.body || '';
    }

    return responseBody;
  }, [response, responseBody, responseTab]);

  /**
   * @description 计算当前响应页签的编辑器语言
   */
  const responseEditorLanguage = useMemo(() => {
    return getResponseEditorLanguage(response, responseTab, responseEditorValue);
  }, [response, responseEditorValue, responseTab]);

  /**
   * @description 打开响应内容搜索框
   */
  const openResponseSearch = () => {
    if (!response) return;

    setIsResponseSearchOpen(true);
  };

  /**
   * @description 将 VS Code 原生 View 标题栏操作分发给页面现有业务函数
   */
  viewTitleActionRef.current = (action: ApiDevToolsViewTitleAction) => {
    switch (action) {
      case 'add-project':
        addProject();
        break;

      case 'add-interface':
        addInterface();
        break;

      case 'save-interface':
        saveInterface();
        break;

      case 'share-docs':
        shareDocs();
        break;

      case 'export-docs':
        exportDocs();
        break;

      case 'show-globals':
        setShowGlobals(true);
        break;

      case 'clear-all':
        clearAll();
        break;

      case 'send-request':
        if (!loading) {
          sendRequest();
        }
        break;

      default:
        break;
    }
  };

  const bottomPanelMaxSize = getBottomPanelMaxSize();
  const interfaceCount = projects.reduce((sum, project) => sum + project.interfaces.length, 0);

  return (
    <div className={styles['api-devtools']}>
      <main
        className={styles['main']}
        style={
          {
            '--api-workspace-width': `${workspacePaneWidth}px`,
            '--api-workspace-resizer-size': `${WORKSPACE_RESIZER_SIZE}px`,
          } as React.CSSProperties
        }
      >
        <aside className={styles['workspace-pane']}>
          <div className={styles['workspace-head']}>
            <strong>项目接口</strong>
            <span>
              {projects.length}/{interfaceCount}
            </span>
          </div>

          {sharedDocUrl && (
            <div className={styles['share-card']}>
              <div className={styles['share-title']}>文档分享中</div>

              <div className={styles['share-url-row']}>
                <button className={styles['share-url']} title="点击后确认是否在外部浏览器打开" onClick={openSharedUrl}>
                  {sharedDocUrl}
                </button>
                <button className={styles['share-copy-btn']} title="复制链接" onClick={copySharedUrl}>
                  <i className="codicon codicon-copy" />
                </button>
              </div>

              <div className={styles['share-card-actions']}>
                <button className={styles['tiny-btn']} onClick={openSharedUrl}>
                  预览链接
                </button>
                <button className={styles['tiny-btn']} onClick={stopShareDocs}>
                  关闭分享
                </button>
              </div>
            </div>
          )}

          <div className={styles['project-list']}>
            {projects.length === 0 ? (
              <div className={styles['empty-project']}>
                <div>暂无项目</div>
                <button className={styles['ghost-btn']} onClick={addProject}>
                  + 添加项目
                </button>
              </div>
            ) : (
              projects.map((project) => (
                <div
                  key={project.id}
                  className={[styles['project-card'], activeProjectId === project.id ? styles['project-card-active'] : ''].filter(Boolean).join(' ')}
                  onClick={() => switchProject(project)}
                >
                  <div className={styles['project-title-row']}>
                    <button
                      className={styles['project-title']}
                      onClick={(event) => {
                        event.stopPropagation();
                        switchProject(project);
                      }}
                    >
                      {project.name}
                    </button>
                    <button
                      className={styles['tiny-btn']}
                      onClick={(event) => {
                        event.stopPropagation();
                        renameProject(project);
                      }}
                    >
                      改
                    </button>
                    <button
                      className={styles['tiny-btn']}
                      onClick={(event) => {
                        event.stopPropagation();
                        removeProject(project);
                      }}
                    >
                      删
                    </button>
                  </div>
                  <div className={styles['interface-list']}>
                    {project.interfaces.length === 0 ? (
                      <div className={styles['mini-empty']}>暂无接口</div>
                    ) : (
                      project.interfaces.map((api) => (
                        <div
                          key={api.id}
                          className={[
                            styles['interface-item'],
                            isShareSelecting ? styles['interface-item-share-mode'] : '',
                            activeProjectId === project.id && activeInterfaceId === api.id ? styles['interface-item-active'] : '',
                          ]
                            .filter(Boolean)
                            .join(' ')}
                        >
                          {isShareSelecting && (
                            <label className={styles['share-checkbox']} onClick={(event) => event.stopPropagation()}>
                              <input type="checkbox" checked={shareSelectedInterfaceIds.includes(api.id)} onChange={() => toggleShareInterface(api.id)} />
                            </label>
                          )}

                          <button
                            className={styles['interface-main']}
                            onClick={(event) => {
                              event.stopPropagation();
                              loadInterface(project, api);
                            }}
                          >
                            <span className={styles[`method-${api.method.toLowerCase()}`]}>{api.method}</span>
                            <span className={styles['interface-name']}>{api.name}</span>
                            <span className={styles['interface-url']}>{api.url}</span>
                          </button>
                          <button
                            className={styles['interface-remove']}
                            onClick={(event) => {
                              event.stopPropagation();
                              removeInterface(project, api);
                            }}
                          >
                            ×
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              ))
            )}
          </div>

          {isShareSelecting && (
            <div className={styles['share-select-actions']}>
              <div className={styles['share-select-count']}>已选择 {shareSelectedInterfaceIds.length} 个接口</div>
              <button className={styles['ghost-btn']} onClick={cancelShareSelect}>
                取消
              </button>
              <button className={styles['primary-btn']} onClick={confirmShareDocs}>
                确认分享
              </button>
            </div>
          )}
        </aside>

        <div
          className={[styles['workspace-resizer'], isResizingWorkspacePane ? styles['workspace-resizer-active'] : ''].filter(Boolean).join(' ')}
          title="拖拽调整项目接口宽度"
          onPointerDown={handleWorkspaceResizerPointerDown}
        />

        <section className={styles['left-pane']}>
          <div className={styles['request-line']}>
            <select className={styles['method-select']} value={request.method} onChange={(event) => patchRequest({ method: event.target.value as HttpMethod })}>
              {HTTP_METHODS.map((method) => (
                <option key={method} value={method}>
                  {method}
                </option>
              ))}
            </select>

            <input
              className={styles['url-input']}
              value={request.url}
              placeholder="请输入请求地址，例如 {{baseUrl}}/api/user"
              onChange={(event) => patchRequest({ url: event.target.value })}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                  sendRequest();
                }
              }}
            />

            <input
              className={styles['timeout-input']}
              value={request.timeout}
              type="number"
              min={1000}
              title="超时时间 ms"
              onChange={(event) => patchRequest({ timeout: Number(event.target.value) || 30000 })}
            />
          </div>

          <div className={styles['request-name-line']}>
            <input className={styles['request-name-input']} value={request.name} placeholder="接口名称" onChange={(event) => patchRequest({ name: event.target.value })} />
            <span title={requestBindText}>{requestBindText}</span>
          </div>

          <div className={styles['tabs']}>
            {REQUEST_TABS.map((tab) => (
              <button key={tab.key} className={requestTab === tab.key ? styles.active : ''} onClick={() => setRequestTab(tab.key)}>
                {tab.label}
              </button>
            ))}
          </div>

          <div className={styles['request-panel']}>
            {requestTab === 'params' && <KeyValueEditor items={request.params} onChange={(params) => patchRequest({ params })} keyPlaceholder="参数名" valuePlaceholder="参数值" />}

            {requestTab === 'headers' && (
              <KeyValueEditor items={request.headers} onChange={(headers) => patchRequest({ headers })} keyPlaceholder="Header" valuePlaceholder="Value" />
            )}

            {requestTab === 'cookies' && (
              <KeyValueEditor items={request.cookies} onChange={(cookies) => patchRequest({ cookies })} keyPlaceholder="Cookie" valuePlaceholder="Value" />
            )}

            {requestTab === 'auth' && (
              <div className={styles['auth-panel']}>
                <label>
                  <span>认证类型</span>
                  <select value={request.auth.type} onChange={(event) => patchRequest({ auth: { ...request.auth, type: event.target.value as AuthType } })}>
                    <option value="none">None</option>
                    <option value="bearer">Bearer Token</option>
                    <option value="basic">Basic Auth</option>
                  </select>
                </label>

                {request.auth.type === 'bearer' && (
                  <label>
                    <span>Token</span>
                    <input value={request.auth.token} placeholder="{{token}}" onChange={(event) => patchRequest({ auth: { ...request.auth, token: event.target.value } })} />
                  </label>
                )}

                {request.auth.type === 'basic' && (
                  <>
                    <label>
                      <span>Username</span>
                      <input value={request.auth.username} onChange={(event) => patchRequest({ auth: { ...request.auth, username: event.target.value } })} />
                    </label>
                    <label>
                      <span>Password</span>
                      <input type="password" value={request.auth.password} onChange={(event) => patchRequest({ auth: { ...request.auth, password: event.target.value } })} />
                    </label>
                  </>
                )}
              </div>
            )}

            {requestTab === 'body' && (
              <div className={styles['body-panel']}>
                <div className={styles['body-type-row']}>
                  {(['none', 'json', 'raw', 'form-urlencoded'] as BodyType[]).map((type) => (
                    <label key={type}>
                      <input type="radio" checked={request.bodyType === type} onChange={() => patchRequest({ bodyType: type })} />
                      <span>{type}</span>
                    </label>
                  ))}
                </div>

                {request.bodyType === 'none' && <div className={styles['empty-state']}>该请求不发送 Body</div>}

                {(request.bodyType === 'json' || request.bodyType === 'raw') && (
                  <textarea className={styles['code-editor']} spellCheck={false} value={request.bodyRaw} onChange={(event) => patchRequest({ bodyRaw: event.target.value })} />
                )}

                {request.bodyType === 'form-urlencoded' && (
                  <KeyValueEditor items={request.bodyForm} onChange={(bodyForm) => patchRequest({ bodyForm })} keyPlaceholder="字段名" valuePlaceholder="字段值" />
                )}
              </div>
            )}

            {requestTab === 'pre' && (
              <textarea className={styles['code-editor']} spellCheck={false} value={request.preScript} onChange={(event) => patchRequest({ preScript: event.target.value })} />
            )}

            {requestTab === 'post' && (
              <textarea className={styles['code-editor']} spellCheck={false} value={request.postScript} onChange={(event) => patchRequest({ postScript: event.target.value })} />
            )}
          </div>
        </section>

        <section ref={rightPaneRef} className={styles['right-pane']}>
          <div className={styles['response-head']}>
            <strong>返回响应</strong>
            <div className={styles['response-head-actions']}>
              <div className={styles['response-meta']}>
                {response && (
                  <>
                    <span className={response.ok ? styles['status-ok'] : styles['status-error']}>{response.status || response.statusText}</span>
                    <span>{response.duration} ms</span>
                    <span>{formatSize(response.size)}</span>
                  </>
                )}
              </div>

              <button className={styles['icon-btn']} title="搜索响应内容" disabled={!response} onClick={openResponseSearch}>
                <i className="codicon codicon-search" />
              </button>
            </div>
          </div>

          <div className={styles['tabs']}>
            {RESPONSE_TABS.map((tab) => (
              <button key={tab.key} className={responseTab === tab.key ? styles.active : ''} onClick={() => setResponseTab(tab.key)}>
                {tab.label}
              </button>
            ))}
          </div>

          <BaseSearch
            open={isResponseSearchOpen}
            text={responseEditorValue}
            className={styles['response-panel']}
            placeholder="搜索响应..."
            maxWidth={560}
            onClose={() => {
              setIsResponseSearchOpen(false);
            }}
          >
            {({ query, activeIndex }) => (
              <>
                {loading && <div className={styles['empty-state']}>正在请求...</div>}

                {!loading && !response && (
                  <div className={styles['empty-state']}>
                    <div className={styles.rocket}>🚀</div>

                    <div>点击“发送”按钮获取返回结果</div>
                  </div>
                )}

                {!loading && response && (
                  <ResponseCodeMirrorEditor
                    value={responseEditorValue}
                    language={responseEditorLanguage}
                    searchOpen={isResponseSearchOpen}
                    searchQuery={query}
                    activeSearchIndex={activeIndex}
                  />
                )}
              </>
            )}
          </BaseSearch>

          <div
            className={[styles['bottom-resizer'], isResizingBottomPanel ? styles['bottom-resizer-active'] : ''].filter(Boolean).join(' ')}
            title="拖拽调整历史记录/脚本日志高度"
            onPointerDown={handleBottomResizerPointerDown}
          />

          <div
            className={styles['bottom-panels']}
            style={{
              height: `${bottomPanelSize}px`,
              flexBasis: `${bottomPanelSize}px`,
              maxHeight: `${bottomPanelMaxSize}px`,
            }}
          >
            <div className={styles['history-panel']}>
              <div className={styles['sub-title']}>历史记录</div>
              {history.length === 0 ? (
                <div className={styles['mini-empty']}>暂无历史</div>
              ) : (
                history.map((item) => (
                  <button key={item.id} className={styles['history-item']} onClick={() => loadHistory(item)}>
                    <span className={styles[`method-${item.method.toLowerCase()}`]}>{item.method}</span>
                    <span className={styles['history-url']}>{item.url}</span>
                    <span>{item.status}</span>
                  </button>
                ))
              )}
            </div>

            <div className={styles['log-panel']}>
              <div className={styles['sub-title']}>脚本日志</div>
              {logs.length === 0 ? (
                <div className={styles['mini-empty']}>暂无日志</div>
              ) : (
                logs.map((item, index) => (
                  <div key={`${item}-${index}`} className={styles['log-item']}>
                    {item}
                  </div>
                ))
              )}
            </div>
          </div>
        </section>
      </main>

      <BaseDialog
        open={Boolean(manageDialog)}
        title={manageDialog?.title || ''}
        width={420}
        placement="center"
        onClose={closeManageDialog}
        actions={
          manageDialog
            ? [
                {
                  key: 'cancel',
                  label: '取消',
                  onClick: closeManageDialog,
                },
                {
                  key: 'confirm',
                  label: 'message' in manageDialog ? (manageDialog.kind === 'clear-all' ? '清空' : '删除') : '确定',
                  type: 'message' in manageDialog ? 'danger' : 'primary',
                  onClick: confirmManageDialog,
                },
              ]
            : []
        }
      >
        {manageDialog &&
          ('message' in manageDialog ? (
            <div className={styles['dialog-message']}>{manageDialog.message}</div>
          ) : (
            <label className={styles['dialog-field']}>
              <span>{manageDialog.label}</span>

              <input
                autoFocus
                className={styles['dialog-input']}
                value={manageDialogValue}
                onChange={(event) => {
                  setManageDialogValue(event.target.value);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    void confirmManageDialog();
                  }
                }}
              />
            </label>
          ))}
      </BaseDialog>

      <BaseDialog
        open={Boolean(leaveConfirmDialog)}
        title={leaveConfirmDialog?.title || ''}
        width={420}
        placement="center"
        onClose={() => {
          closeLeaveConfirmDialog('cancel');
        }}
        footer={
          <>
            <button
              type="button"
              className={styles['ghost-btn']}
              onClick={() => {
                closeLeaveConfirmDialog('cancel');
              }}
            >
              取消切换
            </button>

            <button
              type="button"
              className={styles['ghost-btn']}
              onClick={() => {
                closeLeaveConfirmDialog('discard');
              }}
            >
              不保存并切换
            </button>

            <button
              type="button"
              className={styles['primary-btn']}
              onClick={() => {
                closeLeaveConfirmDialog('save');
              }}
            >
              保存并切换
            </button>
          </>
        }
      >
        {leaveConfirmDialog && (
          <div className={styles['dialog-message']}>
            {leaveConfirmDialog.message}

            <br />

            <span className={styles.hint}>保存后继续切换，或不保存并恢复到修改前内容。</span>
          </div>
        )}
      </BaseDialog>

      <BaseDialog
        open={showGlobals}
        title="全局变量"
        width="min(680px, 92vw)"
        placement="right"
        onClose={() => {
          setShowGlobals(false);
        }}
        actions={[
          {
            key: 'complete',
            label: '完成',
            type: 'primary',
            onClick: () => {
              setShowGlobals(false);
            },
          },
        ]}
      >
        <p className={styles.hint}>
          请求地址、Headers、Body 中可以使用 <code>{'{{baseUrl}}'}</code>、<code>{'{{token}}'}</code> 这类变量。
        </p>

        <KeyValueEditor
          items={globals}
          onChange={(items) => {
            const nextGlobals = items.map((item) => ({
              ...item,
            }));

            globalsRef.current = nextGlobals;

            setGlobals(nextGlobals);
          }}
          keyPlaceholder="变量名"
          valuePlaceholder="变量值"
        />
      </BaseDialog>
    </div>
  );
}
