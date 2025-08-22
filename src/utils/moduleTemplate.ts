import { getEnvConf } from '../global-object/envconfig';
import type { EnvConf, LogEnhancerConfig } from '../types/EnvConf';
import { generateUUID } from './index';
import { properties } from '../global-object/properties';
import dayjs from 'dayjs';

const envConf: Partial<EnvConf> | undefined = getEnvConf() ?? undefined;

export const moduleConfig: {
  envConf: Partial<EnvConf> | undefined | null;
  key: keyof Console | undefined;
  format: LogEnhancerConfig | undefined;
  character: number;
  line: number;
} = {
  envConf: envConf as Partial<EnvConf> | undefined,
  key: undefined,
  format: undefined,
  character: 0,
  line: 0,
};

export function parseModuleTemplate(type: keyof Console): string[] {
  const [currentEnvConf, defaultEnvConf] = getEnvConf();
  const template = (currentEnvConf as EnvConf).logEnhancerConfig[type] || (defaultEnvConf as EnvConf).logEnhancerConfig[type];
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
        module.push(`${properties.fileName}文件`);
        break;
      case '$0':
        module.push(code);
        break;
      case 'time':
        module.push(`${dayjs().format(moduleConfig.envConf!.unitTime![moduleConfig.key!] as string)}`);
        break;
    }
  });
  return module;
}

export function getVisualColumn(text: string, tabSize = 4): number {
  let currentText = '';
  const regex = /^(.*)(?=,\s*'\$0')/;
  const match = text.match(regex);
  if (match) {
    currentText = match[0];
  }
  let col = 0;
  for (let i = 0; i < currentText.length; i++) {
    const code = currentText.charCodeAt(i);
    if (code === 9) {
      const add = tabSize - (col % tabSize);
      col += add;
    } else if (code >= 0xd800 && code <= 0xdbff) {
      col += 2;
      i++;
    } else {
      col += 1;
    }
  }
  moduleConfig.character += col;
  return col;
}
