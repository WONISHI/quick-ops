import React from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
    faImage, faCode, faFile, faTerminal, faFileZipper,
    faFilePdf, faFileLines, faDatabase, faGear
} from '@fortawesome/free-solid-svg-icons';
import {
    faMarkdown, faHtml5, faCss3Alt, faVuejs, faJs, faPython,
    faJava, faPhp, faDocker, faGitAlt, faNpm, faYarn, faRust
} from '@fortawesome/free-brands-svg-icons';

interface FileIconProps {
    fileName: string;
    className?: string;
    style?: React.CSSProperties;
}

export const FileIcon: React.FC<FileIconProps> = ({ fileName, className, style }) => {
    const lowerName = fileName.toLowerCase();
    const ext = lowerName.split('.').pop() || '';

    switch (lowerName) {
        case 'package.json':
            return <FontAwesomeIcon icon={faNpm} className={className} style={{ color: '#cb3837', ...style }} />;
        case 'yarn.lock':
        case '.yarnrc':
        case '.yarnrc.yml':
            return <FontAwesomeIcon icon={faYarn} className={className} style={{ color: '#2c8ebb', ...style }} />;
        case 'dockerfile':
        case 'docker-compose.yml':
        case '.dockerignore':
            return <FontAwesomeIcon icon={faDocker} className={className} style={{ color: '#2496ed', ...style }} />;
        case '.gitignore':
        case '.gitattributes':
        case '.gitmodules':
            return <FontAwesomeIcon icon={faGitAlt} className={className} style={{ color: '#f14e32', ...style }} />;
        case '.eslintrc.js':
        case '.eslintrc.json':
        case 'eslint.config.js':
        case '.prettierrc':
        case '.editorconfig':
        case 'tsconfig.json':
            return <FontAwesomeIcon icon={faGear} className={className} style={{ color: '#6d8086', ...style }} />;
    }

    // 2. 按扩展名匹配
    switch (ext) {
        // === 前端 ===
        case 'ts':
        case 'tsx':
            return <FontAwesomeIcon icon={faJs} className={className} style={{ color: '#3178c6', ...style }} />;
        case 'js':
        case 'jsx':
        case 'cjs':
        case 'mjs':
            return <FontAwesomeIcon icon={faJs} className={className} style={{ color: '#f1e05a', ...style }} />;
        case 'vue':
            return <FontAwesomeIcon icon={faVuejs} className={className} style={{ color: '#41b883', ...style }} />;
        case 'css':
        case 'less':
        case 'scss':
        case 'sass':
            return <FontAwesomeIcon icon={faCss3Alt} className={className} style={{ color: '#264de4', ...style }} />;
        case 'html':
        case 'htm':
            return <FontAwesomeIcon icon={faHtml5} className={className} style={{ color: '#e34c26', ...style }} />;

        // === 后端 & 语言 ===
        case 'py':
        case 'pyw':
            return <FontAwesomeIcon icon={faPython} className={className} style={{ color: '#3572A5', ...style }} />;
        case 'java':
        case 'class':
        case 'jar':
            return <FontAwesomeIcon icon={faJava} className={className} style={{ color: '#b07219', ...style }} />;
        case 'php':
            return <FontAwesomeIcon icon={faPhp} className={className} style={{ color: '#4F5D95', ...style }} />;
        case 'rs':
            return <FontAwesomeIcon icon={faRust} className={className} style={{ color: '#dea584', ...style }} />;
        case 'go':
            return <FontAwesomeIcon icon={faCode} className={className} style={{ color: '#00ADD8', ...style }} />; // Go
        case 'c':
        case 'cpp':
        case 'h':
        case 'hpp':
        case 'cs':
            return <FontAwesomeIcon icon={faCode} className={className} style={{ color: '#178600', ...style }} />;

        // === 配置 & 数据 ===
        case 'json':
        case 'jsonc':
            return <FontAwesomeIcon icon={faCode} className={className} style={{ color: '#cbcb41', ...style }} />;
        case 'yaml':
        case 'yml':
        case 'toml':
            return <FontAwesomeIcon icon={faGear} className={className} style={{ color: '#cb171e', ...style }} />;
        case 'xml':
        case 'svg':
            return <FontAwesomeIcon icon={faCode} className={className} style={{ color: '#ff6600', ...style }} />;
        case 'sql':
        case 'db':
        case 'sqlite':
            return <FontAwesomeIcon icon={faDatabase} className={className} style={{ color: '#e38c00', ...style }} />;

        // === 文档 & 媒体 ===
        case 'md':
        case 'markdown':
            return <FontAwesomeIcon icon={faMarkdown} className={className} style={{ color: '#4daafc', ...style }} />;
        case 'png':
        case 'jpg':
        case 'jpeg':
        case 'gif':
        case 'webp':
        case 'ico':
            return <FontAwesomeIcon icon={faImage} className={className} style={{ color: '#a074c4', ...style }} />;
        case 'txt':
        case 'log':
        case 'csv':
            return <FontAwesomeIcon icon={faFileLines} className={className} style={{ color: '#888888', ...style }} />;
        case 'pdf':
            return <FontAwesomeIcon icon={faFilePdf} className={className} style={{ color: '#da3236', ...style }} />;

        // === 脚本 & 压缩包 ===
        case 'sh':
        case 'bash':
        case 'zsh':
        case 'bat':
        case 'cmd':
            return <FontAwesomeIcon icon={faTerminal} className={className} style={{ color: '#4d5a5e', ...style }} />;
        case 'zip':
        case 'tar':
        case 'gz':
        case 'rar':
        case '7z':
            return <FontAwesomeIcon icon={faFileZipper} className={className} style={{ color: '#f6b032', ...style }} />;

        // === 默认兜底 ===
        default:
            return <FontAwesomeIcon icon={faFile} className={className} style={{ color: 'var(--vscode-descriptionForeground)', ...style }} />;
    }
};

export default FileIcon;