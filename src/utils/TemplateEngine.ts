import { IWorkspaceContext } from '../services/WorkspaceContextService';

// 定义返回结构：一个大字符串 + 提取出来的复杂数据
interface TemplateResult {
  result: string;                // 最终拼接好的字符串
  payload: Record<string, any>;  // 解析过程中提取出的数组/对象数据
}

export class TemplateEngine {
  /**
   * 渲染模板
   * @param template 模板字符串或数组
   * @param context 上下文数据
   * @returns { result, payload }
   */
  public static render(template: string | string[], context: IWorkspaceContext): TemplateResult {
    // 1. 既然你想要字符串，第一步直接用 \n 拼接起来
    const rawContent = Array.isArray(template) ? template.join('\n') : template;
    
    // 用于收集遇到的数组/对象
    const payload: Record<string, any> = {};

    // 2. 全局正则替换
    const result = rawContent.replace(/\[\[\s*([\w-]+)\s*\]\]/g, (match, key) => {
      const varName = key.trim();
      const value = context[varName as keyof IWorkspaceContext];

      // 情况 A: 没值，保留占位符
      if (value === undefined || value === null) {
        return match;
      }

      // 情况 B: 是数组或对象 (核心需求)
      // 动作：不替换字符串，保留 [[key]]，但把数据存到 payload 里
      if (Array.isArray(value) || typeof value === 'object') {
        payload[varName] = value;
        return match; // 返回原串，即 [[gitLocalBranch]]
      }

      // 情况 C: 是普通字符串/数字
      // 动作：直接替换
      return String(value);
    });

    // 3. 返回拼接好的字符串 和 提取出的数据
    return { result, payload };
  }
}