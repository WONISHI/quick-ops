import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { vscode } from '../../utils/vscode';
import styles from './index.module.css';

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';
type RequestTab = 'params' | 'body' | 'headers' | 'cookies' | 'auth' | 'pre' | 'post';
type ResponseTab = 'body' | 'headers' | 'raw';
type BodyType = 'none' | 'json' | 'raw' | 'form-urlencoded';
type AuthType = 'none' | 'bearer' | 'basic';

interface KeyValueItem {
  id: string;
  enabled: boolean;
  key: string;
  value: string;
  description?: string;
}

type GlobalVariable = KeyValueItem;

interface AuthConfig {
  type: AuthType;
  token: string;
  username: string;
  password: string;
}

interface ApiRequestConfig {
  id: string;
  name: string;
  method: HttpMethod;
  url: string;
  params: KeyValueItem[];
  headers: KeyValueItem[];
  cookies: KeyValueItem[];
  bodyType: BodyType;
  bodyRaw: string;
  bodyForm: KeyValueItem[];
  auth: AuthConfig;
  preScript: string;
  postScript: string;
  timeout: number;
}

interface HistoryItem {
  id: string;
  name: string;
  method: HttpMethod;
  url: string;
  status: number;
  duration: number;
  timestamp: number;
  request: ApiRequestConfig;
}

interface ApiResponsePayload {
  requestId: string;
  ok: boolean;
  url: string;
  status: number;
  statusText: string;
  duration: number;
  size: number;
  headers: Record<string, string>;
  body: string;
  error?: string;
}

interface PersistedState {
  globals: GlobalVariable[];
  request: ApiRequestConfig;
  history: HistoryItem[];
}

const HTTP_METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

const REQUEST_TABS: Array<{ key: RequestTab; label: string }> = [
  { key: 'params', label: 'Params' },
  { key: 'body', label: 'Body' },
  { key: 'headers', label: 'Headers' },
  { key: 'cookies', label: 'Cookies' },
  { key: 'auth', label: 'Auth' },
  { key: 'pre', label: '前置操作' },
  { key: 'post', label: '后置操作' },
];

const RESPONSE_TABS: Array<{ key: ResponseTab; label: string }> = [
  { key: 'body', label: 'Body' },
  { key: 'headers', label: 'Headers' },
  { key: 'raw', label: 'Raw' },
];

const BOTTOM_PANEL_COLLAPSED_SIZE = 0;
const BOTTOM_PANEL_DEFAULT_SIZE = 180;
const BOTTOM_PANEL_MAX_SIZE = 520;
const RESPONSE_PANEL_RESERVED_SIZE = 150;
const RESPONSE_HEAD_SIZE = 42;
const RESPONSE_TABS_SIZE = 39;
const BOTTOM_RESIZER_SIZE = 8;

function clampNumber(value: number, min: number, max: number) {
  const safeMax = Math.max(min, max);
  return Math.min(Math.max(value, min), safeMax);
}

function createId(prefix = 'id') {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function createKeyValue(key = '', value = '', enabled = true): KeyValueItem {
  return {
    id: createId('kv'),
    enabled,
    key,
    value,
  };
}

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

function createDefaultGlobals(): GlobalVariable[] {
  return [
    createKeyValue('baseUrl', 'http://localhost:3000', true),
    createKeyValue('token', '', true),
  ];
}

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
    bodyType: ['none', 'json', 'raw', 'form-urlencoded'].includes(item.bodyType as string)
      ? (item.bodyType as BodyType)
      : def.bodyType,
    bodyRaw: String(item.bodyRaw ?? def.bodyRaw),
    bodyForm: normalizeKeyValueList(item.bodyForm),
    auth: {
      ...def.auth,
      ...(item.auth || {}),
      type: ['none', 'bearer', 'basic'].includes(item.auth?.type as string)
        ? (item.auth?.type as AuthType)
        : def.auth.type,
    },
    preScript: String(item.preScript ?? def.preScript),
    postScript: String(item.postScript ?? def.postScript),
    timeout: Number(item.timeout) || def.timeout,
  };
}

