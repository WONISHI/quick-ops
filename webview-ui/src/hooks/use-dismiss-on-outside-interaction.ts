import { useEffect, useRef } from 'react';

interface UseDismissOnOutsideInteractionOptions {
  /**
   * @description 是否启用外部交互监听
   */
  active: boolean;

  /**
   * @description 触发关闭
   */
  onDismiss: () => void;

  /**
   * @description 视为组件内部的元素选择器
   *
   * 点击匹配元素或其子元素时不会触发关闭。
   */
  insideSelector: string;

  /**
   * @description 是否忽略鼠标右键
   *
   * @default true
   */
  ignoreRightClick?: boolean;

  /**
   * @description 当前窗口失焦时是否关闭
   *
   * 适用于 iframe、Webview、弹窗等场景。
   *
   * @default true
   */
  dismissOnWindowBlur?: boolean;
}

/**
 * @description 在组件外部发生交互时触发关闭
 *
 * 支持：
 * - 当前 document 内部的左键、中键、触摸交互
 * - iframe / Webview 失去窗口焦点
 *
 * 右键默认不会触发关闭，避免影响上下文菜单切换。
 */
export function useDismissOnOutsideInteraction(options: UseDismissOnOutsideInteractionOptions): void {
  const { active, onDismiss, insideSelector, ignoreRightClick = true, dismissOnWindowBlur = true } = options;

  const onDismissRef = useRef(onDismiss);

  useEffect(() => {
    onDismissRef.current = onDismiss;
  }, [onDismiss]);

  useEffect(() => {
    if (!active) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (ignoreRightClick && event.button === 2) {
        return;
      }

      const target = event.target;

      if (target instanceof Element && target.closest(insideSelector)) {
        return;
      }

      onDismissRef.current();
    };

    const handleWindowBlur = () => {
      onDismissRef.current();
    };

    document.addEventListener('pointerdown', handlePointerDown, true);

    if (dismissOnWindowBlur) {
      window.addEventListener('blur', handleWindowBlur);
    }

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);

      if (dismissOnWindowBlur) {
        window.removeEventListener('blur', handleWindowBlur);
      }
    };
  }, [active, insideSelector, ignoreRightClick, dismissOnWindowBlur]);
}
