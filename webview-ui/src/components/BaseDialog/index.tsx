import { useEffect, useId, type MouseEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

import styles from './index.module.css';

export type BaseDialogPlacement = 'center' | 'right';

export type BaseDialogActionType = 'default' | 'primary' | 'danger';

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
   * @description 按钮类型
   */
  type?: BaseDialogActionType;

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
   * @description 弹窗主体内容，相当于默认 slot
   */
  children?: ReactNode;

  /**
   * @description 自定义头部右侧内容
   */
  headerExtra?: ReactNode;

  /**
   * @description 自定义底部内容，相当于 footer slot
   *
   * footer 的优先级高于 actions。
   */
  footer?: ReactNode;

  /**
   * @description 配置式底部按钮
   */
  actions?: BaseDialogAction[];

  /**
   * @description 关闭弹窗
   */
  onClose: () => void;

  /**
   * @description 弹窗展示位置
   */
  placement?: BaseDialogPlacement;

  /**
   * @description 弹窗宽度
   */
  width?: number | string;

  /**
   * @description 是否显示关闭按钮
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
   * @description 弹窗主体自定义类名
   */
  bodyClassName?: string;

  /**
   * @description 弹窗底部自定义类名
   */
  footerClassName?: string;
}

/**
 * @description 合并 CSS 类名
 */
function joinClassNames(...classNames: Array<string | undefined | false>): string {
  return classNames.filter(Boolean).join(' ');
}

/**
 * @description 规范化弹窗宽度
 */
function normalizeWidth(width?: number | string): string | undefined {
  if (typeof width === 'number') {
    return `${width}px`;
  }

  return width;
}

/**
 * @description 基础通用弹窗
 *
 * 支持：
 * - children 自定义主体内容
 * - footer 自定义底部内容
 * - actions 配置底部按钮
 * - center 居中弹窗
 * - right 右侧抽屉
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
  footerClassName,
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

  const dialog = (
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
          <footer className={joinClassNames(styles.footer, footerClassName)}>
            {footer ??
              actions.map((action) => (
                <button
                  type="button"
                  key={action.key}
                  className={joinClassNames(styles['action-button'], styles[`action-${action.type || 'default'}`])}
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

  return createPortal(dialog, document.body);
}