function normalizePersistedState(raw: unknown): PersistedState {
  const state = raw as Partial<PersistedState> | undefined;

  return {
    globals: normalizeKeyValueList(state?.globals).map((item) => ({ ...item })),
    request: normalizeRequest(state?.request),
    history: Array.isArray(state?.history) ? state!.history.slice(0, 50) : [],
  };
}

function interpolateVariables(value: string, variables: Record<string, string>) {
  return String(value || '').replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_, key) => {
    return Object.prototype.hasOwnProperty.call(variables, key) ? variables[key] : '';
  });
}

function getEnabledObject(list: KeyValueItem[], variables: Record<string, string>) {
  const result: Record<string, string> = {};

  list.forEach((item) => {
    const key = item.key.trim();

    if (!item.enabled || !key) return;

    result[interpolateVariables(key, variables)] = interpolateVariables(item.value, variables);
  });

  return result;
}

function tryFormatJson(text: string) {
  const value = String(text || '').trim();

  if (!value) return '';

  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return text;
  }
}

function getResponseContentType(response: ApiResponsePayload | null) {
  if (!response) return '';

  const key = Object.keys(response.headers || {}).find((item) => item.toLowerCase() === 'content-type');

  return key ? response.headers[key] : '';
}

function getDisplayResponseBody(response: ApiResponsePayload | null) {
  if (!response) return '';

  const contentType = getResponseContentType(response).toLowerCase();

  if (contentType.includes('application/json') || /^[\[{]/.test(response.body.trim())) {
    return tryFormatJson(response.body);
  }

  return response.body || '';
}

function formatSize(size: number) {
  if (!size) return '0 B';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function safeBase64(value: string) {
  try {
    return btoa(unescape(encodeURIComponent(value)));
  } catch {
    return btoa(value);
  }
}

function cloneRequest(request: ApiRequestConfig): ApiRequestConfig {
  return JSON.parse(JSON.stringify(request));
}

function KeyValueEditor(props: {
  items: KeyValueItem[];
  onChange: (items: KeyValueItem[]) => void;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
}) {
  const { items, onChange, keyPlaceholder = '名称', valuePlaceholder = '值' } = props;

  const updateItem = (id: string, patch: Partial<KeyValueItem>) => {
    onChange(items.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  };

  const removeItem = (id: string) => {
    const next = items.filter((item) => item.id !== id);
    onChange(next.length > 0 ? next : [createKeyValue()]);
  };

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
          <input
            type="checkbox"
            checked={item.enabled}
            onChange={(event) => updateItem(item.id, { enabled: event.target.checked })}
          />
          <input
            value={item.key}
            placeholder={keyPlaceholder}
            onChange={(event) => updateItem(item.id, { key: event.target.value })}
          />
          <input
            value={item.value}
            placeholder={valuePlaceholder}
            onChange={(event) => updateItem(item.id, { value: event.target.value })}
          />
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

export default function ApiDevToolsApp() {
  const [globals, setGlobals] = useState<GlobalVariable[]>(createDefaultGlobals);
  const [request, setRequest] = useState<ApiRequestConfig>(createDefaultRequest);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [requestTab, setRequestTab] = useState<RequestTab>('params');
  const [responseTab, setResponseTab] = useState<ResponseTab>('body');
  const [response, setResponse] = useState<ApiResponsePayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [showGlobals, setShowGlobals] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [bottomPanelSize, setBottomPanelSize] = useState(BOTTOM_PANEL_DEFAULT_SIZE);
  const [isResizingBottomPanel, setIsResizingBottomPanel] = useState(false);

  const pendingRequestIdRef = useRef('');
  const globalsRef = useRef(globals);
  const requestRef = useRef(request);
  const historyRef = useRef(history);
  const globalVariablesRef = useRef<Record<string, string>>({});
  const rightPaneRef = useRef<HTMLElement | null>(null);
  const bottomPanelSizeRef = useRef(BOTTOM_PANEL_DEFAULT_SIZE);
  const dragStartYRef = useRef(0);
  const dragStartSizeRef = useRef(BOTTOM_PANEL_DEFAULT_SIZE);
  const isDraggingBottomPanelRef = useRef(false);
  const bodyCursorRef = useRef('');
  const bodyUserSelectRef = useRef('');
  const bottomResizerRef = useRef<HTMLDivElement | null>(null);
  const bottomResizerPointerIdRef = useRef<number | null>(null);
  const loadedStateRef = useRef(false);

  const globalVariables = useMemo(() => {
    const result: Record<string, string> = {};

    globals.forEach((item) => {
      if (!item.enabled || !item.key.trim()) return;
      result[item.key.trim()] = item.value;
    });

    return result;
  }, [globals]);

  useEffect(() => {
    globalsRef.current = globals;
  }, [globals]);

  useEffect(() => {
    requestRef.current = request;
  }, [request]);

  useEffect(() => {
    historyRef.current = history;
  }, [history]);

  useEffect(() => {
    globalVariablesRef.current = globalVariables;
  }, [globalVariables]);

  useEffect(() => {
    bottomPanelSizeRef.current = bottomPanelSize;
  }, [bottomPanelSize]);

  const getBottomPanelMaxSize = useCallback(() => {
    const pane = rightPaneRef.current;

    if (!pane) {
      return BOTTOM_PANEL_MAX_SIZE;
    }

    const paneHeight = pane.getBoundingClientRect().height;

    if (!paneHeight || paneHeight < 300) {
      return BOTTOM_PANEL_MAX_SIZE;
    }

    const available =
      paneHeight -
      RESPONSE_HEAD_SIZE -
      RESPONSE_TABS_SIZE -
      BOTTOM_RESIZER_SIZE -
      RESPONSE_PANEL_RESERVED_SIZE;

    return Math.min(BOTTOM_PANEL_MAX_SIZE, Math.max(BOTTOM_PANEL_COLLAPSED_SIZE, available));
  }, []);

  const setSafeBottomPanelSize = useCallback(
    (size: number) => {
      const nextSize = clampNumber(size, BOTTOM_PANEL_COLLAPSED_SIZE, getBottomPanelMaxSize());

      bottomPanelSizeRef.current = nextSize;
      setBottomPanelSize(nextSize);
    },
    [getBottomPanelMaxSize]
  );

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

  useEffect(() => {
    if (!isResizingBottomPanel) return;

    const handlePointerMove = (event: PointerEvent) => {
      if (!isDraggingBottomPanelRef.current) return;

      event.preventDefault();

      const deltaY = dragStartYRef.current - event.clientY;
      const nextSize = dragStartSizeRef.current + deltaY;

      setSafeBottomPanelSize(nextSize);
    };

    const handlePointerEnd = () => {
      stopBottomResize();
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        stopBottomResize();
      }
    };

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

  const saveState = useCallback((nextState?: Partial<PersistedState>) => {
    if (!loadedStateRef.current) return;

    const state: PersistedState = {
      globals: globalsRef.current,
      request: requestRef.current,
      history: historyRef.current,
      ...nextState,
    };

    vscode?.postMessage({
      type: 'saveApiDevToolsState',
      state,
    });
  }, []);

  const setLog = useCallback((message: string) => {
    setLogs((prev) => [`${new Date().toLocaleTimeString()} ${message}`, ...prev].slice(0, 20));
  }, []);

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
    [setLog]
  );

  const runPostScript = useCallback(
    (script: string, payload: ApiResponsePayload) => {
      const code = String(script || '').trim();

      if (!code) return;

      try {
        const fn = new Function('response', 'globals', 'console', code);

        fn(payload, { ...globalVariablesRef.current }, {
          log: (...args: unknown[]) => setLog(args.map(String).join(' ')),
        });
      } catch (error: any) {
        setLog(`后置操作失败：${error?.message || String(error)}`);
      }
    },
    [setLog]
  );

  useEffect(() => {
    vscode?.postMessage({ type: 'apiDevToolsReady' });

    const handleMessage = (event: MessageEvent) => {
      const message = event.data;

      if (message?.type === 'apiDevToolsState') {
        const state = normalizePersistedState(message.state);

        loadedStateRef.current = true;

        setGlobals(state.globals.length ? state.globals : createDefaultGlobals());
        setRequest(state.request);
        setHistory(state.history || []);
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
      }
    };

    window.addEventListener('message', handleMessage);

    return () => {
      window.removeEventListener('message', handleMessage);
    };
  }, [runPostScript, saveState]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      saveState();
    }, 300);

    return () => window.clearTimeout(timer);
  }, [globals, request, saveState]);

  const patchRequest = (patch: Partial<ApiRequestConfig>) => {
    setRequest((prev) => ({ ...prev, ...patch }));
  };

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

      urlObject.searchParams.set(
        interpolateVariables(item.key, variables),
        interpolateVariables(item.value, variables)
      );
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

  const clearAll = () => {
    const nextRequest = createDefaultRequest();
    const nextGlobals = createDefaultGlobals();

    setRequest(nextRequest);
    setGlobals(nextGlobals);
    setHistory([]);
    setResponse(null);
    setLogs([]);
    setSafeBottomPanelSize(BOTTOM_PANEL_DEFAULT_SIZE);

    vscode?.postMessage({ type: 'clearApiDevToolsState' });
  };

  const loadHistory = (item: HistoryItem) => {
    setRequest(cloneRequest(item.request));
    setRequestTab('params');
  };

  const responseBody = getDisplayResponseBody(response);
  const bottomPanelMaxSize = getBottomPanelMaxSize();

  return (
    <div className={styles['api-devtools']}>
      <header className={styles['topbar']}>
        <div className={styles['brand']}>
          <span className={styles['brand-dot']} />
          <span>Q-ops Api</span>
        </div>

        <div className={styles['top-actions']}>
          <button className={styles['ghost-btn']} onClick={() => setShowGlobals(true)}>
            全局变量
          </button>
          <button className={styles['ghost-btn']} onClick={() => patchRequest(createDefaultRequest())}>
            新建请求
          </button>
          <button className={styles['ghost-btn']} onClick={clearAll}>
            清空
          </button>
          <button className={styles['primary-btn']} disabled={loading} onClick={sendRequest}>
            {loading ? '发送中...' : '发送'}
          </button>
        </div>
      </header>

      <main className={styles['main']}>
        <section className={styles['left-pane']}>
          <div className={styles['request-line']}>
            <select
              className={styles['method-select']}
              value={request.method}
              onChange={(event) => patchRequest({ method: event.target.value as HttpMethod })}
            >
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

          <div className={styles['tabs']}>
            {REQUEST_TABS.map((tab) => (
              <button
                key={tab.key}
                className={requestTab === tab.key ? styles.active : ''}
                onClick={() => setRequestTab(tab.key)}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className={styles['request-panel']}>
            {requestTab === 'params' && (
              <KeyValueEditor
                items={request.params}
                onChange={(params) => patchRequest({ params })}
                keyPlaceholder="参数名"
                valuePlaceholder="参数值"
              />
            )}

            {requestTab === 'headers' && (
              <KeyValueEditor
                items={request.headers}
                onChange={(headers) => patchRequest({ headers })}
                keyPlaceholder="Header"
                valuePlaceholder="Value"
              />
            )}

            {requestTab === 'cookies' && (
              <KeyValueEditor
                items={request.cookies}
                onChange={(cookies) => patchRequest({ cookies })}
                keyPlaceholder="Cookie"
                valuePlaceholder="Value"
              />
            )}

            {requestTab === 'auth' && (
              <div className={styles['auth-panel']}>
                <label>
                  <span>认证类型</span>
                  <select
                    value={request.auth.type}
                    onChange={(event) =>
                      patchRequest({ auth: { ...request.auth, type: event.target.value as AuthType } })
                    }
                  >
                    <option value="none">None</option>
                    <option value="bearer">Bearer Token</option>
                    <option value="basic">Basic Auth</option>
                  </select>
                </label>

                {request.auth.type === 'bearer' && (
                  <label>
                    <span>Token</span>
                    <input
                      value={request.auth.token}
                      placeholder="{{token}}"
                      onChange={(event) => patchRequest({ auth: { ...request.auth, token: event.target.value } })}
                    />
                  </label>
                )}

                {request.auth.type === 'basic' && (
                  <>
                    <label>
                      <span>Username</span>
                      <input
                        value={request.auth.username}
                        onChange={(event) =>
                          patchRequest({ auth: { ...request.auth, username: event.target.value } })
                        }
                      />
                    </label>
                    <label>
                      <span>Password</span>
                      <input
                        type="password"
                        value={request.auth.password}
                        onChange={(event) =>
                          patchRequest({ auth: { ...request.auth, password: event.target.value } })
                        }
                      />
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
                      <input
                        type="radio"
                        checked={request.bodyType === type}
                        onChange={() => patchRequest({ bodyType: type })}
                      />
                      <span>{type}</span>
                    </label>
                  ))}
                </div>

                {request.bodyType === 'none' && <div className={styles['empty-state']}>该请求不发送 Body</div>}

                {(request.bodyType === 'json' || request.bodyType === 'raw') && (
                  <textarea
                    className={styles['code-editor']}
                    spellCheck={false}
                    value={request.bodyRaw}
                    onChange={(event) => patchRequest({ bodyRaw: event.target.value })}
                  />
                )}

                {request.bodyType === 'form-urlencoded' && (
                  <KeyValueEditor
                    items={request.bodyForm}
                    onChange={(bodyForm) => patchRequest({ bodyForm })}
                    keyPlaceholder="字段名"
                    valuePlaceholder="字段值"
                  />
                )}
              </div>
            )}

            {requestTab === 'pre' && (
              <textarea
                className={styles['code-editor']}
                spellCheck={false}
                value={request.preScript}
                onChange={(event) => patchRequest({ preScript: event.target.value })}
              />
            )}

            {requestTab === 'post' && (
              <textarea
                className={styles['code-editor']}
                spellCheck={false}
                value={request.postScript}
                onChange={(event) => patchRequest({ postScript: event.target.value })}
              />
            )}
          </div>
        </section>

        <section ref={rightPaneRef} className={styles['right-pane']}>
          <div className={styles['response-head']}>
            <strong>返回响应</strong>
            <div className={styles['response-meta']}>
              {response && (
                <>
                  <span className={response.ok ? styles['status-ok'] : styles['status-error']}>
                    {response.status || response.statusText}
                  </span>
                  <span>{response.duration} ms</span>
                  <span>{formatSize(response.size)}</span>
                </>
              )}
            </div>
          </div>

          <div className={styles['tabs']}>
            {RESPONSE_TABS.map((tab) => (
              <button
                key={tab.key}
                className={responseTab === tab.key ? styles.active : ''}
                onClick={() => setResponseTab(tab.key)}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className={styles['response-panel']}>
            {loading && <div className={styles['empty-state']}>正在请求...</div>}

            {!loading && !response && (
              <div className={styles['empty-state']}>
                <div className={styles['rocket']}>🚀</div>
                <div>点击“发送”按钮获取返回结果</div>
              </div>
            )}

            {!loading && response?.error && <pre className={styles['error-box']}>{response.error}</pre>}

            {!loading && response && !response.error && responseTab === 'body' && (
              <pre className={styles['response-code']}>{responseBody}</pre>
            )}

            {!loading && response && !response.error && responseTab === 'headers' && (
              <pre className={styles['response-code']}>{JSON.stringify(response.headers, null, 2)}</pre>
            )}

            {!loading && response && !response.error && responseTab === 'raw' && (
              <pre className={styles['response-code']}>{response.body}</pre>
            )}
          </div>

          <div
            className={[
              styles['bottom-resizer'],
              isResizingBottomPanel ? styles['bottom-resizer-active'] : '',
            ]
              .filter(Boolean)
              .join(' ')}
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

      {showGlobals && (
        <div className={styles['modal-mask']} onMouseDown={() => setShowGlobals(false)}>
          <div className={styles['modal']} onMouseDown={(event) => event.stopPropagation()}>
            <div className={styles['modal-head']}>
              <strong>全局变量</strong>
              <button className={styles['icon-btn']} onClick={() => setShowGlobals(false)}>
                ×
              </button>
            </div>

            <p className={styles['hint']}>
              请求地址、Headers、Body 中可以使用 <code>{'{{baseUrl}}'}</code>、<code>{'{{token}}'}</code>{' '}
              这类变量。
            </p>

            <KeyValueEditor
              items={globals}
              onChange={(items) => setGlobals(items.map((item) => ({ ...item })))}
              keyPlaceholder="变量名"
              valuePlaceholder="变量值"
            />

            <div className={styles['modal-footer']}>
              <button className={styles['primary-btn']} onClick={() => setShowGlobals(false)}>
                完成
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}