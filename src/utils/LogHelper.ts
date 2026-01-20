import * as path from 'path';
import dayjs from 'dayjs'; // 确保你安装了 dayjs: npm install dayjs
import { generateUUID } from './index'; // 复用你现有的 UUID 生成器
import { ILogrcConfig } from '../services/ConfigurationService';

export class LogHelper {
    /**
     * 解析日志模板，生成参数列表
     * @param template 用户配置的模板，例如 "[icon]-[line]-[name]"
     * @param context 上下文信息 (当前行号, 文件名等)
     * @param config 全局配置
     */
    static parseTemplate(
        template: string, 
        context: { line: number; fileName: string; filePath: string; rootPath: string },
        config: ILogrcConfig
    ): string[] {
        const regex = /\[([^\]]+)\]/g;
        const matches = [];
        let match;
        
        // 1. 提取所有占位符 (e.g., "icon", "line", "~/name")
        while ((match = regex.exec(template)) !== null) {
            matches.push(match[1]);
        }

        // 2. 逐个替换为值
        return matches.map(tag => {
            return this.handleTag(tag, context, config);
        });
    }

    private static handleTag(
        tag: string, 
        ctx: { line: number; fileName: string; filePath: string; rootPath: string },
        config: ILogrcConfig
    ): string {
        // A. 基础处理
        if (tag === 'icon') return '🚀🚀🚀';
        if (tag === 'line') return `第${ctx.line + 1}行`;
        if (tag === 'uuid') return generateUUID(config.utils.uuidLength || 12);
        if (tag === 'time') return dayjs().format(config.logger.dateFormat || 'HH:mm:ss');
        if (tag === '$0') return '$0'; // 光标停留位置

        // B. 路径/文件名处理 (兼容旧逻辑: ~/name, ^/name)
        if (tag.includes('name')) {
            return this.formatPathName(tag, ctx);
        }

        return tag; // 未知标签直接返回
    }

    private static formatPathName(tag: string, ctx: { fileName: string; filePath: string; rootPath: string }): string {
        // 简单处理：如果只写了 [name]，返回文件名
        if (tag === 'name') return `${ctx.fileName}文件`;

        // 复杂处理：处理 ~/name (相对于根目录) 或 ^/name (父目录)
        // 这里简化实现，实际可根据需要移植旧的 formattedPath 逻辑
        let relativePath = path.relative(ctx.rootPath, ctx.filePath);
        
        if (tag.startsWith('~/')) {
            // 模拟保留部分路径结构
             const parts = relativePath.split(path.sep);
             if (parts.length > 2) relativePath = parts.slice(-2).join('/');
        }
        
        return relativePath;
    }
}