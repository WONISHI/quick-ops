import { useEffect, useId, type MouseEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

import styles from './index.module.css';

export type BaseDialogPlacement = 'center' | 'right';

export type BaseDialogActionVariant = 'default' | 'primary' | 'danger';

export interface BaseDialogAction {
  /**
   * @description 按钮唯一标识
   */
  key: string;

  /**
   * @description 按钮显示内容
   */
  label: ReactNode;

  /**
   * @description 按钮样式
   */
  variant?: BaseDialogActionVariant;

  /**
   * @description 是否禁用按钮
   */
  disabled?: boolean;

  /**
   * @description 按钮提示文本
   */
  title?: string;

  /**
   * @description 按钮点击事件
   */
  onClick?: () => void | Promise<void>;
}

export interface BaseDialogProps {
  /**
   * @description 是否显示弹窗
   */
  open: boolean;

  /**
   * @description 弹窗标题
   */
  title: ReactNode;

  /**
   * @description 弹窗内容，相当于 Vue 默认 slot
   */
  children?: ReactNode;

  /**
   * @description 自定义头部右侧内容
   */
  headerExtra?: ReactNode;

  /**
   * @description 自定义底部内容，相当于 Vue footer slot
   *
   * footer 的优先级高于 actions。
   */
  footer?: ReactNode;

  /**
   * @description 配置式底部按钮
   *
   * footer 未传入时才会渲染。
   */
  actions?: BaseDialogAction[];

  /**
   * @description 弹窗关闭事件
   */
  onClose: () => void;

  /**
   * @description 弹窗展示位置
   *
   * - center：居中弹窗
   * - right：右侧抽屉式弹窗
   */
  placement?: BaseDialogPlacement;

  /**
   * @description 弹窗宽度
   */
  width?: number | string;

  /**
   * @description 是否显示右上角关闭按钮
   */
  showClose?: boolean;

  /**
   * @description 点击遮罩层是否关闭
   */
  closeOnMask?: boolean;

  /**
   * @description 按下 Escape 是否关闭
   */
  closeOnEscape?: boolean;

  /**
   * @description 弹窗容器自定义类名
   */
  className?: string;

  /**
   * @description 弹窗内容区域自定义类名
   */
  bodyClassName?: string;
}

/**
 * @description 合并 CSS 类名
 */
function joinClassNames(...classNames: Array<string | undefined | false>): string {
  return classNames.filter(Boolean).join(' ');
}

/**
 * @description 转换弹窗宽度
 */
function normalizeWidth(width: number | string | undefined): string | undefined {
  if (typeof width === 'number') {
    return `${width}px`;
  }

  return width;
}

/**
 * @description 通用弹窗组件
 *
 * 支持：
 * - children 自定义内容
 * - footer 自定义底部
 * - actions 配置底部按钮
 * - center / right 两种展示模式
 * - 点击遮罩和 Escape 关闭
 */
export default function BaseDialog({
  open,
  title,
  children,
  headerExtra,
  footer,
  actions = [],
  onClose,
  placement = 'center',
  width,
  showClose = true,
  closeOnMask = true,
  closeOnEscape = true,
  className,
  bodyClassName,
}: BaseDialogProps) {
  const titleId = useId();

  /**
   * @description 监听 Escape 关闭弹窗
   */
  useEffect(() => {
    if (!open || !closeOnEscape) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;

      event.preventDefault();
      onClose();
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [closeOnEscape, onClose, open]);

  if (!open) return null;

  /**
   * @description 处理遮罩层点击
   */
  const handleMaskMouseDown = (event: MouseEvent<HTMLDivElement>) => {
    if (!closeOnMask) return;

    if (event.target !== event.currentTarget) {
      return;
    }

    onClose();
  };

  const content = (
    <div className={joinClassNames(styles.mask, placement === 'center' ? styles['mask-center'] : styles['mask-right'])} onMouseDown={handleMaskMouseDown}>
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={joinClassNames(styles.dialog, placement === 'center' ? styles['dialog-center'] : styles['dialog-right'], className)}
        style={{
          width: normalizeWidth(width),
        }}
        onMouseDown={(event) => {
          event.stopPropagation();
        }}
      >
        <header className={styles.header}>
          <strong id={titleId} className={styles.title}>
            {title}
          </strong>

          <div className={styles['header-actions']}>
            {headerExtra}

            {showClose && (
              <button type="button" className={styles['close-button']} title="关闭" aria-label="关闭" onClick={onClose}>
                ×
              </button>
            )}
          </div>
        </header>

        <div className={joinClassNames(styles.body, bodyClassName)}>{children}</div>

        {(footer || actions.length > 0) && (
          <footer className={styles.footer}>
            {footer ??
              actions.map((action) => (
                <button
                  type="button"
                  key={action.key}
                  className={joinClassNames(styles['action-button'], styles[`action-${action.variant || 'default'}`])}
                  disabled={action.disabled}
                  title={action.title}
                  onClick={() => {
                    void action.onClick?.();
                  }}
                >
                  {action.label}
                </button>
              ))}
          </footer>
        )}
      </section>
    </div>
  );

  return createPortal(content, document.body);
}
