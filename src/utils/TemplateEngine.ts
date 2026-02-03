import type { IWorkspaceContext } from '../core/types/work-space';
import type { RenderStatus, TemplateResult } from '../core/types/package-script';
import { isObject } from 'lodash-es';

export class TemplateEngine {
  /**
   * 渲染模板
   * @param template 模板字符串或数组
   * @param context 上下文数据
   * @returns { result, payload, status }
   */
  public static render(template: string | string[], context: IWorkspaceContext): TemplateResult {
    const rawContent = Array.isArray(template) ? template.join('\n') : template;
    const payload: Record<string, any> = {};

    // 用于追踪状态的标志位
    let hasMissing = false;
    let hasEmpty = false;

    const result = rawContent.replace(/\[\[\s*([\w-]+)\s*\]\]/g, (match, key) => {
      const varName = key.trim();
      const value = context[varName as keyof IWorkspaceContext];

      // 1. 检查缺失 (undefined 或 null)
      if (value === undefined || value === null) {
        hasMissing = true; // 标记为缺失
        return match; // 保留占位符
      }

      // 2. 检查数组或对象
      if (Array.isArray(value) || isObject(value)) {
        // 检查是否为空数组或空对象
        if (Array.isArray(value) && value.length === 0) {
          hasEmpty = true;
        } else if (!Array.isArray(value) && Object.keys(value).length === 0) {
          hasEmpty = true;
        }

        // 存入 payload，不替换文本
        payload[varName] = value;
        return match;
      }

      // 3. 普通值 (String/Number)
      // 如果是空字符串，视情况而定，通常不算错误，这里暂不标记为 empty
      return String(value);
    });

    // 计算最终状态 (优先级：missing > empty > success)
    let status: RenderStatus = 'success';
    if (hasMissing) {
      status = 'missing';
    } else if (hasEmpty) {
      status = 'empty';
    }

    return { result, payload, status };
  }
}
