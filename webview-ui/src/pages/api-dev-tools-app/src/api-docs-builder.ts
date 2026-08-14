import type { AuthConfig, ApiRequestConfig, GlobalVariable, GroupedApiInterfaceItem, GroupedApiProject, KeyValueItem } from './type';

/**
 * @description 读取分享图标的 SVG 源码，用于生成独立 HTML 的浏览器标签页图标
 */
import gitShareIcon from '@/assets/icon/git-share.svg?raw';

export interface BuildApiDocsHtmlOptions {
  /**
   * @description 接口项目列表
   */
  projects: GroupedApiProject[];

  /**
   * @description 全局变量列表
   */
  globals: GlobalVariable[];

  /**
   * @description 当前正在编辑的请求
   */
  currentRequest: ApiRequestConfig;

  /**
   * @description 当前选中的项目标识
   */
  activeProjectId?: string;

  /**
   * @description 当前选中的接口标识
   */
  activeInterfaceId?: string;
}

/**
 * @description 创建带指定前缀的唯一标识
 */
function createId(prefix = 'id'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/**
 * @description 深拷贝接口请求配置
 */
function cloneRequest(request: ApiRequestConfig): ApiRequestConfig {
  return JSON.parse(JSON.stringify(request)) as ApiRequestConfig;
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
function createInterfaceFromRequest(request: ApiRequestConfig, name?: string): GroupedApiInterfaceItem {
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
    groupId: '',
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * @description 替换文本中的全局变量占位符
 */
function interpolateVariables(value: string, variables: Record<string, string>): string {
  return String(value || '').replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_, key: string) => {
    return Object.prototype.hasOwnProperty.call(variables, key) ? variables[key] : '';
  });
}

/**
 * @description 尝试格式化 JSON 文本
 */
function tryFormatJson(text: string): string {
  const value = String(text || '').trim();

  if (!value) return '';

  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return text;
  }
}

/**
 * @description 格式化时间戳
 */
function formatTime(timestamp: number) {
  if (!timestamp) return '-';

  try {
    return new Date(timestamp).toLocaleString();
  } catch {
    return '-';
  }
}

/**
 * @description 转义 HTML 特殊字符
 */
function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * @description 转义注入脚本中的 JSON 内容
 */
function escapeScriptJson(value: unknown) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/**
 * @description 获取用于生成接口文档的项目数据
 */
