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

interface ApiInterfaceItem {
  id: string;
  name: string;
  description: string;
  method: HttpMethod;
  url: string;
  request: ApiRequestConfig;
  createdAt: number;
  updatedAt: number;
}

interface ApiProject {
  id: string;
  name: string;
  description: string;
  interfaces: ApiInterfaceItem[];
  createdAt: number;
  updatedAt: number;
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
  projects: ApiProject[];
  activeProjectId: string;
  activeInterfaceId: string;
}

type ManageDialog =
  | { kind: 'project-create'; title: string; label: string; value: string }
  | { kind: 'project-rename'; title: string; label: string; value: string; projectId: string }
  | { kind: 'interface-create'; title: string; label: string; value: string }
  | { kind: 'project-delete'; title: string; message: string; projectId: string; projectName: string }
  | { kind: 'interface-delete'; title: string; message: string; projectId: string; interfaceId: string; interfaceName: string }
  | { kind: 'clear-all'; title: string; message: string }
  | null;

type LeaveConfirmAction = 'save' | 'discard' | 'cancel';

type LeaveConfirmDialog = {
  title: string;
  message: string;
} | null;

const HTTP_METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

const REQUEST_TABS: Array<{ key: RequestTab; label: string }> = [
  { key: 'params', label: 'Params' },
  { key: 'body', label: 'Body' },
  { key: 'headers', label: 'Headers' },
  { key: 'cookies', label: 'Cookies' },
  { key: 'auth', label: 'Auth' },
  { key: 'pre', label: '前置' },
  { key: 'post', label: '后置' },
];

const RESPONSE_TABS: Array<{ key: ResponseTab; label: string }> = [
  { key: 'body', label: 'Body' },
  { key: 'headers', label: 'Headers' },
  { key: 'raw', label: 'Raw' },
];

const BOTTOM_PANEL_COLLAPSED_SIZE = 0;
const BOTTOM_PANEL_DEFAULT_SIZE = 0;
const BOTTOM_PANEL_MAX_SIZE = 420;
const RESPONSE_PANEL_RESERVED_SIZE = 110;
const RESPONSE_HEAD_SIZE = 34;
const RESPONSE_TABS_SIZE = 32;
const BOTTOM_RESIZER_SIZE = 6;
const WORKSPACE_PANE_DEFAULT_WIDTH = 218;
const WORKSPACE_PANE_MIN_WIDTH = 0;
const WORKSPACE_PANE_MAX_WIDTH = 380;
const WORKSPACE_RESIZER_SIZE = 6;

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

function normalizeProject(raw: unknown): ApiProject | null {
  const item = raw as Partial<ApiProject> | undefined;

  if (!item || typeof item !== 'object') return null;

  const now = Date.now();
  const interfaces = Array.isArray(item.interfaces)
    ? (item.interfaces.map(normalizeInterface).filter(Boolean) as ApiInterfaceItem[])
    : [];

  return {
    id: item.id || createId('project'),
    name: String(item.name || '未命名项目'),
    description: String(item.description || ''),
    interfaces,
    createdAt: Number(item.createdAt) || now,
    updatedAt: Number(item.updatedAt) || now,
  };
}

