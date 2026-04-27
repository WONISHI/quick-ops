import React, { useMemo } from 'react';
const iconModules = import.meta.glob('material-icon-theme/icons/*.svg', { 
    as: 'url', 
    eager: true 
});

// ==========================================
// 🌟 2. 映射字典 (提取为常量，提高渲染性能)
// ==========================================

// 精确文件名映射 (优先级高)
const EXACT_NAMES: Record<string, string> = {
    'package.json': 'npm',
    'yarn.lock': 'yarn',
    '.yarnrc': 'yarn',
    '.yarnrc.yml': 'yarn',
    'dockerfile': 'docker',
    'docker-compose.yml': 'docker',
    '.dockerignore': 'docker',
    '.gitignore': 'git',
    '.gitattributes': 'git',
    '.gitmodules': 'git',
    '.eslintrc.js': 'eslint',
    '.eslintrc.json': 'eslint',
    'eslint.config.js': 'eslint',
    '.prettierrc': 'prettier',
    '.editorconfig': 'editorconfig',
    'tsconfig.json': 'tsconfig',
};

// 扩展名映射 (优先级低)
const EXTENSIONS: Record<string, string> = {
    // === 前端 ===
    'ts': 'typescript',
    'tsx': 'react_ts',
    'js': 'javascript',
    'jsx': 'react',
    'cjs': 'javascript',
    'mjs': 'javascript',
    'vue': 'vue',
    'css': 'css',
    'less': 'less',
    'scss': 'sass',
    'sass': 'sass',
    'html': 'html',
    'htm': 'html',

    // === 后端 & 语言 ===
    'py': 'python',
    'pyw': 'python',
    'java': 'java',
    'class': 'javaclass',
    'jar': 'jar',
    'php': 'php',
    'rs': 'rust',
    'go': 'go',
    'c': 'c',
    'cpp': 'cpp',
    'h': 'h',
    'hpp': 'hpp',
    'cs': 'csharp',

    // === 配置 & 数据 ===
    'json': 'json',
    'jsonc': 'json',
    'yaml': 'yaml',
    'yml': 'yaml',
    'toml': 'toml',
    'xml': 'xml',
    'svg': 'svg',
    'sql': 'database',
    'db': 'database',
    'sqlite': 'database',

    // === 文档 & 媒体 ===
    'md': 'markdown',
    'markdown': 'markdown',
    'png': 'image',
    'jpg': 'image',
    'jpeg': 'image',
    'gif': 'image',
    'webp': 'image',
    'ico': 'image',
    'txt': 'document',
    'log': 'log',
    'csv': 'table',
    'pdf': 'pdf',

    // === 脚本 & 压缩包 ===
    'sh': 'console',
    'bash': 'console',
    'zsh': 'console',
    'bat': 'console',
    'cmd': 'console',
    'zip': 'zip',
    'tar': 'zip',
    'gz': 'zip',
    'rar': 'zip',
    '7z': 'zip',
};

interface FileIconProps {
    fileName: string;
    className?: string;
    style?: React.CSSProperties;
}

export const FileIcon: React.FC<FileIconProps> = ({ fileName, className, style }) => {
    const iconName = useMemo(() => {
        const lowerName = fileName.toLowerCase();
        
        if (EXACT_NAMES[lowerName]) {
            return EXACT_NAMES[lowerName];
        }

        const ext = lowerName.split('.').pop() || '';
        if (EXTENSIONS[ext]) {
            return EXTENSIONS[ext];
        }

        return 'file';
    }, [fileName]);

    const svgUrl = iconModules[`material-icon-theme/icons/${iconName}.svg`];

    const finalUrl = svgUrl || iconModules[`material-icon-theme/icons/file.svg`];

    return (
        <img 
            src={finalUrl} 
            alt={`${iconName} icon`} 
            className={className} 
            style={{ 
                width: '16px',
                height: '16px',
                objectFit: 'contain',
                display: 'inline-block',
                verticalAlign: 'middle',
                ...style 
            }} 
        />
    );
};

export default FileIcon;