function getDocsProjects(projects: GroupedApiProject[], currentRequest: ApiRequestConfig, activeProjectId = '', activeInterfaceId = '') {
  const validProjects = projects
    .filter((project) => project.interfaces.length > 0)
    .map((project) => ({
      ...project,
      groups: (project.groups || []).map((group) => ({ ...group })),
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

/**
 * @description 构建接口文档变量映射
 */
function getDocVariableMap(globals: GlobalVariable[]) {
  const rawVariables: Record<string, string> = {};
  const variables: Record<string, string> = {};

  globals.forEach((item) => {
    const key = String(item.key || '').trim();

    if (!item.enabled || !key) return;

    rawVariables[key] = String(item.value || '');
  });

  /**
   * @description 递归解析变量值中继续引用的其他变量
   *
   * 最多解析十层，并通过访问链阻止循环引用。
   */
  const resolveVariable = (key: string, stack: string[] = []): string => {
    if (Object.prototype.hasOwnProperty.call(variables, key)) {
      return variables[key];
    }

    if (!Object.prototype.hasOwnProperty.call(rawVariables, key) || stack.includes(key) || stack.length >= 10) {
      return '';
    }

    const value = rawVariables[key].replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_, childKey: string) => {
      return resolveVariable(childKey, [...stack, key]);
    });

    variables[key] = value;

    return value;
  };

  Object.keys(rawVariables).forEach((key) => {
    resolveVariable(key);
  });

  return variables;
}

/**
 * @description 解析文档键值列表中的变量
 */
function resolveKeyValueListForDocs(list: KeyValueItem[], variables: Record<string, string>) {
  return list.map((item) => ({
    ...item,
    key: interpolateVariables(item.key, variables),
    value: interpolateVariables(item.value, variables),
    description: interpolateVariables(item.description || '', variables),
    fileName: interpolateVariables(item.fileName || '', variables),
    fileMimeType: interpolateVariables(item.fileMimeType || '', variables),
  }));
}

/**
 * @description 解析文档请求配置中的变量
 */
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
  next.preScript = interpolateVariables(next.preScript, variables);
  next.postScript = interpolateVariables(next.postScript, variables);

  if (!/^https?:\/\//i.test(next.url)) {
    const baseUrl = interpolateVariables(variables.baseUrl || '', variables).replace(/\/+$/, '');
    const relativeUrl = next.url.replace(/^\/+/, '');

    if (baseUrl) {
      next.url = `${baseUrl}/${relativeUrl}`;
    }
  }

  return next;
}

type DocsGroup = {
  id: string;
  name: string;
  interfaces: GroupedApiInterfaceItem[];
};

/**
 * @description 按“项目 > 分组 > 接口”组织分享文档数据
 *
 * 不属于有效分组的接口统一放入“未分组”，避免接口在文档中丢失。
 */
function getDocsGroups(project: GroupedApiProject): DocsGroup[] {
  const groups = (project.groups || [])
    .map((group) => ({
      id: group.id,
      name: group.name,
      interfaces: project.interfaces.filter((api) => api.groupId === group.id),
    }))
    .filter((group) => group.interfaces.length > 0);
  const validGroupIds = new Set((project.groups || []).map((group) => group.id));
  const ungroupedInterfaces = project.interfaces.filter((api) => !api.groupId || !validGroupIds.has(api.groupId));

  if (ungroupedInterfaces.length > 0) {
    groups.push({
      id: `${project.id}-ungrouped`,
      name: '未分组',
      interfaces: ungroupedInterfaces,
    });
  }

  return groups;
}

/**
 * @description 创建文档锚点标识
 */
function createAnchorId(...values: string[]): string {
  return values
    .join('-')
    .replace(/[^\w-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

/**
 * @description 获取键值项的展示值
 */
function getDocKeyValueDisplayValue(item: KeyValueItem): string {
  if (item.valueType !== 'file') {
    return item.value || '-';
  }

  return `[文件] ${item.fileName || 'file'} · ${item.fileMimeType || 'application/octet-stream'}`;
}

/**
 * @description 生成接口文档 HTML
 */
export function buildApiDocsHtml({ projects, globals, currentRequest, activeProjectId = '', activeInterfaceId = '' }: BuildApiDocsHtmlOptions): string {
  const rawDocsProjects = getDocsProjects(projects, currentRequest, activeProjectId, activeInterfaceId);
  const variables = getDocVariableMap(globals);
  const docsProjects = rawDocsProjects.map((project) => ({
    ...project,
    name: interpolateVariables(project.name, variables),
    description: interpolateVariables(project.description, variables),
    groups: (project.groups || []).map((group) => ({
      ...group,
      name: interpolateVariables(group.name, variables),
    })),
    interfaces: project.interfaces.map((api) => {
      const request = resolveRequestForDocs(api.request, variables);

      return {
        ...api,
        name: interpolateVariables(api.name || request.name, variables),
        description: interpolateVariables(api.description, variables),
        method: request.method,
        url: request.url,
        request,
      };
    }),
  }));
  const generatedAt = new Date().toLocaleString();
  const gitShareIconDataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(gitShareIcon)}`;
  const totalCount = docsProjects.reduce((sum, project) => sum + project.interfaces.length, 0);
  const totalGroupCount = docsProjects.reduce((sum, project) => sum + getDocsGroups(project).length, 0);
  const docsData = {
    generatedAt,
    projects: docsProjects.map((project) => ({
      ...project,
      interfaces: project.interfaces.map((api) => ({
        ...api,
        request: cloneRequest(api.request),
      })),
    })),
  };

  /**
   * @description 渲染只读键值列表
   */
  const renderDocKeyValueReadonly = (title: string, list: KeyValueItem[]) => {
    const items = list.filter((item) => item.key.trim() || item.value.trim() || item.description?.trim() || item.fileName?.trim());
    const enabledCount = items.filter((item) => item.enabled && item.key.trim()).length;

    return `
      <div class="doc-block">
        <div class="doc-block-head">
          <h4>${escapeHtml(title)}</h4>
          <span>已配置 ${items.length} 项 · 启用 ${enabledCount} 项</span>
        </div>
        ${
          items.length === 0
            ? '<p class="muted">未配置</p>'
            : `<div class="doc-kv-table doc-kv-table-readonly">
                <div class="doc-kv-head doc-kv-head-readonly"><span>状态</span><span>名称</span><span>值</span><span>说明</span></div>
                ${items
                  .map(
                    (item) => `
                      <div class="doc-kv-row doc-kv-row-readonly ${item.enabled ? '' : 'is-disabled'}">
                        <span class="doc-kv-status ${item.enabled ? 'is-enabled' : ''}">${item.enabled ? '启用' : '停用'}</span>
                        <code>${escapeHtml(item.key || '-')}</code>
                        <code>${escapeHtml(getDocKeyValueDisplayValue(item))}</code>
                        <span class="doc-kv-description">${escapeHtml(item.description || '-')}</span>
                      </div>`,
                  )
                  .join('')}
              </div>`
        }
      </div>`;
  };

  /**
   * @description 渲染只读请求体
   */
  const renderDocBodyReadonly = (request: ApiRequestConfig) => {
    if (request.bodyType === 'form-urlencoded' || request.bodyType === 'form-data') {
      return renderDocKeyValueReadonly(`Body - ${request.bodyType}`, request.bodyForm);
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

  /**
   * @description 渲染只读认证信息
   */
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
        2,
      ),
    )}</pre>`;
  };

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <!-- 浏览器标签页图标：src/assets/icon/git-share.svg -->
  <link rel="icon" type="image/svg+xml" href="${escapeHtml(gitShareIconDataUrl)}" />
  <title>Q-ops Api 接口文档</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #1f2328; background: #f6f8fa; }
    header { position: sticky; top: 0; z-index: 5; padding: 16px 22px; color: #fff; background: linear-gradient(135deg, #0969da, #8250df); box-shadow: 0 8px 24px rgba(31,35,40,.12); }
    header h1 { margin: 0 0 6px; font-size: 22px; letter-spacing: .2px; }
    header p { margin: 0; opacity: .9; font-size: 14px; }
    main { max-width: 1440px; margin: 0 auto; padding: 0 16px 16px; }
    .layout { display: grid; grid-template-columns: 280px minmax(0, 1fr); align-items: start; gap: 16px; }
    nav { margin-top: 16px; position: sticky; top: 102px; padding: 12px; border: 1px solid #d0d7de; border-radius: 14px; background: #fff; box-shadow: 0 1px 2px rgba(31,35,40,.04); }
    .nav-project { padding: 8px 0 10px; border-bottom: 1px solid #d8dee4; }
    .nav-project:last-child { border-bottom: none; }
    .nav-project-title { margin: 0 0 8px; font-weight: 800; font-size: 16px; color: #1f2328; }
    .nav-group { margin: 6px 0 8px 8px; padding-left: 9px; border-left: 2px solid #d8dee4; }
    .nav-group-title { margin-bottom: 3px; color: #57606a; font-size: 12px; font-weight: 700; }
    nav a { display: block; padding: 7px 8px; color: #57606a; text-decoration: none; border-radius: 8px; font-size: 13px; }
    nav a:hover { color: #0969da; background: #ddf4ff; }
    .doc-content { min-width: 0; display: grid; gap: 16px; padding-top: 16px; }
    .project-section { overflow: hidden; border: 1px solid #d0d7de; border-radius: 14px; background: #eef2f6; }
    .project-head { padding: 15px 18px; color: #fff; background: #24292f; }
    .project-head h2 { margin: 0; font-size: 20px; }
    .project-head p { margin: 5px 0 0; color: #c9d1d9; font-size: 13px; }
    .group-section { padding: 14px; border-top: 1px solid #d0d7de; }
    .group-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 10px; }
    .group-head h3 { margin: 0; font-size: 16px; }
    .group-head span { color: #57606a; font-size: 12px; }
    .group-content { display: grid; gap: 12px; }
    article.api { padding: 16px; border: 1px solid #d0d7de; border-radius: 12px; background: #fff; box-shadow: 0 1px 2px rgba(31,35,40,.04); scroll-margin-top: 100px; }
    .doc-breadcrumb { margin-bottom: 10px; color: #6e7781; font-size: 12px; }
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
    .doc-detail-grid { display: block; }
    .doc-block { min-width: 0; margin-bottom: 14px; }
    .doc-block:last-child { margin-bottom: 0; }
    .doc-block-full { width: 100%; }
    .doc-block-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 6px; }
    .doc-block-head span { color: #8c959f; font-size: 12px; }
    .doc-kv-table { display: grid; gap: 6px; }
    .doc-kv-head, .doc-kv-row { display: grid; gap: 6px; align-items: center; }
    .doc-kv-head-readonly, .doc-kv-row-readonly { grid-template-columns: 54px minmax(110px, .8fr) minmax(150px, 1.35fr) minmax(100px, 1fr); }
    .doc-kv-head { color: #57606a; font-size: 12px; padding: 0 2px; }
    .doc-kv-row-readonly { padding: 6px; border: 1px solid #d8dee4; border-radius: 8px; background: #f6f8fa; }
    .doc-kv-row-readonly.is-disabled { opacity: .55; }
    .doc-kv-row-readonly code { min-width: 0; color: #1f2328; overflow: auto; white-space: pre-wrap; word-break: break-word; }
    .doc-kv-status { display: inline-flex; justify-content: center; padding: 2px 5px; color: #57606a; border-radius: 999px; background: #eaeef2; font-size: 10px; }
    .doc-kv-status.is-enabled { color: #1a7f37; background: #dafbe1; }
    .doc-kv-description { color: #57606a; font-size: 12px; word-break: break-word; }
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
    .globals { margin: 14px 0; padding: 12px; border: 1px solid #d0d7de; border-radius: 12px; background: #fff; }
    .globals-title { margin: 0 0 8px; font-weight: 800; }
    .global-row { display: grid; grid-template-columns: 160px minmax(0, 1fr); gap: 8px; padding: 6px 0; border-top: 1px solid #eef1f4; font-size: 13px; }
    .global-row:first-of-type { border-top: none; }
    @media (max-width: 860px) {
      header { position: static; padding: 14px 18px; }
      main { padding: 14px; }
      .layout { grid-template-columns: 1fr; }
      nav { position: static; }
      .request-line { grid-template-columns: 1fr; }
      h3 { white-space: normal; }
    }
  </style>
</head>
<body>
  <header>
    <h1>Q-ops Api 接口文档</h1>
    <p>生成时间：${escapeHtml(generatedAt)} · 项目 ${docsProjects.length} 个 · 分组 ${totalGroupCount} 个 · 接口 ${totalCount} 个</p>
  </header>
  <main>
    <div class="layout">
      <nav>
        ${docsProjects
          .map((project) => {
            const projectAnchor = createAnchorId('project', project.id);

            return `<div class="nav-project">
              <a class="nav-project-title" href="#${escapeHtml(projectAnchor)}">${escapeHtml(project.name)}</a>
              ${getDocsGroups(project)
                .map((group) => {
                  const groupAnchor = createAnchorId('group', project.id, group.id);

                  return `<div class="nav-group">
                    <a class="nav-group-title" href="#${escapeHtml(groupAnchor)}">${escapeHtml(group.name)}</a>
                    ${group.interfaces
                      .map((api) => {
                        const apiAnchor = createAnchorId('api', project.id, api.id);

                        return `<a href="#${escapeHtml(apiAnchor)}">${escapeHtml(api.request.method)} · ${escapeHtml(api.name)}</a>`;
                      })
                      .join('')}
                  </div>`;
                })
                .join('')}
            </div>`;
          })
          .join('')}
      </nav>
      <div class="doc-content">
        ${docsProjects
          .map((project) => {
            const projectAnchor = createAnchorId('project', project.id);

            return `<section class="project-section" id="${escapeHtml(projectAnchor)}">
              <div class="project-head">
                <h2>${escapeHtml(project.name)}</h2>
                <p>${escapeHtml(project.description || `包含 ${project.interfaces.length} 个接口`)}</p>
              </div>
              ${getDocsGroups(project)
                .map((group) => {
                  const groupAnchor = createAnchorId('group', project.id, group.id);

                  return `<section class="group-section" id="${escapeHtml(groupAnchor)}">
                    <div class="group-head"><h3>${escapeHtml(group.name)}</h3><span>${group.interfaces.length} 个接口</span></div>
                    <div class="group-content">
                      ${group.interfaces
                        .map((api) => {
                          const req = api.request;
                          const apiAnchor = createAnchorId('api', project.id, api.id);

                          return `<article class="api api-item" id="${escapeHtml(apiAnchor)}" data-api-id="${escapeHtml(api.id)}">
                            <div class="doc-breadcrumb"><strong>${escapeHtml(project.name)}</strong> &gt; <strong>${escapeHtml(group.name)}</strong> &gt; ${escapeHtml(api.name)}</div>
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
                            <div class="doc-meta"><span>Body 类型：${escapeHtml(req.bodyType)}</span><span>认证：${escapeHtml(req.auth.type)}</span><span>更新时间：${escapeHtml(formatTime(api.updatedAt))}</span></div>
                            <div class="doc-detail-grid">
                              ${renderDocKeyValueReadonly('请求参数 Params', req.params)}
                              ${renderDocKeyValueReadonly('请求 Headers', req.headers)}
                              ${renderDocKeyValueReadonly('请求 Cookies', req.cookies)}
                              <div class="doc-block"><div class="doc-block-head"><h4>认证 Auth</h4><span>${escapeHtml(req.auth.type)}</span></div>${renderAuthReadonly(req.auth)}</div>
                              <div class="doc-block doc-block-full">${renderDocBodyReadonly(req)}</div>
                            </div>
                            <div class="doc-response" data-doc-response></div>
                          </article>`;
                        })
                        .join('')}
                    </div>
                  </section>`;
                })
                .join('')}
            </section>`;
          })
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

      /**
       * @description 转义接口文档脚本中的 HTML 内容
       */
      function html(value) {
        return String(value == null ? '' : value)
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#39;');
      }

      /**
       * @description 格式化接口文档响应 JSON
       */
      function formatJson(text) {
        var value = String(text || '').trim();
        if (!value) return '';
        try { return JSON.stringify(JSON.parse(value), null, 2); } catch (error) { return text; }
      }

      /**
       * @description 格式化字节大小
       */
      function formatSize(size) {
        if (!size) return '0 B';
        if (size < 1024) return size + ' B';
        if (size < 1024 * 1024) return (size / 1024).toFixed(1) + ' KB';
        return (size / 1024 / 1024).toFixed(1) + ' MB';
      }

      /**
       * @description 将文本安全转换为 Base64
       */
      function safeBase64(value) {
        try { return btoa(unescape(encodeURIComponent(value))); } catch (error) { return btoa(value); }
      }

      /**
       * @description 获取接口文档全局变量
       */
      function getGlobals() {
        var result = {};
        (docs.globals || []).forEach(function (item) {
          if (!item.enabled || !String(item.key || '').trim()) return;
          result[String(item.key).trim()] = String(item.value || '');
        });
        return result;
      }

      /**
       * @description 替换接口文档中的变量占位符
       */
      function interpolate(value, variables) {
        return String(value || '').replace(/\\{\\{\\s*([\\w.-]+)\\s*\\}\\}/g, function (_, key) {
          return Object.prototype.hasOwnProperty.call(variables, key) ? variables[key] : '';
        });
      }

      /**
       * @description 将启用的文档键值项转换为对象
       */
      function enabledRowsToObject(list, variables) {
        var result = {};
        (list || []).forEach(function (item) {
          var key = interpolate(item && item.key, variables).trim();
          if (!item || item.enabled === false || !key) return;
          result[key] = interpolate(item.value, variables);
        });
        return result;
      }

      /**
       * @description 将启用的文档参数写入 URL
       */
      function enabledRowsToSearchParams(list, variables, urlObject) {
        (list || []).forEach(function (item) {
          var key = interpolate(item && item.key, variables).trim();
          if (!item || item.enabled === false || !key) return;
          urlObject.searchParams.set(key, interpolate(item.value, variables));
        });
      }

      /**
       * @description 删除指定请求头，名称匹配不区分大小写
       */
      function removeHeader(headers, name) {
        var targetName = String(name || '').toLowerCase();
        Object.keys(headers || {}).forEach(function (key) {
          if (key.toLowerCase() === targetName) delete headers[key];
        });
      }

      /**
       * @description 去掉文件 Data URL 前缀
       */
      function normalizeBase64FileData(value) {
        var fileData = String(value || '').trim();
        var separatorIndex = fileData.indexOf(',');
        return /^data:/i.test(fileData) && separatorIndex >= 0 ? fileData.slice(separatorIndex + 1) : fileData;
      }

      /**
       * @description 创建浏览器直接发送使用的 multipart/form-data
       */
      function createDirectFormData(items) {
        if (!Array.isArray(items) || items.length === 0) return undefined;
        var formData = new FormData();
        var hasValue = false;

        items.forEach(function (item) {
          var key = String(item && item.key || '').trim();
          if (!key) return;

          if (item.type === 'file') {
            var fileData = normalizeBase64FileData(item.fileData);
            if (!fileData) return;
            var binary = atob(fileData);
            var bytes = new Uint8Array(binary.length);
            for (var index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
            var blob = new Blob([bytes], { type: item.mimeType || 'application/octet-stream' });
            formData.append(key, blob, item.fileName || 'file');
            hasValue = true;
            return;
          }

          formData.append(key, String(item.value || ''));
          hasValue = true;
        });

        return hasValue ? formData : undefined;
      }

      /**
       * @description 构建接口文档请求参数
       */
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
        var formData;
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

          if (req.bodyType === 'form-data') {
            formData = (req.bodyForm || [])
              .filter(function (item) {
                return item && item.enabled !== false && String(item.key || '').trim();
              })
              .map(function (item) {
                if (item.valueType === 'file') {
                  return {
                    key: String(item.key).trim(),
                    type: 'file',
                    fileName: item.fileName || 'file',
                    mimeType: item.fileMimeType || 'application/octet-stream',
                    fileData: item.fileData || '',
                  };
                }

                return {
                  key: String(item.key).trim(),
                  type: 'text',
                  value: String(item.value || ''),
                };
              });
            removeHeader(headers, 'Content-Type');
          }
        }

        return {
          requestId: 'doc-' + Date.now() + '-' + Math.random().toString(16).slice(2),
          method: method,
          url: urlObject.toString(),
          headers: headers,
          body: body,
          formData: formData,
          timeout: timeout,
        };
      }

      /**
       * @description 直接发送接口文档请求
       */
      async function directFetch(payload) {
        var controller = new AbortController();
        var timer = payload.timeout > 0 ? setTimeout(function () { controller.abort(); }, payload.timeout) : null;
        var start = Date.now();

        try {
          var requestHeaders = Object.assign({}, payload.headers || {});
          var multipartBody = createDirectFormData(payload.formData);
          if (multipartBody) removeHeader(requestHeaders, 'Content-Type');
          var response = await fetch(payload.url, {
            method: payload.method,
            headers: requestHeaders,
            body: payload.method === 'GET' || payload.method === 'HEAD' ? undefined : (multipartBody || payload.body),
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

      /**
       * @description 发送接口文档请求参数
       */
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

      /**
       * @description 渲染接口文档请求响应
       */
      function renderResponse(article, result) {
        var box = article.querySelector('[data-doc-response]');
        if (!box) return;

        var body = result.error || result.body || '';
        var contentTypeKey = Object.keys(result.headers || {}).find(function (key) { return key.toLowerCase() === 'content-type'; });
        var contentType = contentTypeKey ? String(result.headers[contentTypeKey]).toLowerCase() : '';
        if (!result.error && (contentType.indexOf('application/json') >= 0 || /^[{[]/.test(String(body).trim()))) {
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

      /**
       * @description 发送接口文档中的接口请求
       */
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
