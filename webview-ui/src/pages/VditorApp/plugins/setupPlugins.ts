export interface VditorPlugin {
  install: (content: string, ...args: any[]) => string;
}

export function setupPlugins() {
  const plugins: { plugin: VditorPlugin; args: any[] }[] = [];

  return {
    /**
     * 注册插件
     * @param plugin 引入的插件对象
     * @param args 传递给插件 install 方法的自定义参数
     */
    use(plugin: VditorPlugin, ...args: any[]) {
      plugins.push({ plugin, args });
      return this; // 返回 this 以支持链式调用：setupPlugins().use(A).use(B)
    },

    /**
     * 执行流水线处理
     * @param initialContent 原始 Markdown 文本
     * @returns 经过所有插件处理后的最终文本
     */
    process(initialContent: string): string {
      return plugins.reduce((currentContent, { plugin, args }) => {
        return plugin.install(currentContent, ...args);
      }, initialContent);
    }
  };
}