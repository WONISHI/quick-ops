import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { vscode } from '@utils/vscode';
import styles from '@pages/api-dev-tools-app/index.module.css';
import BaseButton from '@components/BaseButton';
import BaseCodeEditor, { type BaseCodeEditorLanguage } from '@components/BaseCodeEditor';
import BaseDialog from '@components/BaseDialog';
import BaseSearch from '@components/BaseSearch';
import BaseTabs from '@components/BaseTabs';
import Scrollbar from '@components/Scrollbar';
import BottomPanels from '@/pages/api-dev-tools-app/components/bottom-panels';
import InterfaceItem from '@/pages/api-dev-tools-app/components/interface-item';
import KeyValueEditor from '@/pages/api-dev-tools-app/components/key-value-editor';
import ProjectCard from '@/pages/api-dev-tools-app/components/project-card';
import ShareCard from '@/pages/api-dev-tools-app/components/share-card';
import ApiDevToolsSkeleton from '@/pages/api-dev-tools-app/components/api-dev-tools-skeleton';
import { buildApiDocsHtml } from '@/pages/api-dev-tools-app/src/api-docs-builder';
import { formatSize, safeBase64, clampNumber, tryFormatJson, isJsonLikeText, cloneRequest } from '@/pages/api-dev-tools-app/src/api-dev-tools.utils';
import type { KeyValueEditorItem } from '@/pages/api-dev-tools-app/components/key-value-editor/src/type';
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
  LeaveConfirmAction,
  LeaveConfirmDialog,
  ApiDevToolsViewTitleAction,
  ApiInterfaceGroup,
  GroupedApiInterfaceItem,
  GroupedApiProject,
  GroupedPersistedState,
  ApiManageDialog,
  ApiFormDataPayloadItem,
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
  RIGHT_PANE_DEFAULT_WIDTH,
  RIGHT_PANE_MIN_WIDTH,
  RIGHT_PANE_MAX_WIDTH,
  RIGHT_RESIZER_SIZE,
} from '@/pages/api-dev-tools-app/src/constants';

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
function createProject(name = '默认项目'): GroupedApiProject {
  const now = Date.now();

  return {
    id: createId('project'),
    name,
    description: '',
    interfaces: [],
    groups: [],
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * @description 根据请求配置创建接口记录
 */
function createInterfaceFromRequest(request: ApiRequestConfig, name?: string, groupId = ''): GroupedApiInterfaceItem {
  const now = Date.now();
  const snapshot = cloneRequest<ApiRequestConfig>({
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
    groupId,
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
    valueType: item?.valueType === 'file' ? 'file' : 'text',
    fileName: String(item?.fileName || ''),
    fileMimeType: String(item?.fileMimeType || ''),
    fileData: String(item?.fileData || ''),
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
    bodyType: ['none', 'json', 'raw', 'form-urlencoded', 'form-data'].includes(item.bodyType as string) ? (item.bodyType as BodyType) : def.bodyType,
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
function normalizeInterface(raw: unknown): GroupedApiInterfaceItem | null {
  const item = raw as Partial<GroupedApiInterfaceItem> | undefined;

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
    groupId: String(item.groupId || ''),
    createdAt: Number(item.createdAt) || now,
    updatedAt: Number(item.updatedAt) || now,
  };
}

/**
 * @description 规范化接口项目
 */
function normalizeProject(raw: unknown): GroupedApiProject | null {
  const item = raw as Partial<GroupedApiProject> | undefined;

  if (!item || typeof item !== 'object') return null;

  const now = Date.now();
  const groups = Array.isArray(item.groups)
    ? item.groups
        .map((group) => ({
          id: String(group?.id || createId('api-group')),
          name: String(group?.name || '未命名分组'),
          createdAt: Number(group?.createdAt) || now,
          updatedAt: Number(group?.updatedAt) || now,
        }))
        .filter((group) => group.id)
    : [];
  const groupIdSet = new Set(groups.map((group) => group.id));
  const interfaces = Array.isArray(item.interfaces)
    ? (item.interfaces.map(normalizeInterface).filter(Boolean) as GroupedApiInterfaceItem[]).map((api) => ({
        ...api,
        groupId: api.groupId && groupIdSet.has(api.groupId) ? api.groupId : '',
      }))
    : [];

  return {
    id: item.id || createId('project'),
    name: String(item.name || '未命名项目'),
    description: String(item.description || ''),
    interfaces,
    groups,
    createdAt: Number(item.createdAt) || now,
    updatedAt: Number(item.updatedAt) || now,
  };
}

/**
 * @description 规范化持久化状态
 */
function normalizePersistedState(raw: unknown): GroupedPersistedState {
  const state = raw as Partial<PersistedState> | undefined;
  const projects = Array.isArray(state?.projects) ? (state!.projects.map(normalizeProject).filter(Boolean) as GroupedApiProject[]) : [];

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
 * @description 将 GET 地址中的查询字符串拆分到 Params
 */
function parseGetRequestUrl(value: string): { url: string; params: KeyValueItem[] } | null {
  const rawUrl = String(value || '').trim();
  const queryIndex = rawUrl.indexOf('?');

  if (queryIndex < 0) return null;

  const hashIndex = rawUrl.indexOf('#', queryIndex + 1);
  const query = rawUrl.slice(queryIndex + 1, hashIndex >= 0 ? hashIndex : undefined);

  if (!query) return null;

  const params: KeyValueItem[] = [];

  new URLSearchParams(query).forEach((paramValue, key) => {
    params.push(createKeyValue(key, paramValue, true));
  });

  if (params.length === 0) return null;

  const hash = hashIndex >= 0 ? rawUrl.slice(hashIndex) : '';

  return {
    url: `${rawUrl.slice(0, queryIndex)}${hash}`,
    params,
  };
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
 * @description 创建 multipart/form-data 请求字段
 */
function getFormDataPayload(list: KeyValueItem[], variables: Record<string, string>): ApiFormDataPayloadItem[] {
  return (list || [])
    .map((rawItem) => {
      const item = rawItem as KeyValueEditorItem;
      const key = interpolateVariables(item.key, variables).trim();

      if (!item.enabled || !key) return null;

      if (item.valueType === 'file') {
        if (!item.fileData) return null;

        return {
          key,
          type: 'file' as const,
          fileName: item.fileName || 'file',
          mimeType: item.fileMimeType || 'application/octet-stream',
          fileData: item.fileData,
        };
      }

      return {
        key,
        type: 'text' as const,
        value: interpolateVariables(item.value, variables),
      };
    })
    .filter(Boolean) as ApiFormDataPayloadItem[];
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
 * @description 获取用于比较的键值列表
 */
function getComparableKeyValueList(list: KeyValueItem[]) {
  return (list || []).map((rawItem) => {
    const item = rawItem as KeyValueEditorItem;

    return {
      enabled: item.enabled !== false,
      key: String(item.key || ''),
      value: String(item.value || ''),
      description: String(item.description || ''),
      valueType: item.valueType === 'file' ? 'file' : 'text',
      fileName: String(item.fileName || ''),
      fileMimeType: String(item.fileMimeType || ''),
      fileData: String(item.fileData || ''),
    };
  });
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

const REQUEST_DETAIL_TABS: Array<{ key: ResponseTab; label: string }> = [
  { key: 'body', label: '参数' },
  { key: 'headers', label: 'Headers' },
  { key: 'raw', label: 'cURL' },
];

type DetailSource = 'response' | 'request';

interface RequestDetailPayload {
  method: HttpMethod;
  url: string;
  headers: Record<string, string>;
  body?: string;
  timeout: number;
}

interface ApiResponseMessagePayload extends ApiResponsePayload {
  request?: RequestDetailPayload;
}

/**
 * @description 获取忽略大小写的请求头值
 */
function getRequestHeaderValue(headers: Record<string, string>, name: string) {
  const targetName = name.toLowerCase();
  const key = Object.keys(headers || {}).find((item) => item.toLowerCase() === targetName);

  return key ? headers[key] : '';
}

/**
 * @description 将同名参数追加到参数对象
 */
function appendRequestParameter(target: Record<string, string | string[]>, key: string, value: string) {
  const current = target[key];

  if (current === undefined) {
    target[key] = value;
    return;
  }

  target[key] = Array.isArray(current) ? [...current, value] : [current, value];
}

/**
 * @description 获取请求参数内容
 */
function getRequestParametersContent(request: RequestDetailPayload) {
  const result: Record<string, unknown> = {};
  const query: Record<string, string | string[]> = {};
  const url = new URL(request.url);

  url.searchParams.forEach((value, key) => {
    appendRequestParameter(query, key, value);
  });

  if (Object.keys(query).length > 0) {
    result.query = query;
  }

  const body = request.body || '';

  if (body) {
    const contentType = getRequestHeaderValue(request.headers, 'content-type').toLowerCase();

    if (contentType.includes('application/json') || isJsonLikeText(body)) {
      try {
        result.body = JSON.parse(body);
      } catch {
        result.body = body;
      }
    } else if (contentType.includes('application/x-www-form-urlencoded')) {
      const bodyParameters: Record<string, string | string[]> = {};

      new URLSearchParams(body).forEach((value, key) => {
        appendRequestParameter(bodyParameters, key, value);
      });

      result.body = bodyParameters;
    } else {
      result.body = body;
    }
  }

  return JSON.stringify(result, null, 2);
}

/**
 * @description 将内容转换成可用于 Shell 的单引号字符串
 */
function quoteCurlValue(value: string) {
  return `'${String(value).replace(/'/g, `'"'"'`)}'`;
}

/**
 * @description 获取请求对应的 cURL 命令
 */
function getCurlRequestContent(request: RequestDetailPayload) {
  const ignoredHeaders = new Set(['host', 'content-length', 'connection']);
  const lines = [`curl --request ${request.method}`, `  --url ${quoteCurlValue(request.url)}`];

  Object.entries(request.headers || {}).forEach(([key, value]) => {
    if (ignoredHeaders.has(key.toLowerCase())) return;

    lines.push(`  --header ${quoteCurlValue(`${key}: ${value}`)}`);
  });

  if (request.body) {
    lines.push(`  --data-raw ${quoteCurlValue(request.body)}`);
  }

  return lines.join(' \\\n');
}

/**
 * @description 获取响应编辑器语言
 */
function getResponseEditorLanguage(response: ApiResponsePayload | null, responseTab: ResponseTab, value: string): BaseCodeEditorLanguage {
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
 * @description 渲染 API 调试工具主页面
 */
export default function ApiDevToolsApp() {
  const [globals, setGlobals] = useState<GlobalVariable[]>(createDefaultGlobals);
  const [request, setRequest] = useState<ApiRequestConfig>(createDefaultRequest);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [projects, setProjects] = useState<GroupedApiProject[]>([]);
  const [activeProjectId, setActiveProjectId] = useState('');
  const [activeInterfaceId, setActiveInterfaceId] = useState('');
  const [requestTab, setRequestTab] = useState<RequestTab>('params');
  const [responseTab, setResponseTab] = useState<ResponseTab>('body');
  const [detailSource, setDetailSource] = useState<DetailSource>('response');
  const [isResponseSearchOpen, setIsResponseSearchOpen] = useState(false);
  const [requestDetail, setRequestDetail] = useState<RequestDetailPayload | null>(null);
  const [response, setResponse] = useState<ApiResponsePayload | null>(null);
  const [loading, setLoading] = useState(false);

  /**
   * @description 是否正在加载 Extension Host 中持久化的初始状态
   */
  const [initializing, setInitializing] = useState(true);

  const [showGlobals, setShowGlobals] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [bottomPanelSize, setBottomPanelSize] = useState(BOTTOM_PANEL_DEFAULT_SIZE);
  const [isResizingBottomPanel, setIsResizingBottomPanel] = useState(false);
  const [workspacePaneWidth, setWorkspacePaneWidth] = useState(WORKSPACE_PANE_DEFAULT_WIDTH);
  const [isResizingWorkspacePane, setIsResizingWorkspacePane] = useState(false);
  const [rightPaneWidth, setRightPaneWidth] = useState(RIGHT_PANE_DEFAULT_WIDTH);
  const [isResizingRightPane, setIsResizingRightPane] = useState(false);
  const [sharedDocUrl, setSharedDocUrl] = useState('');
  const [isShareSelecting, setIsShareSelecting] = useState(false);
  const [shareSelectedInterfaceIds, setShareSelectedInterfaceIds] = useState<string[]>([]);
  const [manageDialog, setManageDialog] = useState<ApiManageDialog>(null);
  const [manageDialogValue, setManageDialogValue] = useState('');
  const [expandedGroupIds, setExpandedGroupIds] = useState<Set<string>>(new Set());
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
  const rightPaneWidthRef = useRef(RIGHT_PANE_DEFAULT_WIDTH);
  const isDraggingRightPaneRef = useRef(false);
  const rightResizerRef = useRef<HTMLDivElement | null>(null);
  const rightResizerPointerIdRef = useRef<number | null>(null);
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

  const stopRightResize = useCallback(() => {
    isDraggingRightPaneRef.current = false;

    const element = rightResizerRef.current;
    const pointerId = rightResizerPointerIdRef.current;

    if (element && pointerId !== null) {
      try {
        element.releasePointerCapture(pointerId);
      } catch {
        // ignore
      }
    }

    rightResizerRef.current = null;
    rightResizerPointerIdRef.current = null;

    document.body.style.cursor = bodyCursorRef.current;
    document.body.style.userSelect = bodyUserSelectRef.current;

    setIsResizingRightPane(false);
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

  const handleRightResizerPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();

    dragStartXRef.current = event.clientX;
    dragStartWidthRef.current = rightPaneWidthRef.current;
    isDraggingRightPaneRef.current = true;

    rightResizerRef.current = event.currentTarget;
    rightResizerPointerIdRef.current = event.pointerId;

    bodyCursorRef.current = document.body.style.cursor;
    bodyUserSelectRef.current = document.body.style.userSelect;

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // VS Code Webview pointer capture may fail
    }

    setIsResizingRightPane(true);
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
   * @description 监听右侧面板拖拽事件
   */
  useEffect(() => {
    if (!isResizingRightPane) return;

    const handlePointerMove = (event: PointerEvent) => {
      if (!isDraggingRightPaneRef.current) return;

      event.preventDefault();

      const deltaX = dragStartXRef.current - event.clientX;
      const nextWidth = clampNumber(dragStartWidthRef.current + deltaX, RIGHT_PANE_MIN_WIDTH, RIGHT_PANE_MAX_WIDTH);

      rightPaneWidthRef.current = nextWidth;
      setRightPaneWidth(nextWidth);
    };

    const handlePointerEnd = () => {
      stopRightResize();
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        stopRightResize();
      }
    };

    const handleMouseLeaveWebview = () => {
      stopRightResize();
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
  }, [isResizingRightPane, stopRightResize]);

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
        const mutableRequest = cloneRequest<ApiRequestConfig>(draft);
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
        setInitializing(false);
        return;
      }

      if (message?.type === 'apiResponse') {
        const payload = message.payload as ApiResponseMessagePayload;

        if (payload.requestId !== pendingRequestIdRef.current) return;

        const currentRequest = requestRef.current;

        setLoading(false);
        setResponse(payload);
        setResponseTab('body');

        if (payload.request) {
          setRequestDetail(payload.request);
        }

        const nextHistoryItem: HistoryItem = {
          id: createId('history'),
          name: currentRequest.name || currentRequest.url || '未命名请求',
          method: currentRequest.method,
          url: payload.url || currentRequest.url,
          status: payload.status,
          duration: payload.duration,
          timestamp: Date.now(),
          request: cloneRequest<ApiRequestConfig>(currentRequest),
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
   * @description 把 GET 地址中的查询字符串同步到 Params
   */
  const syncGetUrlParams = (urlValue: string) => {
    if (requestRef.current.method !== 'GET') return false;

    const parsed = parseGetRequestUrl(urlValue);

    if (!parsed) return false;

    const nextRequest = {
      ...requestRef.current,
      url: parsed.url,
      params: parsed.params,
    };

    requestRef.current = nextRequest;
    setRequest(nextRequest);
    setRequestTab('params');

    return true;
  };

  /**
   * @description 构建待发送的请求参数
   */
  const buildRequestPayload = () => {
    const currentRequest = requestRef.current;
    const finalRequest = runPreScript(currentRequest.preScript, currentRequest);
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
    let formData: ApiFormDataPayloadItem[] | undefined;

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

      if (String(finalRequest.bodyType) === 'form-data') {
        formData = getFormDataPayload(finalRequest.bodyForm, variables);

        Object.keys(headers).forEach((key) => {
          if (key.toLowerCase() === 'content-type') {
            delete headers[key];
          }
        });
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
        formData,
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
      setRequestDetail({
        method: payload.method,
        url: payload.url,
        headers: payload.headers,
        body:
          payload.body ||
          payload.formData
            ?.map((item) => {
              return item.type === 'file' ? `${item.key}: [File] ${item.fileName || 'file'}` : `${item.key}: ${item.value || ''}`;
            })
            .join('\n'),
        timeout: payload.timeout,
      });
      setDetailSource('response');
      setIsResponseSearchOpen(false);
      setResponseTab('body');
      setLoading(true);
      setResponse(null);
      setLog(`发送请求：${payload.method} ${payload.url}`);

      vscode?.postMessage({
        type: 'sendApiRequest',
        payload,
      });
    } catch (error: any) {
      setRequestDetail(null);
      setDetailSource('response');
      setIsResponseSearchOpen(false);
      setResponseTab('body');
      setLoading(false);
      setResponse({
        requestId: createId('error'),
        ok: false,
        url: requestRef.current.url,
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
    setExpandedGroupIds(new Set());
    setActiveProjectId('');
    setActiveInterfaceId('');
    setRequestDetail(null);
    setDetailSource('response');
    setIsResponseSearchOpen(false);
    setResponse(null);
    setResponseTab('body');
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

    const nextRequest = cloneRequest<ApiRequestConfig>(item.request);

    requestRef.current = nextRequest;
    activeInterfaceIdRef.current = '';

    setRequest(nextRequest);
    setActiveInterfaceId('');
    setRequestTab('params');
    setRequestDetail(null);
    setDetailSource('response');
    setIsResponseSearchOpen(false);
    setResponse(null);
    setResponseTab('body');
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
    setRequestDetail(null);
    setDetailSource('response');
    setIsResponseSearchOpen(false);
    setResponse(null);
    setResponseTab('body');
  };

  /**
   * @description 将当前请求保存到项目
   */
  const saveCurrentRequestToProject = (options?: { silent?: boolean }) => {
    const now = Date.now();
    const snapshot = cloneRequest<ApiRequestConfig>(requestRef.current);
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

    let savedRequest = cloneRequest<ApiRequestConfig>(snapshot);
    let savedInterfaceName = requestName;
    let savedType: '新增' | '更新' = '新增';

    nextProjects = nextProjects.map((project) => {
      if (project.id !== targetProjectId) return project;

      const hasInterface = !!targetInterfaceId && project.interfaces.some((api) => api.id === targetInterfaceId);

      if (!hasInterface) {
        const api = createInterfaceFromRequest(snapshot, requestName);

        targetInterfaceId = api.id;
        savedRequest = cloneRequest<ApiRequestConfig>(api.request);
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
          savedRequest = cloneRequest<ApiRequestConfig>(snapshot);

          return {
            ...api,
            name: requestName,
            method: snapshot.method,
            url: snapshot.url,
            request: cloneRequest<ApiRequestConfig>(snapshot),
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

    const restoredRequest = currentInterface ? cloneRequest<ApiRequestConfig>(currentInterface.request) : createDefaultRequest();

    requestRef.current = restoredRequest;

    setRequest(restoredRequest);
    setRequestDetail(null);
    setDetailSource('response');
    setIsResponseSearchOpen(false);
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
      const nextRequest = cloneRequest<ApiRequestConfig>(firstInterface.request);

      activeProjectIdRef.current = project.id;
      activeInterfaceIdRef.current = firstInterface.id;
      requestRef.current = nextRequest;

      setActiveProjectId(project.id);
      setActiveInterfaceId(firstInterface.id);
      setRequest(nextRequest);
      setRequestTab('params');
      setRequestDetail(null);
      setDetailSource('response');
      setIsResponseSearchOpen(false);
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
   * @description 打开新增接口分组弹窗
   */
  const addProjectGroup = (project: GroupedApiProject) => {
    const value = `分组 ${(project.groups?.length || 0) + 1}`;

    setManageDialog({
      kind: 'group-create',
      title: '添加接口分组',
      label: '分组名称',
      value,
      projectId: project.id,
    });
    setManageDialogValue(value);
  };

  /**
   * @description 打开接口分组重命名弹窗
   */
  const renameProjectGroup = (project: GroupedApiProject, group: ApiInterfaceGroup) => {
    setManageDialog({
      kind: 'group-rename',
      title: '重命名接口分组',
      label: '分组名称',
      value: group.name,
      projectId: project.id,
      groupId: group.id,
    });
    setManageDialogValue(group.name);
  };

  /**
   * @description 打开删除接口分组确认框
   */
  const removeProjectGroup = (project: GroupedApiProject, group: ApiInterfaceGroup) => {
    setManageDialog({
      kind: 'group-delete',
      title: '删除接口分组',
      message: `确定删除分组「${group.name}」吗？分组中的接口会移动到未分组。`,
      projectId: project.id,
      groupId: group.id,
      groupName: group.name,
    });
    setManageDialogValue('');
  };

  /**
   * @description 打开分组内新增接口弹窗
   */
  const addInterfaceToGroup = (project: GroupedApiProject, group: ApiInterfaceGroup) => {
    const value = `接口 ${project.interfaces.length + 1}`;

    setManageDialog({
      kind: 'group-interface-create',
      title: `添加接口到 ${group.name}`,
      label: '接口名称',
      value,
      projectId: project.id,
      groupId: group.id,
    });
    setManageDialogValue(value);
  };

  /**
   * @description 展开或折叠接口分组
   */
  const toggleProjectGroup = (groupId: string) => {
    setExpandedGroupIds((current) => {
      const next = new Set(current);

      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }

      return next;
    });
  };

  /**
   * @description 打开新增接口弹窗
   */
  const addInterface = () => {
    const currentProject = projectsRef.current.find((project) => project.id === activeProjectIdRef.current);
    const value = `接口 ${(currentProject?.interfaces.length || 0) + 1}`;

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

    const nextRequest = cloneRequest<ApiRequestConfig>(api.request);

    activeProjectIdRef.current = project.id;
    activeInterfaceIdRef.current = api.id;
    requestRef.current = nextRequest;

    setActiveProjectId(project.id);
    setActiveInterfaceId(api.id);
    setRequest(nextRequest);
    setRequestTab('params');
    setRequestDetail(null);
    setDetailSource('response');
    setIsResponseSearchOpen(false);
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

    if (manageDialog.kind === 'group-create') {
      if (!value) return;

      const now = Date.now();
      const group: ApiInterfaceGroup = {
        id: createId('api-group'),
        name: value,
        createdAt: now,
        updatedAt: now,
      };
      const nextProjects = projectsRef.current.map((project) =>
        project.id === manageDialog.projectId
          ? {
              ...project,
              groups: [...(project.groups || []), group],
              updatedAt: now,
            }
          : project,
      );

      projectsRef.current = nextProjects;
      setProjects(nextProjects);
      saveState({
        projects: nextProjects,
      });
      setLog(`已添加接口分组：${value}`);
      closeManageDialog();
      return;
    }

    if (manageDialog.kind === 'group-rename') {
      if (!value || value === manageDialog.value) {
        closeManageDialog();
        return;
      }

      const now = Date.now();
      const nextProjects = projectsRef.current.map((project) =>
        project.id === manageDialog.projectId
          ? {
              ...project,
              groups: (project.groups || []).map((group) =>
                group.id === manageDialog.groupId
                  ? {
                      ...group,
                      name: value,
                      updatedAt: now,
                    }
                  : group,
              ),
              updatedAt: now,
            }
          : project,
      );

      projectsRef.current = nextProjects;
      setProjects(nextProjects);
      saveState({
        projects: nextProjects,
      });
      setLog(`已重命名接口分组：${value}`);
      closeManageDialog();
      return;
    }

    if (manageDialog.kind === 'group-delete') {
      const now = Date.now();
      const nextProjects = projectsRef.current.map((project) =>
        project.id === manageDialog.projectId
          ? {
              ...project,
              groups: (project.groups || []).filter((group) => group.id !== manageDialog.groupId),
              interfaces: project.interfaces.map((api) =>
                api.groupId === manageDialog.groupId
                  ? {
                      ...api,
                      groupId: '',
                    }
                  : api,
              ),
              updatedAt: now,
            }
          : project,
      );

      projectsRef.current = nextProjects;
      setProjects(nextProjects);
      setExpandedGroupIds((current) => {
        const next = new Set(current);
        next.delete(manageDialog.groupId);
        return next;
      });
      saveState({
        projects: nextProjects,
      });
      setLog(`已删除接口分组：${manageDialog.groupName}`);
      closeManageDialog();
      return;
    }

    if (manageDialog.kind === 'group-interface-create') {
      if (!value) return;
      if (!(await confirmSaveBeforeLeave())) return;

      const now = Date.now();
      const snapshot: ApiRequestConfig = {
        ...createDefaultRequest(),
        name: value,
      };
      const api = createInterfaceFromRequest(snapshot, value, manageDialog.groupId);
      const nextRequest = cloneRequest<ApiRequestConfig>(api.request);
      const nextProjects = projectsRef.current.map((project) =>
        project.id === manageDialog.projectId
          ? {
              ...project,
              interfaces: [api, ...project.interfaces],
              updatedAt: now,
            }
          : project,
      );

      projectsRef.current = nextProjects;
      activeProjectIdRef.current = manageDialog.projectId;
      activeInterfaceIdRef.current = api.id;
      requestRef.current = nextRequest;

      setProjects(nextProjects);
      setRequest(nextRequest);
      setActiveProjectId(manageDialog.projectId);
      setActiveInterfaceId(api.id);
      setRequestTab('params');
      setRequestDetail(null);
      setDetailSource('response');
      setIsResponseSearchOpen(false);
      setResponse(null);
      setResponseTab('body');
      setExpandedGroupIds((current) => {
        const next = new Set(current);
        next.delete(manageDialog.groupId);
        return next;
      });

      saveState({
        projects: nextProjects,
        activeProjectId: manageDialog.projectId,
        activeInterfaceId: api.id,
        request: nextRequest,
      });

      setLog(`已添加接口：${value}`);
      closeManageDialog();
      return;
    }

    if (manageDialog.kind === 'interface-create') {
      if (!value) return;
      if (!(await confirmSaveBeforeLeave())) return;

      const now = Date.now();
      const snapshot: ApiRequestConfig = {
        ...createDefaultRequest(),
        name: value,
      };
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
      const nextRequest = cloneRequest<ApiRequestConfig>(api.request);

      nextProjects = nextProjects.map((project) =>
        project.id === projectId
          ? {
              ...project,
              interfaces: [api, ...project.interfaces],
              updatedAt: now,
            }
          : project,
      );

      projectsRef.current = nextProjects;
      activeProjectIdRef.current = projectId;
      activeInterfaceIdRef.current = api.id;
      requestRef.current = nextRequest;

      setProjects(nextProjects);
      setRequest(nextRequest);
      setActiveProjectId(projectId);
      setActiveInterfaceId(api.id);
      setRequestTab('params');
      setRequestDetail(null);
      setDetailSource('response');
      setIsResponseSearchOpen(false);
      setResponse(null);
      setResponseTab('body');

      saveState({
        projects: nextProjects,
        activeProjectId: projectId,
        activeInterfaceId: api.id,
        request: nextRequest,
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
          setRequestDetail(null);
          setDetailSource('response');
          setIsResponseSearchOpen(false);
          setResponse(null);
          setResponseTab('body');
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
                request: cloneRequest<ApiRequestConfig>(api.request),
              };
            }

            const liveRequest = cloneRequest<ApiRequestConfig>(requestRef.current);
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
  const isRequestDetail = detailSource === 'request';
  const hasCurrentDetail = isRequestDetail ? Boolean(requestDetail) : Boolean(response);

  /**
   * @description 计算当前请求或响应页签的编辑器内容
   */
  const responseEditorValue = useMemo(() => {
    if (detailSource === 'request') {
      if (!requestDetail) return '';

      if (responseTab === 'headers') {
        return JSON.stringify(requestDetail.headers, null, 2);
      }

      if (responseTab === 'raw') {
        return getCurlRequestContent(requestDetail);
      }

      return getRequestParametersContent(requestDetail);
    }

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
  }, [detailSource, requestDetail, response, responseBody, responseTab]);

  /**
   * @description 计算当前请求或响应页签的编辑器语言
   */
  const responseEditorLanguage = useMemo(() => {
    if (detailSource === 'request') {
      if (responseTab === 'headers') {
        return 'json';
      }

      if (responseTab === 'body') {
        return 'json';
      }

      return 'plaintext';
    }

    return getResponseEditorLanguage(response, responseTab, responseEditorValue);
  }, [detailSource, response, responseEditorValue, responseTab]);

  /**
   * @description 打开当前请求或响应内容搜索框
   */
  const openResponseSearch = () => {
    if (!responseEditorValue) return;

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

  if (initializing) {
    return <ApiDevToolsSkeleton workspacePaneWidth={workspacePaneWidth} workspaceResizerSize={WORKSPACE_RESIZER_SIZE} bottomPanelSize={bottomPanelSize} />;
  }

  return (
    <div className={styles['api-devtools']}>
      <main
        className={styles['main']}
        style={
          {
            '--api-workspace-width': `${workspacePaneWidth}px`,
            '--api-workspace-resizer-size': `${WORKSPACE_RESIZER_SIZE}px`,
            '--api-right-pane-width': `${rightPaneWidth}px`,
            '--api-right-resizer-size': `${RIGHT_RESIZER_SIZE}px`,
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

          {sharedDocUrl && <ShareCard url={sharedDocUrl} onOpen={openSharedUrl} onCopy={copySharedUrl} onClose={stopShareDocs} />}

          <Scrollbar className={styles['project-list']} viewClassName={styles['project-list-view']} direction="both">
            {projects.length === 0 ? (
              <div className={styles['empty-project']}>
                <div>暂无项目</div>
                <BaseButton type="default" size="medium" icon={<i className="codicon codicon-add" />} onClick={addProject}>
                  添加项目
                </BaseButton>
              </div>
            ) : (
              projects.map((project) => {
                const groups = project.groups || [];
                const groupIdSet = new Set(groups.map((group) => group.id));
                const ungroupedInterfaces = project.interfaces.filter((api) => !api.groupId || !groupIdSet.has(api.groupId));

                const renderInterfaceItem = (api: GroupedApiInterfaceItem) => (
                  <InterfaceItem
                    key={api.id}
                    api={api}
                    active={activeProjectId === project.id && activeInterfaceId === api.id}
                    shareMode={isShareSelecting}
                    checked={shareSelectedInterfaceIds.includes(api.id)}
                    onToggleShare={() => {
                      toggleShareInterface(api.id);
                    }}
                    onSelect={() => {
                      loadInterface(project, api);
                    }}
                    onRemove={() => {
                      removeInterface(project, api);
                    }}
                  />
                );

                return (
                  <ProjectCard
                    key={project.id}
                    project={project}
                    active={activeProjectId === project.id}
                    onSelect={() => {
                      switchProject(project);
                    }}
                    onRename={() => {
                      renameProject(project);
                    }}
                    onAddGroup={() => {
                      addProjectGroup(project);
                    }}
                    onRemove={() => {
                      removeProject(project);
                    }}
                  >
                    {groups.map((group) => {
                      const groupInterfaces = project.interfaces.filter((api) => api.groupId === group.id);
                      const collapsed = !expandedGroupIds.has(group.id);

                      return (
                        <section className={styles['interface-group']} key={group.id}>
                          <div className={styles['interface-group-head']}>
                            <button
                              type="button"
                              className={styles['interface-group-toggle']}
                              title={group.name}
                              onClick={(event) => {
                                event.stopPropagation();
                                toggleProjectGroup(group.id);
                              }}
                            >
                              <i className={`codicon codicon-chevron-${collapsed ? 'right' : 'down'}`} />
                              <i className="codicon codicon-folder" />
                              <span>{group.name}</span>
                              <small>{groupInterfaces.length}</small>
                            </button>

                            <div className={styles['interface-group-actions']}>
                              <BaseButton
                                type="icon"
                                size="small"
                                title={`在 ${group.name} 中添加接口`}
                                icon={<i className="codicon codicon-group-by-ref-type" />}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  addInterfaceToGroup(project, group);
                                }}
                              />

                              <BaseButton
                                type="icon"
                                size="small"
                                title={`重命名分组：${group.name}`}
                                icon={<i className="codicon codicon-edit" />}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  renameProjectGroup(project, group);
                                }}
                              />

                              <BaseButton
                                type="icon"
                                size="small"
                                title={`删除分组：${group.name}`}
                                icon={<i className="codicon codicon-trash" />}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  removeProjectGroup(project, group);
                                }}
                              />
                            </div>
                          </div>

                          {!collapsed && (
                            <div className={styles['interface-group-content']}>
                              {groupInterfaces.length > 0 ? groupInterfaces.map(renderInterfaceItem) : <div className={styles['mini-empty']}>暂无接口</div>}
                            </div>
                          )}
                        </section>
                      );
                    })}

                    {groups.length > 0 && ungroupedInterfaces.length > 0 && <div className={styles['ungrouped-title']}>未分组</div>}

                    {ungroupedInterfaces.map(renderInterfaceItem)}

                    {project.interfaces.length === 0 && groups.length === 0 && <div className={styles['mini-empty']}>暂无接口</div>}
                  </ProjectCard>
                );
              })
            )}
          </Scrollbar>

          {isShareSelecting && (
            <div className={styles['share-select-actions']}>
              <div className={styles['share-select-count']}>已选择 {shareSelectedInterfaceIds.length} 个接口</div>
              <BaseButton type="default" size="medium" onClick={cancelShareSelect}>
                取消
              </BaseButton>

              <BaseButton type="primary" size="medium" onClick={confirmShareDocs}>
                确认分享
              </BaseButton>
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
            <select
              className={styles['method-select']}
              value={request.method}
              onChange={(event) => {
                const method = event.target.value as HttpMethod;
                const parsed = method === 'GET' ? parseGetRequestUrl(requestRef.current.url) : null;

                patchRequest(
                  parsed
                    ? {
                        method,
                        url: parsed.url,
                        params: parsed.params,
                      }
                    : {
                        method,
                      },
                );

                if (parsed) {
                  setRequestTab('params');
                }
              }}
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
              onPaste={(event) => {
                if (requestRef.current.method !== 'GET') return;

                const value = event.clipboardData.getData('text');

                if (!parseGetRequestUrl(value)) return;

                event.preventDefault();
                syncGetUrlParams(value);
              }}
              onBlur={(event) => {
                syncGetUrlParams(event.currentTarget.value);
              }}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                  const parsed = syncGetUrlParams(event.currentTarget.value);

                  if (parsed) {
                    window.setTimeout(sendRequest, 0);
                  } else {
                    sendRequest();
                  }
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

          <BaseTabs
            items={REQUEST_TABS}
            value={requestTab}
            ariaLabel="请求配置"
            onChange={(nextTab) => {
              setRequestTab(nextTab);
            }}
          />

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
                  {(['none', 'json', 'raw', 'form-urlencoded', 'form-data'] as BodyType[]).map((type) => (
                    <label key={type}>
                      <input type="radio" checked={request.bodyType === type} onChange={() => patchRequest({ bodyType: type })} />
                      <span>{type}</span>
                    </label>
                  ))}
                </div>

                {request.bodyType === 'none' && <div className={styles['empty-state']}>该请求不发送 Body</div>}

                {(request.bodyType === 'json' || request.bodyType === 'raw') && (
                  <div className={styles['request-body-code-editor']}>
                    <BaseCodeEditor
                      value={request.bodyRaw}
                      language={request.bodyType === 'json' ? 'json' : 'plaintext'}
                      editable
                      onChange={(bodyRaw) => {
                        patchRequest({
                          bodyRaw,
                        });
                      }}
                    />
                  </div>
                )}

                {request.bodyType === 'form-urlencoded' && (
                  <KeyValueEditor items={request.bodyForm} onChange={(bodyForm) => patchRequest({ bodyForm })} keyPlaceholder="字段名" valuePlaceholder="字段值" />
                )}

                {String(request.bodyType) === 'form-data' && (
                  <KeyValueEditor items={request.bodyForm} onChange={(bodyForm) => patchRequest({ bodyForm })} keyPlaceholder="字段名" valuePlaceholder="字段值 / 文件" showType />
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

        <div
          className={[styles['right-resizer'], isResizingRightPane ? styles['right-resizer-active'] : ''].filter(Boolean).join(' ')}
          title="拖拽调整响应面板宽度"
          onPointerDown={handleRightResizerPointerDown}
        />

        {/* 请求 / 响应详情 */}
        <section ref={rightPaneRef} className={styles['right-pane']}>
          <div className={styles['response-head']}>
            <select
              className={styles['response-source-select']}
              value={detailSource}
              aria-label="选择请求或响应详情"
              onChange={(event) => {
                setDetailSource(event.target.value as DetailSource);
                setResponseTab('body');
                setIsResponseSearchOpen(false);
              }}
            >
              <option value="response">请求响应</option>
              <option value="request">请求详情</option>
            </select>

            <div className={styles['response-head-actions']}>
              <div className={styles['response-meta']}>
                {detailSource === 'response' && response && (
                  <>
                    <span className={response.ok ? styles['status-ok'] : styles['status-error']}>{response.status || response.statusText}</span>
                    <span>{response.duration} ms</span>
                    <span>{formatSize(response.size)}</span>
                  </>
                )}

                {detailSource === 'request' && requestDetail && (
                  <>
                    <span className={styles['request-method-meta']}>{requestDetail.method}</span>
                    <span className={styles['request-url-meta']} title={requestDetail.url}>
                      {requestDetail.url}
                    </span>
                    <span>超时 {requestDetail.timeout} ms</span>
                  </>
                )}
              </div>

              <BaseButton
                type="icon"
                size="medium"
                title={detailSource === 'request' ? '搜索请求内容' : '搜索响应内容'}
                disabled={!responseEditorValue}
                icon={<i className="codicon codicon-search" />}
                onClick={openResponseSearch}
              />
            </div>
          </div>

          <BaseTabs
            items={detailSource === 'request' ? REQUEST_DETAIL_TABS : RESPONSE_TABS}
            value={responseTab}
            ariaLabel={detailSource === 'request' ? '请求内容' : '响应内容'}
            onChange={(nextTab) => {
              setResponseTab(nextTab);
            }}
          />

          {/* 悬浮搜索 */}
          <BaseSearch
            open={isResponseSearchOpen}
            text={responseEditorValue}
            className={styles['response-panel']}
            placeholder={detailSource === 'request' ? '搜索请求...' : '搜索响应...'}
            searchPosition="bottom"
            onClose={() => {
              setIsResponseSearchOpen(false);
            }}
          >
            {({ query, activeIndex }) => (
              <>
                {detailSource === 'response' && loading && <div className={styles['empty-state']}>正在请求...</div>}

                {detailSource === 'response' && !loading && !response && (
                  <div className={styles['empty-state']}>
                    <div className={styles.rocket}>🚀</div>

                    <div>点击“发送”按钮获取返回结果</div>
                  </div>
                )}

                {detailSource === 'request' && !requestDetail && (
                  <div className={styles['empty-state']}>
                    <div className={styles.rocket}>🚀</div>

                    <div>发送请求后可查看请求参数、Headers 和 cURL</div>
                  </div>
                )}

                {hasCurrentDetail && !(detailSource === 'response' && loading) && (
                  <BaseCodeEditor
                    value={responseEditorValue}
                    language={responseEditorLanguage}
                    search={{
                      open: isResponseSearchOpen,
                      query,
                      activeIndex,
                    }}
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

          <BottomPanels size={bottomPanelSize} maxSize={bottomPanelMaxSize} history={history} logs={logs} onLoadHistory={loadHistory} />
        </section>
      </main>

      {/* 清空提醒 */}
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

      {/* 离开提醒 */}
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
            <BaseButton
              type="default"
              size="medium"
              onClick={() => {
                closeLeaveConfirmDialog('cancel');
              }}
            >
              取消切换
            </BaseButton>

            <BaseButton
              type="default"
              size="medium"
              onClick={() => {
                closeLeaveConfirmDialog('discard');
              }}
            >
              不保存并切换
            </BaseButton>

            <BaseButton
              type="primary"
              size="medium"
              onClick={() => {
                closeLeaveConfirmDialog('save');
              }}
            >
              保存并切换
            </BaseButton>
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

      {/* 全局变量 */}
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
