export type MetaValueType = 'link' | 'tag' | 'boolean' | 'date' | 'text' | 'empty';

export type MetaRole = 'link' | 'copy' | 'icon';

export type MetaDomEventName = keyof HTMLElementEventMap | string;

export interface MetaActionContext {
  event: Event;
  element: HTMLElement;
  key: string;
  value: string;
  type: MetaValueType;
  role: MetaRole;
  iconType?: string;
}

export interface MetaActionTools {
  postMessage: (message: any) => void;
  copy: (text: string) => Promise<void>;
  openExternal: (url: string) => Promise<void>;
  toast: (message: string) => void;
  emit: (eventName: string, payload?: any) => void;
}

export interface MetaActionTrigger {
  on: MetaDomEventName;
  when?: (ctx: MetaActionContext) => boolean;
  preventDefault?: boolean | ((ctx: MetaActionContext) => boolean);
  stopPropagation?: boolean | ((ctx: MetaActionContext) => boolean);
  stopImmediatePropagation?: boolean | ((ctx: MetaActionContext) => boolean);
  run?: (ctx: MetaActionContext, tools: MetaActionTools) => void | Promise<void>;
  command?: string;
  payload?: Record<string, string>;
}

export interface MetaActionNodeConfig {
  enabled?: boolean;
  triggers?: MetaActionTrigger[];
}

export interface MetaCopyActionConfig extends MetaActionNodeConfig {
  visible?: 'hover' | 'always' | 'never';
  title?: string;
}

export interface MetaIconActionConfig {
  enabled?: boolean;
  default?: MetaActionNodeConfig;
  byType?: Partial<Record<MetaValueType, MetaActionNodeConfig>>;
}

export interface VditorMetaActionConfig {
  link?: MetaActionNodeConfig;
  copy?: MetaCopyActionConfig;
  icon?: MetaIconActionConfig;
}

export interface ResolvedVditorMetaActionConfig {
  link: MetaActionNodeConfig;
  copy: MetaCopyActionConfig;
  icon: {
    enabled?: boolean;
    default?: MetaActionNodeConfig;
    byType?: Partial<Record<MetaValueType, MetaActionNodeConfig>>;
  };
}

export interface VditorMetaOptions {
  action?: VditorMetaActionConfig;
}

interface MetaEntry {
  key: string;
  values: string[];
}

interface RenderMetaContext {
  key: string;
  value: string;
  type: MetaValueType;
  role: MetaRole;
  iconType?: MetaValueType;
}

const defaultActionConfig: ResolvedVditorMetaActionConfig = {
  link: {
    enabled: true,
    triggers: [
      {
        on: 'dblclick',
        command: 'openExternal',
        preventDefault: true,
        stopPropagation: true,
        payload: {
          url: '$value',
          key: '$key',
          type: '$type',
        },
      },
    ],
  },

  copy: {
    enabled: true,
    visible: 'hover',
    title: '复制内容',
    triggers: [
      {
        on: 'click',
        command: 'copyToClipboard',
        preventDefault: true,
        stopPropagation: true,
        payload: {
          text: '$value',
          key: '$key',
          type: '$type',
        },
      },
    ],
  },

  icon: {
    enabled: true,
    default: {
      enabled: false,
      triggers: [],
    },
    byType: {
      link: {
        enabled: true,
        triggers: [
          {
            on: 'click',
            command: 'copyToClipboard',
            preventDefault: true,
            stopPropagation: true,
            payload: {
              text: '$value',
              key: '$key',
              type: '$type',
            },
          },
        ],
      },
      tag: {
        enabled: false,
        triggers: [],
      },
      date: {
        enabled: false,
        triggers: [],
      },
      text: {
        enabled: false,
        triggers: [],
      },
      boolean: {
        enabled: false,
        triggers: [],
      },
      empty: {
        enabled: false,
        triggers: [],
      },
    },
  },
};

function mergeNodeConfig<T extends MetaActionNodeConfig | MetaCopyActionConfig>(defaultNode: T, customNode?: Partial<T>): T {
  return {
    ...defaultNode,
    ...(customNode || {}),
    triggers: customNode?.triggers || defaultNode.triggers || [],
  } as T;
}

export function resolveVditorMetaAction(action?: VditorMetaActionConfig): ResolvedVditorMetaActionConfig {
  const mergedByType: Partial<Record<MetaValueType, MetaActionNodeConfig>> = {
    ...(defaultActionConfig.icon.byType || {}),
  };

  Object.entries(action?.icon?.byType || {}).forEach(([type, node]) => {
    const key = type as MetaValueType;
    mergedByType[key] = mergeNodeConfig(defaultActionConfig.icon.byType?.[key] || { enabled: true, triggers: [] }, node);
  });

  return {
    link: mergeNodeConfig(defaultActionConfig.link, action?.link),
    copy: mergeNodeConfig(defaultActionConfig.copy, action?.copy),
    icon: {
      ...defaultActionConfig.icon,
      ...(action?.icon || {}),
      default: mergeNodeConfig(defaultActionConfig.icon.default || { enabled: false, triggers: [] }, action?.icon?.default),
      byType: mergedByType,
    },
  };
}

