import * as path from 'path';
import dayjs from 'dayjs';
import { nanoid } from 'nanoid';
import type { ILogrcConfig } from '@common/types/common.service.type';

export class LogHelper {
  /**
   * 解析日志模板，生成参数列表
   * @param template 用户配置的模板，例如 "[icon]-[line]-[name]"
   * @param context 上下文信息 (当前行号, 文件名等)
   * @param config 全局配置
   */
  static parseTemplate(template: string, context: { line: number; fileName: string; filePath: string; rootPath: string }, config: ILogrcConfig): string[] {
    const regex = /\[([^\]]+)\]/g;
    const matches = [];
    let match;

    while ((match = regex.exec(template)) !== null) {
      matches.push(match[1]);
    }

    return matches.map((tag) => {
      return this.handleTag(tag, context, config);
    });
  }

  private static handleTag(tag: string, ctx: { line: number; fileName: string; filePath: string; rootPath: string }, config: ILogrcConfig): string {
    if (tag === 'icon') return '🚀🚀🚀';
    if (tag === 'line') return `第${ctx.line + 1}行`;
    if (tag === 'uuid') return nanoid(config.utils.uuidLength || 12);
    if (tag === 'time') return dayjs().format(config.logger.dateFormat || 'HH:mm:ss');
    if (tag === '$0') return '$0';

    if (tag.includes('name')) {
      return this.formatPathName(tag, ctx);
    }

    return tag;
  }

  private static formatPathName(tag: string, ctx: { fileName: string; filePath: string; rootPath: string }): string {
    if (tag === 'name') return `${ctx.fileName}文件`;

    let relativePath = path.relative(ctx.rootPath, ctx.filePath);

    if (tag.startsWith('~/')) {
      const parts = relativePath.split(path.sep);
      if (parts.length > 2) relativePath = parts.slice(-2).join('/');
    }

    return relativePath;
  }
}
