import React, { useMemo } from 'react';

import fileIcon from 'material-icon-theme/icons/file.svg';
import npmIcon from 'material-icon-theme/icons/npm.svg';
import yarnIcon from 'material-icon-theme/icons/yarn.svg';
import dockerIcon from 'material-icon-theme/icons/docker.svg';
import gitIcon from 'material-icon-theme/icons/git.svg';
import eslintIcon from 'material-icon-theme/icons/eslint.svg';
import prettierIcon from 'material-icon-theme/icons/prettier.svg';
import editorconfigIcon from 'material-icon-theme/icons/editorconfig.svg';
import tsconfigIcon from 'material-icon-theme/icons/tsconfig.svg';
import typescriptIcon from 'material-icon-theme/icons/typescript.svg';
import reactTsIcon from 'material-icon-theme/icons/react_ts.svg';
import javascriptIcon from 'material-icon-theme/icons/javascript.svg';
import reactIcon from 'material-icon-theme/icons/react.svg';
import vueIcon from 'material-icon-theme/icons/vue.svg';
import cssIcon from 'material-icon-theme/icons/css.svg';
import lessIcon from 'material-icon-theme/icons/less.svg';
import sassIcon from 'material-icon-theme/icons/sass.svg';
import htmlIcon from 'material-icon-theme/icons/html.svg';
import pythonIcon from 'material-icon-theme/icons/python.svg';
import javaIcon from 'material-icon-theme/icons/java.svg';
import javaclassIcon from 'material-icon-theme/icons/javaclass.svg';
import jarIcon from 'material-icon-theme/icons/jar.svg';
import phpIcon from 'material-icon-theme/icons/php.svg';
import rustIcon from 'material-icon-theme/icons/rust.svg';
import goIcon from 'material-icon-theme/icons/go.svg';
import cIcon from 'material-icon-theme/icons/c.svg';
import cppIcon from 'material-icon-theme/icons/cpp.svg';
import hIcon from 'material-icon-theme/icons/h.svg';
import hppIcon from 'material-icon-theme/icons/hpp.svg';
import csharpIcon from 'material-icon-theme/icons/csharp.svg';
import jsonIcon from 'material-icon-theme/icons/json.svg';
import yamlIcon from 'material-icon-theme/icons/yaml.svg';
import tomlIcon from 'material-icon-theme/icons/toml.svg';
import xmlIcon from 'material-icon-theme/icons/xml.svg';
import svgIcon from 'material-icon-theme/icons/svg.svg';
import databaseIcon from 'material-icon-theme/icons/database.svg';
import markdownIcon from 'material-icon-theme/icons/markdown.svg';
import imageIcon from 'material-icon-theme/icons/image.svg';
import documentIcon from 'material-icon-theme/icons/document.svg';
import logIcon from 'material-icon-theme/icons/log.svg';
import tableIcon from 'material-icon-theme/icons/table.svg';
import pdfIcon from 'material-icon-theme/icons/pdf.svg';
import consoleIcon from 'material-icon-theme/icons/console.svg';
import zipIcon from 'material-icon-theme/icons/zip.svg';


const EXACT_NAMES: Record<string, string> = {
    'package.json': npmIcon,
    'yarn.lock': yarnIcon,
    '.yarnrc': yarnIcon,
    '.yarnrc.yml': yarnIcon,
    'dockerfile': dockerIcon,
    'docker-compose.yml': dockerIcon,
    '.dockerignore': dockerIcon,
    '.gitignore': gitIcon,
    '.gitattributes': gitIcon,
    '.gitmodules': gitIcon,
    '.eslintrc.js': eslintIcon,
    '.eslintrc.json': eslintIcon,
    'eslint.config.js': eslintIcon,
    '.prettierrc': prettierIcon,
    '.editorconfig': editorconfigIcon,
    'tsconfig.json': tsconfigIcon,
};

const EXTENSIONS: Record<string, string> = {
    'ts': typescriptIcon,
    'tsx': reactTsIcon,
    'js': javascriptIcon,
    'jsx': reactIcon,
    'cjs': javascriptIcon,
    'mjs': javascriptIcon,
    'vue': vueIcon,
    'css': cssIcon,
    'less': lessIcon,
    'scss': sassIcon,
    'sass': sassIcon,
    'html': htmlIcon,
    'htm': htmlIcon,
    'py': pythonIcon,
    'pyw': pythonIcon,
    'java': javaIcon,
    'class': javaclassIcon,
    'jar': jarIcon,
    'php': phpIcon,
    'rs': rustIcon,
    'go': goIcon,
    'c': cIcon,
    'cpp': cppIcon,
    'h': hIcon,
    'hpp': hppIcon,
    'cs': csharpIcon,
    'json': jsonIcon,
    'jsonc': jsonIcon,
    'yaml': yamlIcon,
    'yml': yamlIcon,
    'toml': tomlIcon,
    'xml': xmlIcon,
    'svg': svgIcon,
    'sql': databaseIcon,
    'db': databaseIcon,
    'sqlite': databaseIcon,
    'md': markdownIcon,
    'markdown': markdownIcon,
    'png': imageIcon,
    'jpg': imageIcon,
    'jpeg': imageIcon,
    'gif': imageIcon,
    'webp': imageIcon,
    'ico': imageIcon,
    'txt': documentIcon,
    'log': logIcon,
    'csv': tableIcon,
    'pdf': pdfIcon,
    'sh': consoleIcon,
    'bash': consoleIcon,
    'zsh': consoleIcon,
    'bat': consoleIcon,
    'cmd': consoleIcon,
    'zip': zipIcon,
    'tar': zipIcon,
    'gz': zipIcon,
    'rar': zipIcon,
    '7z': zipIcon,
};

interface FileIconProps {
    fileName: string;
    className?: string;
    style?: React.CSSProperties;
}

export const FileIcon: React.FC<FileIconProps> = ({ fileName, className, style }) => {
    const finalUrl = useMemo(() => {
        const lowerName = fileName.toLowerCase();
        
        if (EXACT_NAMES[lowerName]) {
            return EXACT_NAMES[lowerName];
        }

        const ext = lowerName.split('.').pop() || '';
        if (EXTENSIONS[ext]) {
            return EXTENSIONS[ext];
        }

        return fileIcon; // 默认兜底
    }, [fileName]);

    return (
        <img 
            src={finalUrl} 
            alt="file icon" 
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