function escapeHtml(value: string): string {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeAttr(value: string): string {
  return escapeHtml(value).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function stripQuote(value: string): string {
  let val = String(value || '').trim();

  if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
    val = val.slice(1, -1).trim();
  }

  return val;
}

function isListItemLine(trimmedLine: string): boolean {
  return trimmedLine.startsWith('- ') || /^-(https?:\/\/|ssh:\/\/|git@)/i.test(trimmedLine);
}

function normalizeListValue(value: string): string {
  return stripQuote(value.replace(/^-/, '').trim());
}

function inferValueType(value: string): MetaValueType {
  const val = String(value || '').trim();

  if (!val) return 'empty';

  if (/^(https?:\/\/|ssh:\/\/|git@)/i.test(val)) {
    return 'link';
  }

  if (/^\[\[(.*?)\]\]$/.test(val)) {
    return 'tag';
  }

  if (val.toLowerCase() === 'true' || val.toLowerCase() === 'false') {
    return 'boolean';
  }

  if (!Number.isNaN(Date.parse(val)) && val.length >= 8 && /\d{4}/.test(val)) {
    return 'date';
  }

  return 'text';
}

function getIconClassByType(type: MetaValueType): string {
  switch (type) {
    case 'link':
      return 'codicon-link';
    case 'tag':
      return 'codicon-tag';
    case 'date':
      return 'codicon-calendar';
    case 'boolean':
      return 'codicon-checklist';
    case 'empty':
      return 'codicon-dash';
    case 'text':
    default:
      return 'codicon-symbol-string';
  }
}

function hasTriggers(node?: MetaActionNodeConfig): boolean {
  if (!node?.enabled) return false;
  return Array.isArray(node.triggers) && node.triggers.length > 0;
}

function getIconActionNode(type: MetaValueType, action: ResolvedVditorMetaActionConfig): MetaActionNodeConfig | undefined {
  if (!action.icon.enabled) return undefined;

  return action.icon.byType?.[type] || action.icon.default;
}

function createActionAttrs(ctx: RenderMetaContext, action: ResolvedVditorMetaActionConfig): string {
  let node: MetaActionNodeConfig | undefined;

  if (ctx.role === 'link') {
    node = action.link;
  } else if (ctx.role === 'copy') {
    node = action.copy;
  } else if (ctx.role === 'icon') {
    node = getIconActionNode(ctx.iconType || ctx.type, action);
  }

  const actionable = hasTriggers(node);

  const attrs = [
    `data-meta-role="${escapeAttr(ctx.role)}"`,
    `data-meta-key="${escapeAttr(ctx.key)}"`,
    `data-meta-value="${escapeAttr(ctx.value)}"`,
    `data-meta-type="${escapeAttr(ctx.type)}"`,
  ];

  if (ctx.iconType) {
    attrs.push(`data-meta-icon-type="${escapeAttr(ctx.iconType)}"`);
  }

  if (actionable) {
    attrs.push(`data-meta-action="true"`);
    attrs.push(`tabindex="0"`);
  }

  return attrs.join(' ');
}

function renderIcon(ctx: Omit<RenderMetaContext, 'role'>, action: ResolvedVditorMetaActionConfig): string {
  const iconType = ctx.iconType || ctx.type;
  const iconClass = getIconClassByType(iconType);

  return [
    `<i class="codicon ${iconClass} meta-icon meta-value-icon"`,
    createActionAttrs(
      {
        ...ctx,
        role: 'icon',
        iconType,
      },
      action
    ),
    `></i>`,
  ].join(' ');
}

function renderCopyButton(ctx: Omit<RenderMetaContext, 'role'>, action: ResolvedVditorMetaActionConfig, title?: string): string {
  if (!action.copy.enabled || action.copy.visible === 'never') return '';

  const visibleClass = action.copy.visible === 'always' ? 'meta-copy-btn-always' : '';

  return [
    `<i class="codicon codicon-copy meta-copy-btn ${visibleClass}"`,
    createActionAttrs(
      {
        ...ctx,
        role: 'copy',
      },
      action
    ),
    `title="${escapeAttr(title || action.copy.title || '复制内容')}"`,
    `></i>`,
  ].join(' ');
}

function renderLinkValue(key: string, value: string, action: ResolvedVditorMetaActionConfig): string {
  const type: MetaValueType = 'link';

  return [
    '<div class="meta-link-box">',
    renderIcon({ key, value, type, iconType: 'link' }, action),
    `<a href="${escapeAttr(value)}" class="meta-link" ${createActionAttrs({ key, value, type, role: 'link' }, action)}>${escapeHtml(value)}</a>`,
    renderCopyButton({ key, value, type }, action, '复制链接'),
    '</div>',
  ].join('');
}

function renderTagValue(key: string, value: string, action: ResolvedVditorMetaActionConfig): string {
  const type: MetaValueType = 'tag';
  const tag = value.match(/^\[\[(.*?)\]\]$/)?.[1] || value;

  return [
    '<div class="meta-tag">',
    renderIcon({ key, value: tag, type, iconType: 'tag' }, action),
    `<span>${escapeHtml(tag)}</span>`,
    '</div>',
  ].join('');
}

function renderBooleanValue(key: string, value: string, action: ResolvedVditorMetaActionConfig): string {
  const type: MetaValueType = 'boolean';
  const isChecked = value.toLowerCase() === 'true';

  return [
    '<div class="meta-checkbox">',
    renderIcon({ key, value, type, iconType: 'boolean' }, action),
    `<input type="checkbox" ${isChecked ? 'checked' : ''} disabled />`,
    '</div>',
  ].join('');
}

function renderDateValue(key: string, value: string, action: ResolvedVditorMetaActionConfig): string {
  const type: MetaValueType = 'date';

  return [
    '<div class="meta-date">',
    renderIcon({ key, value, type, iconType: 'date' }, action),
    `<span>${escapeHtml(value)}</span>`,
    renderCopyButton({ key, value, type }, action, '复制日期'),
    '</div>',
  ].join('');
}

function renderTextValue(key: string, value: string, action: ResolvedVditorMetaActionConfig): string {
  const type: MetaValueType = 'text';

  return [
    '<div class="meta-link-box meta-text-box">',
    renderIcon({ key, value, type, iconType: 'text' }, action),
    `<span class="meta-text-value">${escapeHtml(value)}</span>`,
    renderCopyButton({ key, value, type }, action, '复制内容'),
    '</div>',
  ].join('');
}

function renderEmptyValue(key: string, action: ResolvedVditorMetaActionConfig): string {
  const type: MetaValueType = 'empty';

  return [
    '<div class="meta-empty">',
    renderIcon({ key, value: '', type, iconType: 'empty' }, action),
    '<span style="opacity: 0.3;">-</span>',
    '</div>',
  ].join('');
}

function renderMetaValue(key: string, value: string, action: ResolvedVditorMetaActionConfig): string {
  const type = inferValueType(value);

  if (type === 'link') return renderLinkValue(key, value, action);
  if (type === 'tag') return renderTagValue(key, value, action);
  if (type === 'boolean') return renderBooleanValue(key, value, action);
  if (type === 'date') return renderDateValue(key, value, action);
  if (type === 'empty') return renderEmptyValue(key, action);

  return renderTextValue(key, value, action);
}

function parseFrontmatter(innerContent: string): MetaEntry[] {
  const lines = innerContent.split(/\r?\n/);

  const entries: MetaEntry[] = [];
  let currentEntry: MetaEntry | null = null;

  lines.forEach((line: string) => {
    const trimmedLine = line.trim();

    if (!trimmedLine) return;

    if (isListItemLine(trimmedLine)) {
      const val = normalizeListValue(trimmedLine);

      if (currentEntry && val) {
        currentEntry.values.push(val);
      }

      return;
    }

    const colonIndex = line.indexOf(':');

    if (colonIndex === -1) return;

    const key = line.substring(0, colonIndex).trim();
    let value = line.substring(colonIndex + 1).trim();

    if (!key) return;

    if (value.startsWith('- ') || /^-(https?:\/\/|ssh:\/\/|git@)/i.test(value)) {
      value = normalizeListValue(value);
    } else {
      value = stripQuote(value);
    }

    currentEntry = {
      key,
      values: [],
    };

    if (value) {
      currentEntry.values.push(value);
    }

    entries.push(currentEntry);
  });

  return entries;
}

const VditorMeta = {
  install(content: string, options: VditorMetaOptions = {}): string {
    const action = resolveVditorMetaAction(options.action);

    const frontmatterRegex = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---/;

    return content.replace(frontmatterRegex, (match, innerContent) => {
      const entries = parseFrontmatter(innerContent);

      const tableRows = entries
        .map((entry) => {
          const renderValue =
            entry.values.length === 0
              ? renderEmptyValue(entry.key, action)
              : entry.values.map((val) => renderMetaValue(entry.key, val, action)).join('<div class="meta-value-gap"></div>');

          return [
            '<tr>',
            `<td class="meta-key">${escapeHtml(entry.key)}</td>`,
            `<td class="meta-value">${renderValue}</td>`,
            '</tr>',
          ].join('');
        })
        .join('');

      if (!tableRows) return match;

      return [
        '<div class="frontmatter-table-container">',
        '<table class="frontmatter-table">',
        '<tbody>',
        tableRows,
        '</tbody>',
        '</table>',
        '</div>',
        '',
      ].join('\n');
    });
  },
};

export default VditorMeta;