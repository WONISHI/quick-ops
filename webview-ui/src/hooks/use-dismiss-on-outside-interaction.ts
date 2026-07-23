import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';

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
  insideSelector?: string;

  /**
   * @description 视为组件内部的元素 Ref
   *
   * 适合区分多个相同组件实例：
   * 只把当前实例自己的触发器视为内部区域。
   */
  insideRefs?: ReadonlyArray<RefObject<HTMLElement | null>>;

  /**
   * @description 是否忽略鼠标右键
   *
   * @default false
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
 * - 当前 document 内的左键、中键、右键和触摸交互
 * - iframe / Webview 失去窗口焦点
 * - 通过 selector 判断 Portal 浮层内部
 * - 通过 Ref 判断当前组件实例自己的触发区域
 */
export function useDismissOnOutsideInteraction(options: UseDismissOnOutsideInteractionOptions): void {
  const { active, onDismiss, insideSelector, insideRefs = [], ignoreRightClick = false, dismissOnWindowBlur = true } = options;

  const onDismissRef = useRef(onDismiss);
  const insideRefsRef = useRef(insideRefs);

  useEffect(() => {
    onDismissRef.current = onDismiss;
  }, [onDismiss]);

  useEffect(() => {
    insideRefsRef.current = insideRefs;
  }, [insideRefs]);

  useEffect(() => {
    if (!active) return;

    const isInside = (target: EventTarget | null): boolean => {
      if (!(target instanceof Node)) {
        return false;
      }

      if (insideSelector && target instanceof Element && target.closest(insideSelector)) {
        return true;
      }

      return insideRefsRef.current.some((ref) => {
        return Boolean(ref.current?.contains(target));
      });
    };

    const handlePointerDown = (event: PointerEvent) => {
      if (ignoreRightClick && event.button === 2) {
        return;
      }

      if (isInside(event.target)) {
        return;
      }

      /**
       * 这里只触发关闭，不阻止事件传播。
       *
       * 因此右键点击其他目标时：
       * 1. pointerdown 捕获阶段关闭旧菜单；
       * 2. 原目标继续收到 contextmenu；
       * 3. 原目标打开新的右键菜单。
       */
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
