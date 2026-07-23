import { useEffect, useState } from 'react';

export type VSCodeTheme = 'light' | 'dark';

/**
 * @description 获取适配 VS Code 当前颜色模式的 CodeMirror 主题
 */
function getResponseCodeMirrorTheme(): VSCodeTheme {
  const classList = document.body.classList;

  const isDark = classList.contains('vscode-dark') || classList.contains('vscode-high-contrast');

  return isDark ? 'dark' : 'light';
}

/**
 * @description 监听 VS Code Webview 主题变化
 */
export function useResponseCodeMirrorTheme(): VSCodeTheme {
  const [theme, setTheme] = useState<VSCodeTheme>(getResponseCodeMirrorTheme);

  useEffect(() => {
    const observer = new MutationObserver(() => {
      const nextTheme = getResponseCodeMirrorTheme();

      setTheme((currentTheme) => {
        return currentTheme === nextTheme ? currentTheme : nextTheme;
      });
    });

    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ['class'],
    });

    return () => {
      observer.disconnect();
    };
  }, []);

  return theme;
}

export default useResponseCodeMirrorTheme;
