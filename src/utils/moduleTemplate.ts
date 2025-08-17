import { getEnvConf } from '../global-object/envconfig';
import type { EnvConf, LogEnhancerConfig } from '../types/EnvConf';
import { generateUUID } from './index';
import { properties } from '../global-object/properties';
import * as vscode from 'vscode';

export const moduleConfig: {
  envConf: EnvConf | undefined;
  key: keyof Console | undefined;
  format: LogEnhancerConfig | undefined;
  character: number;
  line: number;
} = {
  envConf: undefined,
  key: undefined,
  format: undefined,
  character: 0,
  line: 0,
};

export function parseModuleTemplate(type: keyof Console): string[] {
  const [currentEnvConf, defaultEnvConf] = getEnvConf();
  const template = currentEnvConf.logEnhancerConfig[type] || defaultEnvConf.logEnhancerConfig[type];
  moduleConfig.envConf = currentEnvConf || defaultEnvConf;
  moduleConfig.key = type;
  moduleConfig.format = template;
  const regex = /\[([^\]]+)\]/g;
  const matches = [];
  let match;
  while ((match = regex.exec(template)) !== null) {
    matches.push(match[1]);
  }
  return matches;
}

export function parseSnippet(codes: string[]) {
  if (!codes || !codes.length) return null;
  const module: any[] = [];
  const editor = vscode.window.activeTextEditor;
  if (editor) {
    const cursorPosition = editor.selection.active;
    moduleConfig.character = cursorPosition.character;
    const lineNumber = cursorPosition.line;
    moduleConfig.line = lineNumber;
  }
  codes.map((code) => {
    switch (code) {
      case 'uuid':
        let len = [NaN, 0].includes(Number(moduleConfig.envConf!.uuidLen)) ? 12 : Number(moduleConfig.envConf!.uuidLen);
        let uuid = generateUUID(len);
        module.push(uuid);
        break;
      case 'line':
        module.push(`第${moduleConfig.line + 1}行`);
        break;
      case 'icon':
        module.push('🚀🚀🚀');
        break;
      case 'name':
        module.push(properties.fileName);
        break;
      case '$0':
        module.push(code);
      case 'time':
        break;
    }
  });
  return module;
}

export function getVisualColumn(text: string, tabSize = 4): number {
  let character = moduleConfig.character;
  let currentText = '';
  const regex = /^(.*)(?=,\s*'\$0')/;
  const match = text.match(regex);
  if (match) {
    currentText = match[0];
  }
  let col = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code === 9) {
      // \t
      const add = tabSize - (col % tabSize);
      col += add;
    } else if (code >= 0xd800 && code <= 0xdbff) {
      // 高位代理项，emoji 等，占 1 列
      col += 1;
      i++; // 跳过低位代理项
    } else {
      col += 1;
    }
  }
  moduleConfig.character += col * 1;
  return col; // 已经是 1-based 了; // VS Code 状态栏列号是 1-based
}
