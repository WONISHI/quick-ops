import { useEffect, useMemo, useRef, useState } from 'react';
import Vditor from 'vditor';
import 'vditor/dist/index.css';
import { vscode } from '../../utils/vscode';
import styles from './index.module.css';
import { parseFileUriInfo } from '../../utils/index';

import { setupPlugins } from './plugins/setupPlugins';
import VditorMeta from './plugins/vditor-meta';
import VditorCompat from './plugins/vditor-compat';

interface VditorAppProps {
  /**
   * true：作为独立路由页面使用
   * false：作为其它页面里的组件使用
   */
  pageMode?: boolean;
}

type MetaValueType = 'link' | 'tag' | 'boolean' | 'date' | 'text' | 'empty';

type MetaRole = 'link' | 'copy' | 'icon';

type MetaDomEventName = keyof HTMLElementEventMap | string;

interface MetaActionContext {
  event: Event;
  element: HTMLElement;
  key: string;
  value: string;
  type: MetaValueType;
  role: MetaRole;
  iconType?: string;
}

interface MetaActionTools {
  postMessage: (message: any) => void;
  copy: (text: string) => Promise<void>;
  openExternal: (url: string) => Promise<void>;
  toast: (message: string) => void;
  emit: (eventName: string, payload?: any) => void;
}

interface MetaActionTrigger {
  on: MetaDomEventName;
  when?: (ctx: MetaActionContext) => boolean;
  preventDefault?: boolean | ((ctx: MetaActionContext) => boolean);
  stopPropagation?: boolean | ((ctx: MetaActionContext) => boolean);
  stopImmediatePropagation?: boolean | ((ctx: MetaActionContext) => boolean);
  run?: (ctx: MetaActionContext, tools: MetaActionTools) => void | Promise<void>;
  command?: string;
  payload?: Record<string, string>;
}

interface MetaActionNodeConfig {
  enabled?: boolean;
  triggers?: MetaActionTrigger[];
}

interface MetaCopyActionConfig extends MetaActionNodeConfig {
  visible?: 'hover' | 'always' | 'never';
  title?: string;
}

interface MetaIconActionConfig {
  enabled?: boolean;
  default?: MetaActionNodeConfig;
  byType?: Partial<Record<MetaValueType, MetaActionNodeConfig>>;
}

interface VditorMetaActionConfig {
  link?: MetaActionNodeConfig;
  copy?: MetaCopyActionConfig;
  icon?: MetaIconActionConfig;
}

function collectTriggerEventNames(action: VditorMetaActionConfig): string[] {
  const eventNames = new Set<string>();

  const collectNode = (node?: MetaActionNodeConfig | MetaCopyActionConfig) => {
    node?.triggers?.forEach((trigger) => {
      if (trigger.on) {
        eventNames.add(trigger.on);
      }
    });
  };

  collectNode(action.link);
  collectNode(action.copy);
  collectNode(action.icon?.default);

  Object.values(action.icon?.byType || {}).forEach((node) => {
    collectNode(node);
  });

  return Array.from(eventNames);
}

function getMetaActionNode(action: VditorMetaActionConfig, role: string, type: string, iconType: string): MetaActionNodeConfig | MetaCopyActionConfig | undefined {
  if (role === 'link') {
    return action.link;
  }

  if (role === 'copy') {
    return action.copy;
  }

  if (role === 'icon') {
    return action.icon?.byType?.[(iconType || type) as MetaValueType] || action.icon?.default;
  }

  return undefined;
}

function resolveBooleanFlag(value: boolean | ((ctx: MetaActionContext) => boolean) | undefined, ctx: MetaActionContext): boolean {
  if (typeof value === 'function') return value(ctx);
  return !!value;
}

function resolveTemplateValue(template: string, ctx: MetaActionContext): string {
  return String(template || '')
    .replace(/\$key/g, ctx.key)
    .replace(/\$value/g, ctx.value)
    .replace(/\$type/g, ctx.type)
    .replace(/\$role/g, ctx.role)
    .replace(/\$iconType/g, ctx.iconType || '');
}

function resolvePayload(payload: Record<string, string> | undefined, ctx: MetaActionContext): Record<string, string> {
  const result: Record<string, string> = {};

  Object.entries(payload || {}).forEach(([key, value]) => {
    result[key] = resolveTemplateValue(value, ctx);
  });

  return result;
}

