import type { IWorkspaceContext } from '@common/types/common.service.type';
import type { RenderStatus, TemplateResult } from '@modules/package-scripts/package-scripts.type';
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

    let hasMissing = false;
    let hasEmpty = false;

    const result = rawContent.replace(/\[\[\s*([\w-]+)\s*\]\]/g, (match, key) => {
      const varName = key.trim();
      const value = context[varName as keyof IWorkspaceContext];
      if (value === undefined || value === null) {
        hasMissing = true; 
        return match;
      }
      if (Array.isArray(value) || isObject(value)) {
        if (Array.isArray(value) && value.length === 0) {
          hasEmpty = true;
        } else if (!Array.isArray(value) && Object.keys(value).length === 0) {
          hasEmpty = true;
        }
        payload[varName] = value;
        return match;
      }
      return String(value);
    });
    let status: RenderStatus = 'success';
    if (hasMissing) {
      status = 'missing';
    } else if (hasEmpty) {
      status = 'empty';
    }

    return { result, payload, status };
  }
}