function normalizePersistedState(raw: unknown): PersistedState {
  const state = raw as Partial<PersistedState> | undefined;
  const projects = Array.isArray(state?.projects)
    ? (state!.projects.map(normalizeProject).filter(Boolean) as ApiProject[])
    : [];

  return {
    globals: normalizeKeyValueList(state?.globals).map((item) => ({ ...item })),
    request: normalizeRequest(state?.request),
    history: Array.isArray(state?.history) ? state!.history.slice(0, 50) : [],
    projects,
    activeProjectId: String(state?.activeProjectId || projects[0]?.id || ''),
    activeInterfaceId: String(state?.activeInterfaceId || ''),
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

function getComparableKeyValueList(list: KeyValueItem[]) {
  return (list || []).map((item) => ({
    enabled: item.enabled !== false,
    key: String(item.key || ''),
    value: String(item.value || ''),
    description: String(item.description || ''),
  }));
}

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

function isSameRequest(left: ApiRequestConfig, right: ApiRequestConfig) {
  return JSON.stringify(getComparableRequest(left)) === JSON.stringify(getComparableRequest(right));
}

function isDefaultRequestSnapshot(request: ApiRequestConfig) {
  return isSameRequest(request, createDefaultRequest());
}

function formatTime(timestamp: number) {
  if (!timestamp) return '-';

  try {
    return new Date(timestamp).toLocaleString();
  } catch {
    return '-';
  }
}

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getEnabledItems(list: KeyValueItem[]) {
  return list.filter((item) => item.enabled && item.key.trim());
}

function renderKeyValueTable(title: string, list: KeyValueItem[]) {
  const enabled = getEnabledItems(list);

  if (enabled.length === 0) return '';

  return `
    <h4>${escapeHtml(title)}</h4>
    <table>
      <thead><tr><th>名称</th><th>值</th></tr></thead>
      <tbody>
        ${enabled
          .map((item) => `<tr><td>${escapeHtml(item.key)}</td><td><code>${escapeHtml(item.value)}</code></td></tr>`)
          .join('')}
      </tbody>
    </table>`;
}

function renderBodyBlock(request: ApiRequestConfig) {
  if (request.bodyType === 'none' || ['GET', 'HEAD'].includes(request.method)) {
    return '<p class="muted">无请求 Body</p>';
  }

  if (request.bodyType === 'form-urlencoded') {
    return renderKeyValueTable('Body - form-urlencoded', request.bodyForm);
  }

  return `<pre>${escapeHtml(request.bodyType === 'json' ? tryFormatJson(request.bodyRaw) : request.bodyRaw)}</pre>`;
}

function escapeScriptJson(value: unknown) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function getDocsProjects(
  projects: ApiProject[],
  currentRequest: ApiRequestConfig,
  activeProjectId = '',
  activeInterfaceId = ''
) {
  const validProjects = projects
    .filter((project) => project.interfaces.length > 0)
    .map((project) => ({
      ...project,
      interfaces: project.interfaces.map((api) => ({
        ...api,
        request: cloneRequest(api.request),
      })),
    }));

  if (validProjects.length === 0) {
    return [
      {
        ...createProject(currentRequest.name || '当前请求'),
        interfaces: [createInterfaceFromRequest(currentRequest, currentRequest.name || '当前请求')],
      },
    ];
  }

  if (activeProjectId && activeInterfaceId) {
    validProjects.forEach((project) => {
      if (project.id !== activeProjectId) return;

      project.interfaces = project.interfaces.map((api) => {
        if (api.id !== activeInterfaceId) return api;

        const liveRequest = cloneRequest(currentRequest);
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
    });
  }

  return validProjects;
}

function collectDocVariableNamesFromText(value: unknown, result: Set<string>) {
  const text = String(value ?? '');
  const variableRegExp = /\{\{\s*([\w.-]+)\s*\}\}/g;

  let match = variableRegExp.exec(text);

  while (match) {
    const key = String(match[1] || '').trim();

    if (key) {
      result.add(key);
    }

    match = variableRegExp.exec(text);
  }
}

function collectDocVariableNamesFromList(list: KeyValueItem[], result: Set<string>) {
  (list || []).forEach((item) => {
    collectDocVariableNamesFromText(item.key, result);
    collectDocVariableNamesFromText(item.value, result);
  });
}

function isAbsoluteHttpUrl(value: string) {
  return /^https?:\/\//i.test(String(value || '').trim());
}

/**
 * @description 获取分享文档真正用到的全局变量
 *
 * 说明：
 * - 没有被 {{变量名}} 引用的变量不展示。
 * - 相对路径请求会隐式依赖 baseUrl，所以这种情况下保留 baseUrl。
 */
function getUsedDocGlobals(projects: ApiProject[], globals: GlobalVariable[]) {
  const usedNames = new Set<string>();

  projects.forEach((project) => {
    project.interfaces.forEach((api) => {
      const request = api.request;

      collectDocVariableNamesFromText(request.url, usedNames);
      collectDocVariableNamesFromList(request.params, usedNames);
      collectDocVariableNamesFromList(request.headers, usedNames);
      collectDocVariableNamesFromList(request.cookies, usedNames);
      collectDocVariableNamesFromText(request.bodyRaw, usedNames);
      collectDocVariableNamesFromList(request.bodyForm, usedNames);
      collectDocVariableNamesFromText(request.auth?.token, usedNames);
      collectDocVariableNamesFromText(request.auth?.username, usedNames);
      collectDocVariableNamesFromText(request.auth?.password, usedNames);

      if (!isAbsoluteHttpUrl(request.url)) {
        usedNames.add('baseUrl');
      }
    });
  });

  return globals.filter((item) => {
    const key = String(item.key || '').trim();

    return item.enabled && key && usedNames.has(key);
  });
}

function getDocVariableMap(globals: GlobalVariable[]) {
  const variables: Record<string, string> = {};

  globals.forEach((item) => {
    const key = String(item.key || '').trim();

    if (!item.enabled || !key) return;

    variables[key] = String(item.value || '');
  });

  return variables;
}

function resolveKeyValueListForDocs(list: KeyValueItem[], variables: Record<string, string>) {
  return list.map((item) => ({
    ...item,
    key: interpolateVariables(item.key, variables),
    value: interpolateVariables(item.value, variables),
  }));
}

function resolveRequestForDocs(request: ApiRequestConfig, variables: Record<string, string>): ApiRequestConfig {
  const next = cloneRequest(request);

  next.url = interpolateVariables(next.url, variables);
  next.params = resolveKeyValueListForDocs(next.params, variables);
  next.headers = resolveKeyValueListForDocs(next.headers, variables);
  next.cookies = resolveKeyValueListForDocs(next.cookies, variables);
  next.bodyForm = resolveKeyValueListForDocs(next.bodyForm, variables);
  next.bodyRaw = interpolateVariables(next.bodyRaw, variables);
  next.auth = {
    ...next.auth,
    token: interpolateVariables(next.auth.token, variables),
    username: interpolateVariables(next.auth.username, variables),
    password: interpolateVariables(next.auth.password, variables),
  };

  return next;
}

function buildApiDocsHtml(
  projects: ApiProject[],
  globals: GlobalVariable[],
  currentRequest: ApiRequestConfig,
  activeProjectId = '',
  activeInterfaceId = ''
) {
  const rawDocsProjects = getDocsProjects(projects, currentRequest, activeProjectId, activeInterfaceId);
  const usedGlobals = getUsedDocGlobals(rawDocsProjects, globals);
  const variables = getDocVariableMap(globals);
  const docsProjects = rawDocsProjects.map((project) => ({
    ...project,
    interfaces: project.interfaces.map((api) => {
      const request = resolveRequestForDocs(api.request, variables);

      return {
        ...api,
        method: request.method,
        url: request.url,
        request,
      };
    }),
  }));
  const resolvedGlobals = usedGlobals.map((item) => ({
    ...item,
    key: String(item.key || '').trim(),
    value: interpolateVariables(item.value, variables),
  }));
  const hasResolvedGlobals = resolvedGlobals.some((item) => item.enabled && item.key.trim());
  const generatedAt = new Date().toLocaleString();
  const totalCount = docsProjects.reduce((sum, project) => sum + project.interfaces.length, 0);
  const docsData = {
    generatedAt,
    globals: resolvedGlobals,
    projects: docsProjects.map((project) => ({
      ...project,
      interfaces: project.interfaces.map((api) => ({
        ...api,
        request: cloneRequest(api.request),
      })),
    })),
  };

  const renderDocKeyValueReadonly = (title: string, list: KeyValueItem[]) => {
    const items = list.filter((item) => item.enabled && item.key.trim());

    return `
      <div class="doc-block">
        <div class="doc-block-head">
          <h4>${escapeHtml(title)}</h4>
          <span>${items.length} 个启用</span>
        </div>
        ${
          items.length === 0
            ? '<p class="muted">未配置</p>'
            : `<div class="doc-kv-table doc-kv-table-readonly">
                <div class="doc-kv-head doc-kv-head-readonly"><span>名称</span><span>值</span></div>
                ${items
                  .map(
                    (item) => `
                      <div class="doc-kv-row doc-kv-row-readonly">
                        <code>${escapeHtml(item.key)}</code>
                        <code>${escapeHtml(item.value)}</code>
                      </div>`
                  )
                  .join('')}
              </div>`
        }
      </div>`;
  };

  const renderDocBodyReadonly = (request: ApiRequestConfig) => {
    if (request.bodyType === 'form-urlencoded') {
      return renderDocKeyValueReadonly('Body - form-urlencoded', request.bodyForm);
    }

    if (request.bodyType === 'none' || ['GET', 'HEAD'].includes(request.method)) {
      return `<div class="doc-block"><h4>Body</h4><p class="muted">该请求不发送 Body</p></div>`;
    }

    return `
      <div class="doc-block">
        <h4>Body - ${escapeHtml(request.bodyType)}</h4>
        <pre>${escapeHtml(request.bodyType === 'json' ? tryFormatJson(request.bodyRaw) : request.bodyRaw)}</pre>
      </div>`;
  };

  const renderAuthReadonly = (auth: AuthConfig) => {
    if (auth.type === 'none') {
      return '<pre>{\n  "type": "none"\n}</pre>';
    }

    if (auth.type === 'bearer') {
      return `<pre>${escapeHtml(JSON.stringify({ type: auth.type, token: auth.token }, null, 2))}</pre>`;
    }

    return `<pre>${escapeHtml(
      JSON.stringify(
        {
          type: auth.type,
          username: auth.username,
          password: auth.password,
        },
        null,
        2
      )
    )}</pre>`;
  };

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Q-ops Api 接口文档</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #1f2328; background: #f6f8fa; }
    header { position: sticky; top: 0; z-index: 5; padding: 16px 22px; color: #fff; background: linear-gradient(135deg, #0969da, #8250df); box-shadow: 0 8px 24px rgba(31,35,40,.12); }
    header h1 { margin: 0 0 6px; font-size: 22px; letter-spacing: .2px; }
    header p { margin: 0; opacity: .9; font-size: 14px; }
    main { max-width: 1220px; margin: 0 auto; padding: 0px 16px 16px 16px; }
    .layout { display: grid; grid-template-columns: 260px minmax(0, 1fr); align-items: start; }
    nav { margin-top: 16px; position: sticky; top: 86px; padding: 12px; border: 1px solid #d0d7de; border-radius: 14px; background: #fff; box-shadow: 0 1px 2px rgba(31,35,40,.04); }
    .nav-project { padding: 8px 0 10px; border-bottom: 1px solid #d8dee4; }
    .nav-project:last-child { border-bottom: none; }
    .nav-project-title { margin: 0 0 8px; font-weight: 800; font-size: 16px; color: #1f2328; }
    nav a { display: block; padding: 7px 8px; color: #57606a; text-decoration: none; border-radius: 8px; font-size: 13px; }
    nav a:hover { color: #0969da; background: #ddf4ff; }
    .doc-content { display: grid; gap: 14px; }
    article.api { padding: 16px; margin-top: 16px; border: 1px solid #d0d7de; border-radius: 14px; background: #fff; box-shadow: 0 1px 2px rgba(31,35,40,.04); }
    .api-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-bottom: 12px; }
    .api-title { display: flex; align-items: center; gap: 9px; min-width: 0; }
    .method { min-width: 58px; padding: 4px 8px; text-align: center; border-radius: 999px; color: #fff; font-weight: 800; font-size: 12px; letter-spacing: .4px; }
    .GET,.HEAD,.OPTIONS { background: #1a7f37; } .POST { background: #0969da; } .PUT,.PATCH { background: #9a6700; } .DELETE { background: #cf222e; }
    h3 { margin: 0; font-size: 17px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    h4 { margin: 0; font-size: 13px; color: #57606a; }
    .request-line { display: grid; grid-template-columns: 88px minmax(0, 1fr) 112px; gap: 8px; margin-bottom: 12px; }
    .doc-field { min-height: 34px; display: flex; align-items: center; width: 100%; padding: 6px 10px; border: 1px solid #d0d7de; border-radius: 8px; background: #f6f8fa; color: #1f2328; font-size: 14px; line-height: 1.45; overflow: auto; }
    .doc-url { color: #0969da; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; white-space: nowrap; }
    .doc-timeout { justify-content: flex-end; color: #57606a; }
    .doc-detail-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
    .doc-block { min-width: 0; margin-bottom: 10px; }
    .doc-block-full { grid-column: 1 / -1; }
    .doc-block-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 6px; }
    .doc-block-head span { color: #8c959f; font-size: 12px; }
    .doc-kv-table { display: grid; gap: 6px; }
    .doc-kv-head, .doc-kv-row { display: grid; gap: 6px; align-items: center; }
    .doc-kv-head-readonly, .doc-kv-row-readonly { grid-template-columns: minmax(0, 1fr) minmax(0, 1.35fr); }
    .doc-kv-head { color: #57606a; font-size: 12px; padding: 0 2px; }
    .doc-kv-row-readonly code { min-width: 0; padding: 8px 10px; border: 1px solid #d8dee4; border-radius: 8px; background: #f6f8fa; color: #1f2328; overflow: auto; white-space: pre-wrap; word-break: break-word; }
    .doc-meta { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; margin: 4px 0 12px; color: #57606a; font-size: 13px; }
    .send-btn { height: 34px; padding: 0 16px; border: none; border-radius: 8px; color: #fff; background: #1a7f37; font-weight: 700; cursor: pointer; }
    .send-btn:hover { background: #116329; }
    .send-btn:focus { outline: none; }
    .send-btn:focus-visible { box-shadow: 0 0 0 3px rgba(9, 105, 218, .25); }
    .send-btn:disabled { opacity: .65; cursor: not-allowed; }
    .muted { color: #57606a; }
    .doc-response { display: none; margin-top: 12px; padding-top: 12px; border-top: 1px solid #d8dee4; }
    .doc-response.is-show { display: block; }
    .doc-response-inner { padding: 10px; border: 1px solid #d8dee4; border-radius: 10px; background: #f6f8fa; }
    .response-meta { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; margin-bottom: 8px; color: #57606a; font-size: 13px; }
    .status-ok { color: #1a7f37; font-weight: 800; }
    .status-error { color: #cf222e; font-weight: 800; }
    pre { margin: 6px 0 10px; padding: 10px; overflow: auto; border: 1px solid #d8dee4; border-radius: 8px; background: #f6f8fa; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; line-height: 1.55; white-space: pre-wrap; word-break: break-word; }
    code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
    .globals { margin-bottom: 14px; padding: 12px; border: 1px solid #d0d7de; border-radius: 12px; background: #fff; }
    .globals-title { margin: 0 0 8px; font-weight: 800; }
    .global-row { display: grid; grid-template-columns: 160px minmax(0, 1fr); gap: 8px; padding: 6px 0; border-top: 1px solid #eef1f4; font-size: 13px; }
    .global-row:first-of-type { border-top: none; }
    @media (max-width: 860px) {
      header { position: static; padding: 14px 18px; }
      main { padding: 14px; }
      .layout { grid-template-columns: 1fr; }
      nav { position: static; }
      .doc-detail-grid { grid-template-columns: 1fr; }
      .request-line { grid-template-columns: 1fr; }
      h3 { white-space: normal; }
    }
  </style>
</head>
<body>
  <header>
    <h1>Q-ops Api 接口文档</h1>
    <p>生成时间：${escapeHtml(generatedAt)} · 项目 ${docsProjects.length} 个 · 接口 ${totalCount} 个</p>
  </header>
  <main>
    <div class="layout">
      <nav>
        ${docsProjects
          .map(
            (project) => `<div class="nav-project"><div class="nav-project-title">${escapeHtml(project.name)}</div>${project.interfaces
              .map((api) => `<a href="#${escapeHtml(api.id)}">${escapeHtml(api.request.method)} ${escapeHtml(api.name)}</a>`)
              .join('')}</div>`
          )
          .join('')}
      </nav>
      <div class="doc-content">
        ${hasResolvedGlobals ? `<div class="globals"><div class="globals-title">全局变量</div>${resolvedGlobals
          .filter((item) => item.enabled && item.key.trim())
          .map((item) => `<div class="global-row"><strong>${escapeHtml(item.key)}</strong><code>${escapeHtml(item.value)}</code></div>`)
          .join('')}</div>` : ''}
        ${docsProjects
          .map((project) =>
            project.interfaces
              .map((api) => {
                const req = api.request;
                return `<article class="api api-item" id="${escapeHtml(api.id)}" data-api-id="${escapeHtml(api.id)}">
                  <div class="api-head">
                    <div class="api-title"><span class="method ${escapeHtml(req.method)}">${escapeHtml(req.method)}</span><h3>${escapeHtml(api.name)}</h3></div>
                    <button class="send-btn" type="button" data-send-api>发送请求</button>
                  </div>
                  <div class="request-line">
                    <div class="doc-field">${escapeHtml(req.method)}</div>
                    <div class="doc-field doc-url">${escapeHtml(req.url)}</div>
                    <div class="doc-field doc-timeout">${escapeHtml(req.timeout)} ms</div>
                  </div>
                  ${api.description ? `<p>${escapeHtml(api.description)}</p>` : ''}
                  <div class="doc-meta"><span>项目：${escapeHtml(project.name)}</span><span>Body 类型：${escapeHtml(req.bodyType)}</span><span>认证：${escapeHtml(req.auth.type)}</span><span>更新时间：${escapeHtml(formatTime(api.updatedAt))}</span></div>
                  <div class="doc-detail-grid">
                    ${renderDocKeyValueReadonly('Params', req.params)}
                    ${renderDocKeyValueReadonly('Headers', req.headers)}
                    ${renderDocKeyValueReadonly('Cookies', req.cookies)}
                    <div class="doc-block">
                      <h4>Auth</h4>
                      ${renderAuthReadonly(req.auth)}
                    </div>
                    <div class="doc-block doc-block-full">
                      ${renderDocBodyReadonly(req)}
                    </div>
                  </div>
                  <div class="doc-response" data-doc-response></div>
                </article>`;
              })
              .join('')
          )
          .join('')}
      </div>
    </div>
  </main>
  <script>
    window.__Q_OPS_API_DOCS__ = ${escapeScriptJson(docsData)};

    (function () {
      var docs = window.__Q_OPS_API_DOCS__ || { globals: [], projects: [] };
      var apiMap = {};

      docs.projects.forEach(function (project) {
        (project.interfaces || []).forEach(function (api) {
          apiMap[api.id] = api;
        });
      });

      function html(value) {
        return String(value == null ? '' : value)
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#39;');
      }

      function formatJson(text) {
        var value = String(text || '').trim();
        if (!value) return '';
        try { return JSON.stringify(JSON.parse(value), null, 2); } catch (error) { return text; }
      }

      function formatSize(size) {
        if (!size) return '0 B';
        if (size < 1024) return size + ' B';
        if (size < 1024 * 1024) return (size / 1024).toFixed(1) + ' KB';
        return (size / 1024 / 1024).toFixed(1) + ' MB';
      }

      function safeBase64(value) {
        try { return btoa(unescape(encodeURIComponent(value))); } catch (error) { return btoa(value); }
      }

      function getGlobals() {
        var result = {};
        (docs.globals || []).forEach(function (item) {
          if (!item.enabled || !String(item.key || '').trim()) return;
          result[String(item.key).trim()] = String(item.value || '');
        });
        return result;
      }

      function interpolate(value, variables) {
        return String(value || '').replace(/\\{\\{\\s*([\\w.-]+)\\s*\\}\\}/g, function (_, key) {
          return Object.prototype.hasOwnProperty.call(variables, key) ? variables[key] : '';
        });
      }

      function enabledRowsToObject(list, variables) {
        var result = {};
        (list || []).forEach(function (item) {
          var key = interpolate(item && item.key, variables).trim();
          if (!item || item.enabled === false || !key) return;
          result[key] = interpolate(item.value, variables);
        });
        return result;
      }

      function enabledRowsToSearchParams(list, variables, urlObject) {
        (list || []).forEach(function (item) {
          var key = interpolate(item && item.key, variables).trim();
          if (!item || item.enabled === false || !key) return;
          urlObject.searchParams.set(key, interpolate(item.value, variables));
        });
      }

      function buildPayload(article) {
        var apiId = article.getAttribute('data-api-id');
        var api = apiMap[apiId];
        var req = api.request;
        var variables = getGlobals();
        var method = String(req.method || 'GET').toUpperCase();
        var url = interpolate(req.url || '', variables).trim();
        var timeout = Number(req.timeout || 30000);

        if (!/^https?:\\/\\//i.test(url)) {
          url = url.replace(/^\\/+/, '');
          var baseUrl = interpolate(variables.baseUrl || '', variables).replace(/\\/+$/, '');
          url = baseUrl ? baseUrl + '/' + url : url;
        }

        var urlObject = new URL(url);
        enabledRowsToSearchParams(req.params, variables, urlObject);

        var headers = enabledRowsToObject(req.headers, variables);
        var cookies = enabledRowsToObject(req.cookies, variables);

        if (Object.keys(cookies).length > 0) {
          headers.Cookie = Object.keys(cookies).map(function (key) { return key + '=' + cookies[key]; }).join('; ');
        }

        if (req.auth && req.auth.type === 'bearer') {
          var token = interpolate(req.auth.token || '', variables).trim();
          if (token) headers.Authorization = 'Bearer ' + token;
        }

        if (req.auth && req.auth.type === 'basic') {
          headers.Authorization = 'Basic ' + safeBase64(interpolate(req.auth.username || '', variables) + ':' + interpolate(req.auth.password || '', variables));
        }

        var body;
        if (method !== 'GET' && method !== 'HEAD') {
          if (req.bodyType === 'json' || req.bodyType === 'raw') {
            body = interpolate(req.bodyRaw || '', variables);
            if (req.bodyType === 'json' && !headers['Content-Type'] && !headers['content-type']) {
              headers['Content-Type'] = 'application/json';
            }
          }

          if (req.bodyType === 'form-urlencoded') {
            var params = new URLSearchParams();
            (req.bodyForm || []).forEach(function (item) {
              var key = interpolate(item && item.key, variables).trim();
              if (!item || item.enabled === false || !key) return;
              params.set(key, interpolate(item.value, variables));
            });
            body = params.toString();
            headers['Content-Type'] = 'application/x-www-form-urlencoded';
          }
        }

        return {
          requestId: 'doc-' + Date.now() + '-' + Math.random().toString(16).slice(2),
          method: method,
          url: urlObject.toString(),
          headers: headers,
          body: body,
          timeout: timeout,
        };
      }

      async function directFetch(payload) {
        var controller = new AbortController();
        var timer = payload.timeout > 0 ? setTimeout(function () { controller.abort(); }, payload.timeout) : null;
        var start = Date.now();

        try {
          var response = await fetch(payload.url, {
            method: payload.method,
            headers: payload.headers,
            body: payload.method === 'GET' || payload.method === 'HEAD' ? undefined : payload.body,
            redirect: 'follow',
            signal: controller.signal,
          });
          var body = await response.text();
          var headers = {};
          response.headers.forEach(function (value, key) { headers[key] = value; });
          return {
            ok: response.ok,
            url: response.url || payload.url,
            status: response.status,
            statusText: response.statusText,
            duration: Date.now() - start,
            size: new Blob([body]).size,
            headers: headers,
            body: body,
          };
        } catch (error) {
          return {
            ok: false,
            url: payload.url,
            status: 0,
            statusText: error && error.name === 'AbortError' ? 'Timeout' : 'Request Failed',
            duration: Date.now() - start,
            size: 0,
            headers: {},
            body: '',
            error: error && error.name === 'AbortError' ? '请求超时：' + payload.timeout + 'ms' : (error && error.message) || String(error),
          };
        } finally {
          if (timer) clearTimeout(timer);
        }
      }

      async function sendPayload(payload) {
        if (location.protocol === 'http:' || location.protocol === 'https:') {
          var response = await fetch('/__api_send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
          var text = await response.text();

          try {
            return JSON.parse(text || '{}');
          } catch (error) {
            return {
              ok: false,
              url: payload.url,
              status: response.status || 0,
              statusText: response.statusText || 'Request Failed',
              duration: 0,
              size: text ? new Blob([text]).size : 0,
              headers: {},
              body: '',
              error: text || '分享服务返回数据格式错误',
            };
          }
        }

        return await directFetch(payload);
      }

      function renderResponse(article, result) {
        var box = article.querySelector('[data-doc-response]');
        if (!box) return;

        var body = result.error || result.body || '';
        var contentTypeKey = Object.keys(result.headers || {}).find(function (key) { return key.toLowerCase() === 'content-type'; });
        var contentType = contentTypeKey ? String(result.headers[contentTypeKey]).toLowerCase() : '';
        if (!result.error && (contentType.indexOf('application/json') >= 0 || /^[\[{]/.test(String(body).trim()))) {
          body = formatJson(body);
        }

        box.classList.add('is-show');
        box.innerHTML = '<div class="doc-response-inner">'
          + '<div class="response-meta">'
          + '<span class="' + (result.ok ? 'status-ok' : 'status-error') + '">' + html(result.status || result.statusText || 'Failed') + '</span>'
          + '<span>' + html(result.duration || 0) + ' ms</span>'
          + '<span>' + html(formatSize(result.size || 0)) + '</span>'
          + '<span>' + html(result.url || '') + '</span>'
          + '</div>'
          + '<h4>响应 Body</h4><pre>' + html(body) + '</pre>'
          + '<h4>响应 Headers</h4><pre>' + html(JSON.stringify(result.headers || {}, null, 2)) + '</pre>'
          + '</div>';
      }

      async function sendDocApiRequest(button) {
        if (!button || button.getAttribute('data-sending') === 'true') return;

        var article = button.closest('article.api-item, article.api');
        if (!article) return;

        var box = article.querySelector('[data-doc-response]');

        try {
          button.setAttribute('data-sending', 'true');
          button.disabled = true;
          button.textContent = '请求中...';

          if (box) {
            box.classList.add('is-show');
            box.innerHTML = '<p class="muted">正在发送请求...</p>';
          }

          var payload = buildPayload(article);
          var result = await sendPayload(payload);
          renderResponse(article, result);
        } catch (error) {
          renderResponse(article, {
            ok: false,
            status: 0,
            statusText: 'Request Failed',
            duration: 0,
            size: 0,
            headers: {},
            body: '',
            error: (error && error.message) || String(error),
          });
        } finally {
          button.removeAttribute('data-sending');
          button.disabled = false;
          button.textContent = '发送请求';
        }
      }

      document.addEventListener('click', function (event) {
        var target = event.target;
        var button = target && target.closest ? target.closest('[data-send-api]') : null;

        if (!button) return;

        event.preventDefault();
        sendDocApiRequest(button);
      });
    })();
  </script>
</body>
</html>`;
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
  const [projects, setProjects] = useState<ApiProject[]>([]);
  const [activeProjectId, setActiveProjectId] = useState('');
  const [activeInterfaceId, setActiveInterfaceId] = useState('');
  const [requestTab, setRequestTab] = useState<RequestTab>('params');
  const [responseTab, setResponseTab] = useState<ResponseTab>('body');
  const [isResponseSearchOpen, setIsResponseSearchOpen] = useState(false);
  const [responseSearchQuery, setResponseSearchQuery] = useState('');
  const [responseSearchIndex, setResponseSearchIndex] = useState(0);
  const [responseSearchBarOffset, setResponseSearchBarOffset] = useState({ x: 0, y: 0 });
  const [isDraggingResponseSearchBar, setIsDraggingResponseSearchBar] = useState(false);
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
  const responsePanelRef = useRef<HTMLDivElement | null>(null);
  const responseCodeRef = useRef<HTMLPreElement | null>(null);
  const responseSearchInputRef = useRef<HTMLInputElement | null>(null);
  const responseSearchBarRef = useRef<HTMLDivElement | null>(null);
  const responseSearchBarOffsetRef = useRef(responseSearchBarOffset);
  const responseSearchDragStartRef = useRef({
    x: 0,
    y: 0,
    offsetX: 0,
    offsetY: 0,
    panelLeft: 0,
    panelTop: 0,
    panelRight: 0,
    panelBottom: 0,
    barLeft: 0,
    barTop: 0,
    barWidth: 0,
    barHeight: 0,
  });
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

  const globalVariables = useMemo(() => {
    const result: Record<string, string> = {};

    globals.forEach((item) => {
      if (!item.enabled || !item.key.trim()) return;
      result[item.key.trim()] = item.value;
    });

    return result;
  }, [globals]);

  const activeProject = useMemo(
    () => projects.find((project) => project.id === activeProjectId) || null,
    [projects, activeProjectId]
  );

  const activeInterface = useMemo(() => {
    if (!activeProject) return null;
    return activeProject.interfaces.find((item) => item.id === activeInterfaceId) || null;
  }, [activeProject, activeInterfaceId]);

  const requestBindText = useMemo(() => {
    if (activeProject && activeInterface) {
      return `绑定项目：${activeProject.name}`;
    }

    if (activeProject) {
      return `将保存到：${activeProject.name}`;
    }

    return '未绑定项目';
  }, [activeProject, activeInterface]);

  useEffect(() => {
    globalsRef.current = globals;
  }, [globals]);

  useEffect(() => {
    responseSearchBarOffsetRef.current = responseSearchBarOffset;
  }, [responseSearchBarOffset]);

  useEffect(() => {
    requestRef.current = request;
  }, [request]);

  useEffect(() => {
    historyRef.current = history;
  }, [history]);

  useEffect(() => {
    projectsRef.current = projects;
  }, [projects]);

  useEffect(() => {
    activeProjectIdRef.current = activeProjectId;
  }, [activeProjectId]);

  useEffect(() => {
    activeInterfaceIdRef.current = activeInterfaceId;
  }, [activeInterfaceId]);

  useEffect(() => {
    shareSelectedInterfaceIdsRef.current = shareSelectedInterfaceIds;
  }, [shareSelectedInterfaceIds]);

  useEffect(() => {
    globalVariablesRef.current = globalVariables;
  }, [globalVariables]);

  useEffect(() => {
    bottomPanelSizeRef.current = bottomPanelSize;
  }, [bottomPanelSize]);

  useEffect(() => {
    workspacePaneWidthRef.current = workspacePaneWidth;
  }, [workspacePaneWidth]);

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

  const setSafeWorkspacePaneWidth = useCallback((width: number) => {
    const nextWidth = clampNumber(width, WORKSPACE_PANE_MIN_WIDTH, WORKSPACE_PANE_MAX_WIDTH);

    workspacePaneWidthRef.current = nextWidth;
    setWorkspacePaneWidth(nextWidth);
  }, []);

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

  useEffect(() => {
    if (!isResizingWorkspacePane) return;

    const handlePointerMove = (event: PointerEvent) => {
      if (!isDraggingWorkspacePaneRef.current) return;

      event.preventDefault();

      const deltaX = event.clientX - dragStartXRef.current;
      const nextWidth = dragStartWidthRef.current + deltaX;

      setSafeWorkspacePaneWidth(nextWidth);
    };

    const handlePointerEnd = () => {
      stopWorkspaceResize();
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        stopWorkspaceResize();
      }
    };

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
  }, [runPostScript, saveState]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      saveState();
    }, 300);

    return () => window.clearTimeout(timer);
  }, [globals, request, history, projects, activeProjectId, activeInterfaceId, saveState]);

  const patchRequest = (patch: Partial<ApiRequestConfig>) => {
    setRequest((prev) => {
      const next = { ...prev, ...patch };

      requestRef.current = next;

      return next;
    });
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

  const clearAll = () => {
    setManageDialog({
      kind: 'clear-all',
      title: '清空全部数据',
      message: '确定要清空所有项目、接口、历史记录、变量和当前响应吗？此操作不可撤销。',
    });
  };

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

  const closeManageDialog = () => {
    setManageDialog(null);
    setManageDialogValue('');
  };

  const getProjectById = (projectId: string) => {
    return projectsRef.current.find((project) => project.id === projectId) || null;
  };

  const getInterfaceById = (projectId: string, interfaceId: string) => {
    const project = getProjectById(projectId);
    return project?.interfaces.find((item) => item.id === interfaceId) || null;
  };

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
    const currentInterface =
      currentProjectId && currentInterfaceId
        ? getInterfaceById(currentProjectId, currentInterfaceId)
        : null;

    const restoredRequest = currentInterface
      ? cloneRequest(currentInterface.request)
      : createDefaultRequest();

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

  const switchProject = async (project: ApiProject) => {
    const firstInterface = project.interfaces[0] || null;
    const targetInterfaceId = firstInterface?.id || '';
    const isSameProjectAndTargetInterface =
      activeProjectIdRef.current === project.id &&
      activeInterfaceIdRef.current === targetInterfaceId;

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

  const saveInterface = () => {
    saveCurrentRequestToProject();
  };

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

      setProjects((prev) =>
        prev.map((item) => (item.id === manageDialog.projectId ? { ...item, name: value, updatedAt: Date.now() } : item))
      );
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

      nextProjects = nextProjects.map((project) =>
        project.id === projectId
          ? { ...project, interfaces: [api, ...project.interfaces], updatedAt: now }
          : project
      );

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
          : item
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

  const getAllInterfaceIds = () =>
    projectsRef.current.flatMap((project) => project.interfaces.map((api) => api.id));

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

  const createDocsHtml = (docsProjects = projectsRef.current) =>
    buildApiDocsHtml(
      docsProjects,
      globalsRef.current,
      requestRef.current,
      activeProjectIdRef.current,
      activeInterfaceIdRef.current
    );

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

  const cancelShareSelect = () => {
    setIsShareSelecting(false);
  };

  const toggleShareInterface = (interfaceId: string) => {
    setShareSelectedInterfaceIds((current) =>
      current.includes(interfaceId)
        ? current.filter((id) => id !== interfaceId)
        : [...current, interfaceId]
    );
  };

  const exportDocs = () => {
    vscode?.postMessage({ type: 'exportApiDocsHtml', payload: { html: createDocsHtml(), fileName: 'q-ops-api-docs.html' } });
  };

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

  const stopShareDocs = () => {
    vscode?.postMessage({ type: 'stopApiDocsShare' });
  };

  const copySharedUrl = () => {
    if (!sharedDocUrl) return;
    navigator.clipboard?.writeText(sharedDocUrl);
    setLog('已复制分享地址');
  };

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
  const responseSearchText = useMemo(() => {
    if (!response) return '';

    if (response.error) return response.error;

    if (responseTab === 'headers') {
      return JSON.stringify(response.headers, null, 2);
    }

    if (responseTab === 'raw') {
      return response.body || '';
    }

    return responseBody;
  }, [response, responseBody, responseTab]);

  const responseSearchMatches = useMemo(() => {
    const query = responseSearchQuery.trim().toLowerCase();

    if (!query || !responseSearchText) return [];

    const text = responseSearchText.toLowerCase();
    const result: number[] = [];
    let startIndex = 0;

    while (startIndex <= text.length) {
      const index = text.indexOf(query, startIndex);

      if (index === -1) break;

      result.push(index);
      startIndex = index + Math.max(query.length, 1);
    }

    return result;
  }, [responseSearchQuery, responseSearchText]);

  const responseSearchTotal = responseSearchMatches.length;
  const activeResponseSearchIndex = responseSearchTotal
    ? Math.min(responseSearchIndex, responseSearchTotal - 1)
    : 0;

  useEffect(() => {
    setResponseSearchIndex(0);
  }, [responseSearchQuery, responseSearchText]);

  useEffect(() => {
    if (!isResponseSearchOpen) return;

    window.setTimeout(() => {
      responseSearchInputRef.current?.focus();
      responseSearchInputRef.current?.select();
    }, 0);
  }, [isResponseSearchOpen]);

  useEffect(() => {
    if (!isResponseSearchOpen || responseSearchTotal === 0) return;

    window.setTimeout(() => {
      const activeElement = responseCodeRef.current?.querySelector(
        '[data-response-search-active="true"]'
      ) as HTMLElement | null;

      activeElement?.scrollIntoView({
        block: 'center',
        inline: 'nearest',
      });
    }, 0);
  }, [activeResponseSearchIndex, isResponseSearchOpen, responseSearchTotal]);

  const openResponseSearch = () => {
    if (!response) return;

    setIsResponseSearchOpen(true);
  };

  const closeResponseSearch = () => {
    setIsResponseSearchOpen(false);
    setResponseSearchQuery('');
    setResponseSearchIndex(0);
  };

  const jumpResponseSearchMatch = (direction: 'prev' | 'next') => {
    if (responseSearchTotal === 0) return;

    setResponseSearchIndex((current) => {
      if (direction === 'prev') {
        return current <= 0 ? responseSearchTotal - 1 : current - 1;
      }

      return current >= responseSearchTotal - 1 ? 0 : current + 1;
    });
  };

  const handleResponseSearchBarPointerDown = (event: React.PointerEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();

    const panelElement = responsePanelRef.current;
    const barElement = responseSearchBarRef.current;

    if (!panelElement || !barElement) return;

    const panelRect = panelElement.getBoundingClientRect();
    const barRect = barElement.getBoundingClientRect();

    responseSearchDragStartRef.current = {
      x: event.clientX,
      y: event.clientY,
      offsetX: responseSearchBarOffsetRef.current.x,
      offsetY: responseSearchBarOffsetRef.current.y,
      panelLeft: panelRect.left,
      panelTop: panelRect.top,
      panelRight: panelRect.right,
      panelBottom: panelRect.bottom,
      barLeft: barRect.left,
      barTop: barRect.top,
      barWidth: barRect.width,
      barHeight: barRect.height,
    };

    setIsDraggingResponseSearchBar(true);
  };

  useEffect(() => {
    if (!isDraggingResponseSearchBar) return;

    const handlePointerMove = (event: PointerEvent) => {
      event.preventDefault();

      const start = responseSearchDragStartRef.current;
      const nextLeft = start.barLeft + event.clientX - start.x;
      const nextTop = start.barTop + event.clientY - start.y;
      const maxLeft = start.panelRight - start.barWidth;
      const maxTop = start.panelBottom - start.barHeight;
      const safeLeft = clampNumber(nextLeft, start.panelLeft, maxLeft);
      const safeTop = clampNumber(nextTop, start.panelTop, maxTop);

      setResponseSearchBarOffset({
        x: start.offsetX + safeLeft - start.barLeft,
        y: start.offsetY + safeTop - start.barTop,
      });
    };

    const handlePointerUp = () => {
      setIsDraggingResponseSearchBar(false);
    };

    window.addEventListener('pointermove', handlePointerMove, { passive: false });
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };
  }, [isDraggingResponseSearchBar]);

  const renderResponseCode = (text: string) => {
    const query = responseSearchQuery.trim();

    if (!isResponseSearchOpen || !query || responseSearchTotal === 0) {
      return text;
    }

    const nodes: React.ReactNode[] = [];
    const queryLength = query.length;
    let lastIndex = 0;

    responseSearchMatches.forEach((matchIndex, index) => {
      if (matchIndex > lastIndex) {
        nodes.push(text.slice(lastIndex, matchIndex));
      }

      const isActive = index === activeResponseSearchIndex;

      nodes.push(
        <mark
          key={`${matchIndex}-${index}`}
          className={[
            styles['response-search-mark'],
            isActive ? styles['response-search-mark-active'] : '',
          ]
            .filter(Boolean)
            .join(' ')}
          data-response-search-active={isActive ? 'true' : undefined}
        >
          {text.slice(matchIndex, matchIndex + queryLength)}
        </mark>
      );

      lastIndex = matchIndex + queryLength;
    });

    if (lastIndex < text.length) {
      nodes.push(text.slice(lastIndex));
    }

    return nodes;
  };

  const bottomPanelMaxSize = getBottomPanelMaxSize();
  const interfaceCount = projects.reduce((sum, project) => sum + project.interfaces.length, 0);

  return (
    <div className={styles['api-devtools']}>
      <header className={styles['topbar']}>
        <div className={styles['brand']}>
          <span className={styles['brand-dot']} />
          <span>Q-ops Api</span>
        </div>

        <div className={styles['top-actions']}>
          <button className={styles['ghost-btn']} onClick={addProject}>
            + 项目
          </button>
          <button className={styles['ghost-btn']} onClick={addInterface}>
            + 接口
          </button>
          <button className={styles['ghost-btn']} onClick={saveInterface}>
            保存接口
          </button>
          <button className={styles['ghost-btn']} onClick={shareDocs}>
            {isShareSelecting ? '选择中...' : '分享文档'}
          </button>
          <button className={styles['ghost-btn']} onClick={exportDocs}>
            导出 HTML
          </button>
          <button className={styles['ghost-btn']} onClick={() => setShowGlobals(true)}>
            变量
          </button>
          <button className={styles['ghost-btn']} onClick={clearAll}>
            清空
          </button>
          <button className={styles['primary-btn']} disabled={loading} onClick={sendRequest}>
            {loading ? '发送中...' : '发送'}
          </button>
        </div>
      </header>

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
            <span>{projects.length}/{interfaceCount}</span>
          </div>

          {sharedDocUrl && (
            <div className={styles['share-card']}>
              <div className={styles['share-title']}>文档分享中</div>

              <div className={styles['share-url-row']}>
                <button
                  className={styles['share-url']}
                  title="点击后确认是否在外部浏览器打开"
                  onClick={openSharedUrl}
                >
                  {sharedDocUrl}
                </button>
                <button
                  className={styles['share-copy-btn']}
                  title="复制链接"
                  onClick={copySharedUrl}
                >
                  <i className="codicon codicon-copy" />
                </button>
              </div>

              <div className={styles['share-card-actions']}>
                <button className={styles['tiny-btn']} onClick={openSharedUrl}>预览链接</button>
                <button className={styles['tiny-btn']} onClick={stopShareDocs}>关闭分享</button>
              </div>
            </div>
          )}

          <div className={styles['project-list']}>
            {projects.length === 0 ? (
              <div className={styles['empty-project']}>
                <div>暂无项目</div>
                <button className={styles['ghost-btn']} onClick={addProject}>+ 添加项目</button>
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
                            <label
                              className={styles['share-checkbox']}
                              onClick={(event) => event.stopPropagation()}
                            >
                              <input
                                type="checkbox"
                                checked={shareSelectedInterfaceIds.includes(api.id)}
                                onChange={() => toggleShareInterface(api.id)}
                              />
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
              <div className={styles['share-select-count']}>
                已选择 {shareSelectedInterfaceIds.length} 个接口
              </div>
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
          className={[
            styles['workspace-resizer'],
            isResizingWorkspacePane ? styles['workspace-resizer-active'] : '',
          ]
            .filter(Boolean)
            .join(' ')}
          title="拖拽调整项目接口宽度"
          onPointerDown={handleWorkspaceResizerPointerDown}
        />

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

          <div className={styles['request-name-line']}>
            <input
              className={styles['request-name-input']}
              value={request.name}
              placeholder="接口名称"
              onChange={(event) => patchRequest({ name: event.target.value })}
            />
            <span title={requestBindText}>{requestBindText}</span>
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
            <div className={styles['response-head-actions']}>
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

              <button
                className={styles['icon-btn']}
                title="搜索响应内容"
                disabled={!response}
                onClick={openResponseSearch}
              >
                <i className="codicon codicon-search" />
              </button>
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

          <div ref={responsePanelRef} className={styles['response-panel']}>
            {isResponseSearchOpen && (
              <div
                ref={responseSearchBarRef}
                className={[
                  styles['response-search-bar'],
                  isDraggingResponseSearchBar ? styles['response-search-bar-dragging'] : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                style={{
                  transform: `translate(${responseSearchBarOffset.x}px, ${responseSearchBarOffset.y}px)`,
                }}
              >
                <i
                  className={`codicon codicon-gripper ${styles['response-search-grip']}`}
                  title="拖拽搜索框"
                  onPointerDown={handleResponseSearchBarPointerDown}
                />

                <input
                  ref={responseSearchInputRef}
                  value={responseSearchQuery}
                  placeholder="搜索响应..."
                  onChange={(event) => setResponseSearchQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      jumpResponseSearchMatch(event.shiftKey ? 'prev' : 'next');
                    }

                    if (event.key === 'Escape') {
                      event.preventDefault();
                      closeResponseSearch();
                    }
                  }}
                />

                <span className={styles['response-search-count']}>
                  {responseSearchQuery.trim()
                    ? `${responseSearchTotal === 0 ? 0 : activeResponseSearchIndex + 1}/${responseSearchTotal}`
                    : '0/0'}
                </span>

                <button
                  className={styles['response-search-btn']}
                  title="上一个"
                  disabled={responseSearchTotal === 0}
                  onClick={() => jumpResponseSearchMatch('prev')}
                >
                  <i className="codicon codicon-arrow-up" />
                </button>

                <button
                  className={styles['response-search-btn']}
                  title="下一个"
                  disabled={responseSearchTotal === 0}
                  onClick={() => jumpResponseSearchMatch('next')}
                >
                  <i className="codicon codicon-arrow-down" />
                </button>

                <button
                  className={styles['response-search-btn']}
                  title="关闭搜索"
                  onClick={closeResponseSearch}
                >
                  <i className="codicon codicon-close" />
                </button>
              </div>
            )}

            {loading && <div className={styles['empty-state']}>正在请求...</div>}

            {!loading && !response && (
              <div className={styles['empty-state']}>
                <div className={styles['rocket']}>🚀</div>
                <div>点击“发送”按钮获取返回结果</div>
              </div>
            )}

            {!loading && response?.error && (
              <pre ref={responseCodeRef} className={styles['error-box']}>
                {renderResponseCode(response.error)}
              </pre>
            )}

            {!loading && response && !response.error && responseTab === 'body' && (
              <pre ref={responseCodeRef} className={styles['response-code']}>
                {renderResponseCode(responseBody)}
              </pre>
            )}

            {!loading && response && !response.error && responseTab === 'headers' && (
              <pre ref={responseCodeRef} className={styles['response-code']}>
                {renderResponseCode(JSON.stringify(response.headers, null, 2))}
              </pre>
            )}

            {!loading && response && !response.error && responseTab === 'raw' && (
              <pre ref={responseCodeRef} className={styles['response-code']}>
                {renderResponseCode(response.body)}
              </pre>
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

      {manageDialog && (
        <div className={styles['modal-mask']} onMouseDown={closeManageDialog}>
          <div
            className={[styles['modal'], styles['manage-modal']].filter(Boolean).join(' ')}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className={styles['modal-head']}>
              <strong>{manageDialog.title}</strong>
              <button className={styles['icon-btn']} onClick={closeManageDialog}>
                ×
              </button>
            </div>

            {'message' in manageDialog ? (
              <div className={styles['dialog-message']}>{manageDialog.message}</div>
            ) : (
              <label className={styles['dialog-field']}>
                <span>{manageDialog.label}</span>
                <input
                  autoFocus
                  className={styles['dialog-input']}
                  value={manageDialogValue}
                  onChange={(event) => setManageDialogValue(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      void confirmManageDialog();
                    }
                    if (event.key === 'Escape') {
                      closeManageDialog();
                    }
                  }}
                />
              </label>
            )}

            <div className={styles['modal-footer']}>
              <button className={styles['ghost-btn']} onClick={closeManageDialog}>
                取消
              </button>
              <button
                className={'message' in manageDialog ? styles['danger-btn'] : styles['primary-btn']}
                onClick={confirmManageDialog}
              >
                {'message' in manageDialog ? (manageDialog.kind === 'clear-all' ? '清空' : '删除') : '确定'}
              </button>
            </div>
          </div>
        </div>
      )}

      {leaveConfirmDialog && (
        <div className={styles['modal-mask']} onMouseDown={() => closeLeaveConfirmDialog('cancel')}>
          <div
            className={[styles['modal'], styles['manage-modal']].filter(Boolean).join(' ')}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className={styles['modal-head']}>
              <strong>{leaveConfirmDialog.title}</strong>
              <button className={styles['icon-btn']} onClick={() => closeLeaveConfirmDialog('cancel')}>
                ×
              </button>
            </div>

            <div className={styles['dialog-message']}>
              {leaveConfirmDialog.message}
              <br />
              <span className={styles['hint']}>保存后继续切换，或不保存并恢复到修改前内容。</span>
            </div>

            <div className={styles['modal-footer']}>
              <button className={styles['ghost-btn']} onClick={() => closeLeaveConfirmDialog('cancel')}>
                取消切换
              </button>
              <button className={styles['ghost-btn']} onClick={() => closeLeaveConfirmDialog('discard')}>
                不保存并切换
              </button>
              <button className={styles['primary-btn']} onClick={() => closeLeaveConfirmDialog('save')}>
                保存并切换
              </button>
            </div>
          </div>
        </div>
      )}

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