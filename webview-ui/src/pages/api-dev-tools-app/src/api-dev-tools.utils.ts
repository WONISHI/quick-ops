import type { KeyValueItem, GlobalVariable, ApiRequestConfig, HttpMethod, BodyType, AuthType, ApiResponsePayload, ResponseTab } from '@/pages/api-dev-tools-app/src/type';
import type { GroupedApiProject, GroupedApiInterfaceItem, GroupedPersistedState, ApiFormDataPayloadItem } from '@/pages/api-dev-tools-app/src/type';
import { HTTP_METHODS } from '@/pages/api-dev-tools-app/src/constants';
import type { PersistedState, RequestDetailPayload } from '@/pages/api-dev-tools-app/src/type';
import type { BaseCodeEditorLanguage } from '@components/BaseCodeEditor';
import type { KeyValueEditorItem } from '@/pages/api-dev-tools-app/components/key-value-editor/src/type';

/**
 * @description 格式化字节大小
 */
export function formatSize(size: number): string {
  if (!size) return '0 B';

  if (size < 1024) {
    return `${size} B`;
  }

  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }

  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * @description 将文本安全转换为 Base64
 */
export function safeBase64(value: string): string {
  try {
    return btoa(unescape(encodeURIComponent(value)));
  } catch {
    return btoa(value);
  }
}

/**
 * @description 将数值限制在指定的最小值和最大值之间
 */
export function clampNumber(value: number, min: number, max: number) {
  const safeMax = Math.max(min, max);
  return Math.min(Math.max(value, min), safeMax);
}

/**
 * @description 尝试格式化 JSON 文本
 */
export function tryFormatJson(text: string) {
  const value = String(text || '').trim();

  if (!value) return '';

  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return text;
  }
}

/**
 * @description 判断文本是否可能为 JSON
 */
export function isJsonLikeText(value: string): boolean {
  const firstCharacter = String(value || '')
    .trim()
    .charAt(0);

  return firstCharacter === '{' || firstCharacter === '[';
}

/**
 * @description 深拷贝接口请求配置
 */
export function cloneRequest<T>(request: T): T {
  return JSON.parse(JSON.stringify(request));
}
export function createId(prefix = 'id') {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/**
 * @description 创建键值配置项
 */
export function createKeyValue(key = '', value = '', enabled = true): KeyValueItem {
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
export function createDefaultRequest(): ApiRequestConfig {
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
export function createDefaultGlobals(): GlobalVariable[] {
  return [createKeyValue('baseUrl', 'http://localhost:3000', true), createKeyValue('token', '', true)];
}

/**
 * @description 创建接口项目
 */
export function createProject(name = '默认项目'): GroupedApiProject {
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
export function createInterfaceFromRequest(request: ApiRequestConfig, name?: string, groupId = ''): GroupedApiInterfaceItem {
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
export function normalizeKeyValueList(list: unknown): KeyValueItem[] {
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
export function normalizeRequest(raw: unknown): ApiRequestConfig {
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
export function normalizeInterface(raw: unknown): GroupedApiInterfaceItem | null {
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
export function normalizeProject(raw: unknown): GroupedApiProject | null {
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
export function normalizePersistedState(raw: unknown): GroupedPersistedState {
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
export function interpolateVariables(value: string, variables: Record<string, string>) {
  return String(value || '').replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_, key) => {
    return Object.prototype.hasOwnProperty.call(variables, key) ? variables[key] : '';
  });
}

/**
 * @description 将 GET 地址中的查询字符串拆分到 Params
 */
export function parseGetRequestUrl(value: string): { url: string; params: KeyValueItem[] } | null {
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
export function getEnabledObject(list: KeyValueItem[], variables: Record<string, string>) {
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
export function getFormDataPayload(list: KeyValueItem[], variables: Record<string, string>): ApiFormDataPayloadItem[] {
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
export function getResponseContentType(response: ApiResponsePayload | null) {
  if (!response) return '';

  const key = Object.keys(response.headers || {}).find((item) => item.toLowerCase() === 'content-type');

  return key ? response.headers[key] : '';
}

/**
 * @description 获取用于展示的响应内容
 */
export function getDisplayResponseBody(response: ApiResponsePayload | null) {
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
export function getComparableKeyValueList(list: KeyValueItem[]) {
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
export function getComparableRequest(request: ApiRequestConfig) {
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
export function isSameRequest(left: ApiRequestConfig, right: ApiRequestConfig) {
  return JSON.stringify(getComparableRequest(left)) === JSON.stringify(getComparableRequest(right));
}

/**
 * @description 判断请求是否为默认配置
 */
export function isDefaultRequestSnapshot(request: ApiRequestConfig) {
  return isSameRequest(request, createDefaultRequest());
}

export function getRequestHeaderValue(headers: Record<string, string>, name: string) {
  const targetName = name.toLowerCase();
  const key = Object.keys(headers || {}).find((item) => item.toLowerCase() === targetName);

  return key ? headers[key] : '';
}

/**
 * @description 将同名参数追加到参数对象
 */
export function appendRequestParameter(target: Record<string, string | string[]>, key: string, value: string) {
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
export function getRequestParametersContent(request: RequestDetailPayload) {
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
export function quoteCurlValue(value: string) {
  return `'${String(value).replace(/'/g, `'"'"'`)}'`;
}

/**
 * @description 获取请求对应的 cURL 命令
 */
export function getCurlRequestContent(request: RequestDetailPayload) {
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
export function getResponseEditorLanguage(response: ApiResponsePayload | null, responseTab: ResponseTab, value: string): BaseCodeEditorLanguage {
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