async function handleMetaActionEvent(event: Event, action: VditorMetaActionConfig, tools: MetaActionTools): Promise<boolean> {
  const target = event.target as HTMLElement | null;
  const actionEl = target?.closest?.('[data-meta-action="true"]') as HTMLElement | null;

  if (!actionEl) return false;

  const role = actionEl.dataset.metaRole || '';
  const type = actionEl.dataset.metaType || '';
  const iconType = actionEl.dataset.metaIconType || '';

  const node = getMetaActionNode(action, role, type, iconType);

  if (!node?.enabled || !node.triggers?.length) {
    return false;
  }

  const ctx: MetaActionContext = {
    event,
    element: actionEl,
    key: actionEl.dataset.metaKey || '',
    value: actionEl.dataset.metaValue || '',
    type: (type || 'text') as MetaValueType,
    role: role as MetaRole,
    iconType,
  };

  const matchedTriggers = node.triggers.filter((trigger) => trigger.on === event.type);

  if (matchedTriggers.length === 0) return false;

  let handled = false;

  for (const trigger of matchedTriggers) {
    if (trigger.when && !trigger.when(ctx)) {
      continue;
    }

    if (resolveBooleanFlag(trigger.preventDefault, ctx)) {
      event.preventDefault();
    }

    if (resolveBooleanFlag(trigger.stopPropagation, ctx)) {
      event.stopPropagation();
    }

    if (resolveBooleanFlag(trigger.stopImmediatePropagation, ctx)) {
      event.stopImmediatePropagation();
    }

    if (trigger.run) {
      await trigger.run(ctx, tools);
      handled = true;
      continue;
    }

    if (trigger.command) {
      tools.postMessage({
        command: trigger.command,
        ...resolvePayload(trigger.payload, ctx),
        meta: {
          key: ctx.key,
          value: ctx.value,
          type: ctx.type,
          role: ctx.role,
          iconType: ctx.iconType,
        },
      });

      handled = true;
    }
  }

  return handled;
}

function createMetaActionTools(): MetaActionTools {
  return {
    postMessage: (message) => {
      vscode.postMessage(message);
    },

    copy: async (text) => {
      vscode.postMessage({
        command: 'copyToClipboard',
        text,
      });
    },

    openExternal: async (url) => {
      vscode.postMessage({
        command: 'openExternal',
        url,
      });
    },

    toast: (message) => {
      vscode.postMessage({
        command: 'showInfo',
        message,
      });
    },

    emit: (eventName, payload) => {
      window.dispatchEvent(
        new CustomEvent(`meta:${eventName}`, {
          detail: payload,
        })
      );
    },
  };
}

