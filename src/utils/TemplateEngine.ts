import { IWorkspaceContext } from '../services/WorkspaceContextService';

export class TemplateEngine {
  /**
   * 渲染模板 (纯正则替换版)
   * 将 [[variable]] 替换为 context 中的对应值
   */
  public static render(template: string | string[], context: IWorkspaceContext): string {
    // 1. 如果是数组，合并成字符串
    let result = Array.isArray(template) ? template.join('\n') : template;

    // 2. 正则匹配 [[ key ]]
    // \[\[ : 匹配开头 [[
    // \s* : 允许 key 前后有空格，例如 [[ ModuleName ]]
    // ([\w-]+) : 捕获组，匹配变量名 (允许字母、数字、下划线、中划线)
    // \s* : 允许结尾空格
    // \]\] : 匹配结尾 ]]
    // g : 全局匹配
    result = result.replace(/\[\[\s*([\w-]+)\s*\]\]/g, (match, key) => {
      const varName = key.trim(); // 去除可能的空格

      // 从 context 中查找变量
      const value = context[varName as keyof IWorkspaceContext];

      // 如果 context 中有这个值 (非 undefined 且 非 null)
      if (value !== undefined && value !== null) {
        return String(value);
      }

      // 如果没找到变量：
      // 策略 A: 保留原样 [[unknown]] (推荐，方便用户发现拼写错误)
      return match; 
      
      // 策略 B: 替换为空字符串 (如果你希望未定义的变量直接消失，解开下面这行)
      // return '';
    });

    return result;
  }
}