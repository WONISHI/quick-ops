import type { MouseEvent } from 'react';

import styles from './index.module.css';

import type { BaseButtonProps } from './type';

export type { BaseButtonIconPosition, BaseButtonProps, BaseButtonSize, BaseButtonType } from './type';

/**
 * @description 通用按钮组件
 */
export default function BaseButton({
  type = 'default',
  htmlType = 'button',
  size = 'medium',
  icon,
  iconPosition = 'left',
  children,
  loading = false,
  loadingIcon,
  block = false,
  circle = false,
  className,
  disabled,
  onClick,
  title,
  'aria-label': ariaLabel,
  ...buttonProps
}: BaseButtonProps) {
  const currentIcon = loading ? loadingIcon || <i className="codicon codicon-loading codicon-modifier-spin" /> : icon;

  const hasContent = children !== undefined && children !== null && children !== false;

  const iconOnly = type === 'icon' || (!!currentIcon && !hasContent);

  /**
   * @description 处理按钮点击事件
   */
  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (loading || disabled) {
      event.preventDefault();
      return;
    }

    onClick?.(event);
  };

  return (
    <button
      {...buttonProps}
      type={htmlType}
      title={title}
      aria-label={ariaLabel || (iconOnly ? title : undefined)}
      disabled={disabled || loading}
      className={[
        styles.button,
        styles[type],
        styles[size],
        iconOnly ? styles['icon-only'] : '',
        block ? styles.block : '',
        circle ? styles.circle : '',
        loading ? styles.loading : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      onClick={handleClick}
    >
      {currentIcon && iconPosition === 'left' && (
        <span className={styles['icon-slot']} aria-hidden="true">
          {currentIcon}
        </span>
      )}

      {hasContent && <span className={styles.content}>{children}</span>}

      {currentIcon && iconPosition === 'right' && (
        <span className={styles['icon-slot']} aria-hidden="true">
          {currentIcon}
        </span>
      )}
    </button>
  );
}