export default function VditorApp(props: VditorAppProps) {
  const { pageMode = false } = props;

  const vditorRef = useRef<HTMLDivElement>(null);
  const vditorInstanceRef = useRef<Vditor | null>(null);
  const [isReadMode, setIsReadMode] = useState(false);

  const metaAction = useMemo<VditorMetaActionConfig>(() => {
    return {
      /**
       * a 标签：
       * 单击不打开，双击才打开外部浏览器。
       */
      link: {
        enabled: true,
        triggers: [
          {
            on: 'dblclick',
            preventDefault: true,
            stopPropagation: true,
            run: async (ctx, tools) => {
              await tools.openExternal(ctx.value);
            },
          },
        ],
      },

      /**
       * 复制按钮：
       * 仍然是单击复制，不改成双击。
       */
      copy: {
        enabled: true,
        visible: 'hover',
        title: '复制内容',
        triggers: [
          {
            on: 'click',
            preventDefault: true,
            stopPropagation: true,
            run: async (ctx, tools) => {
              await tools.copy(ctx.value);
            },
          },
        ],
      },

      /**
       * 图标：
       * 链接图标单击复制链接，其它类型暂不绑定。
       */
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
                preventDefault: true,
                stopPropagation: true,
                run: async (ctx, tools) => {
                  await tools.copy(ctx.value);
                },
              },
            ],
          },
        },
      },
    };
  }, []);

  const destroyVditor = () => {
    try {
      vditorInstanceRef.current?.destroy();
    } catch {
      // ignore
    }

    vditorInstanceRef.current = null;

    if (vditorRef.current) {
      vditorRef.current.innerHTML = '';
    }
  };

  const renderMarkdown = async (content: string, fsPath: string, mode: 'read' | 'edit') => {
    if (!vditorRef.current) return;

    destroyVditor();

    const { fileName } = parseFileUriInfo(fsPath);
    const isEdit = mode === 'edit';

    setIsReadMode(!isEdit);

    const appPlugins = setupPlugins();

    const processedContent = appPlugins
      .use(VditorMeta, {
        action: metaAction,
      })
      .use(VditorCompat, {
        title: fileName || '文档预览',
      })
      .process(content || '');

    if (!isEdit) {
      await Vditor.preview(vditorRef.current, processedContent, {
        mode: 'light',
        theme: {
          current: 'classic',
        },
        markdown: {
          linkBase: '',
          linkPrefix: '',
          sanitize: false,
        },
        after: () => {
          const links = vditorRef.current?.querySelectorAll('a[href]') || [];

          links.forEach((link) => {
            link.setAttribute('draggable', 'false');

            const href = link.getAttribute('href') || '';

            if (href.startsWith('http://') || href.startsWith('https://')) {
              link.setAttribute('target', '_blank');
              link.setAttribute('rel', 'noopener noreferrer');
            }
          });
        },
      } as any);

      return;
    }

    const vd = new Vditor(vditorRef.current, {
      value: processedContent,
      mode: 'ir',
      theme: 'classic',
      lang: 'zh_CN',
      height: '100%',
      toolbar: undefined,
      toolbarConfig: {
        hide: false,
        pin: false,
      },
      cache: {
        enable: false,
      },
      preview: {
        theme: {
          current: 'classic',
        },
        markdown: {
          linkBase: '',
          linkPrefix: '',
          sanitize: false,
        },
      },
      after: () => {
        const vditorElement = vditorRef.current?.querySelector('.vditor') as HTMLElement | null;

        if (vditorElement) {
          vditorElement.style.height = '100%';
        }
      },
      input: () => { },
    });

    vditorInstanceRef.current = vd;
  };

  useEffect(() => {
    const tools = createMetaActionTools();
    const eventNames = collectTriggerEventNames(metaAction);

    const disposers = eventNames.map((eventName) => {
      const handler = (event: Event) => {
        void handleMetaActionEvent(event, metaAction, tools);
      };

      window.addEventListener(eventName, handler, true);

      return () => {
        window.removeEventListener(eventName, handler, true);
      };
    });

    /**
     * 单击 a 标签时，阻止默认跳转。
     * 真正打开动作放到 dblclick 里处理。
     *
     * 这里也会处理普通 Markdown 链接：
     * - 单击：不打开
     * - 双击：打开
     */
    const handleAnchorSingleClickBlocker = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      const anchor = target?.closest?.('a');
      const href = anchor?.getAttribute('href');

      if (anchor && href && (href.startsWith('http://') || href.startsWith('https://'))) {
        event.preventDefault();
        event.stopPropagation();
      }
    };

    /**
     * 兜底处理普通 Markdown a 标签。
     * frontmatter meta 里的 a 标签如果已经有 data-meta-action，
     * 会被 metaAction 的 dblclick 处理，这里不重复处理。
     */
    const handleFallbackAnchorDoubleClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;

      if (!target) return;

      if (target.closest('[data-meta-action="true"]')) {
        return;
      }

      const anchor = target.closest('a');
      const href = anchor?.getAttribute('href');

      if (anchor && href && (href.startsWith('http://') || href.startsWith('https://'))) {
        event.preventDefault();
        event.stopPropagation();

        vscode.postMessage({
          command: 'openExternal',
          url: href,
        });
      }
    };

    /**
     * 点击其它区域时，清空当前选中的文字。
     * 不影响链接、复制按钮、meta 图标原有逻辑。
     */
    const handleClearSelectionOnOtherClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;

      if (!target) return;

      const selection = window.getSelection();

      if (!selection || selection.isCollapsed) return;

      /**
       * 点击链接本身不清空。
       * 否则会影响链接文字里的局部选中。
       */
      if (target.closest('a')) {
        return;
      }

      /**
       * 点击复制按钮、meta 图标、meta action 元素不清空。
       * 避免影响你现有的复制 / 图标点击 / action 逻辑。
       */
      if (target.closest('.meta-copy-btn') || target.closest('.meta-icon') || target.closest('[data-meta-action="true"]')) {
        return;
      }

      selection.removeAllRanges();
    };

    const handleMessage = (e: MessageEvent) => {
      const msg = e.data;

      if (msg.type === 'initVditorData') {
        void renderMarkdown(msg.content || '', msg.fsPath || '', msg.mode === 'edit' ? 'edit' : 'read');
      }

      if (msg.type === 'initLocalFileError') {
        destroyVditor();

        if (vditorRef.current) {
          vditorRef.current.innerHTML = `<div class="${styles['vditor-error']}">${msg.message || 'Markdown 文件读取失败'}</div>`;
        }
      }
    };

    /**
 * 双击指定区域时，不保留浏览器默认选中的文字。
 * 不影响拖动选择文本，只处理双击后的选中效果。
 */
    const handleClearSelectionOnDoubleClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;

      if (!target) return;

      /**
       * 这里只处理你不希望双击选中的区域。
       * 目前先处理链接和 meta action 区域。
       */
      const shouldClear =
        target.closest('a') ||
        target.closest('[data-meta-action="true"]') ||
        target.closest('.meta-link-box');

      if (!shouldClear) return;

      window.setTimeout(() => {
        window.getSelection()?.removeAllRanges();
      }, 0);
    };

    window.addEventListener('message', handleMessage);
    window.addEventListener('click', handleAnchorSingleClickBlocker, true);
    window.addEventListener('dblclick', handleFallbackAnchorDoubleClick, true);
    window.addEventListener('mousedown', handleClearSelectionOnOtherClick, true);
    window.addEventListener('dblclick', handleClearSelectionOnDoubleClick, true);

    vscode.postMessage({
      command: 'webviewLoaded',
    });

    return () => {
      window.removeEventListener('message', handleMessage);
      window.removeEventListener('click', handleAnchorSingleClickBlocker, true);
      window.removeEventListener('dblclick', handleFallbackAnchorDoubleClick, true);
      window.removeEventListener('mousedown', handleClearSelectionOnOtherClick, true);
      window.removeEventListener('dblclick', handleClearSelectionOnDoubleClick, true);

      disposers.forEach((dispose) => dispose());

      destroyVditor();
    };
  }, [metaAction]);

  return (
    <div className={`${styles['vditor-container']} ${pageMode ? styles['page-mode'] : ''} ${isReadMode ? styles['read-mode'] : ''}`}>
      <div ref={vditorRef} className={styles['vditor-wrapper']} />
    </div>
  );
}