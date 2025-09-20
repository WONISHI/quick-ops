import type { EnvConf, LogEnhancerConfig } from '../types/EnvConf';
import { generateUUID } from './index';
import formattedPath, { resetIsBasePath } from './formattedPath';
import { properties } from '../global-object/properties';
import dayjs from 'dayjs';

const envConf: Partial<EnvConf> | undefined = properties.pluginConfig ?? undefined;
const handlers: Record<string, () => any> = {
  uuid: () => {
    const len = [NaN, 0].includes(Number(moduleConfig.envConf!.uuidLen)) ? 12 : Number(moduleConfig.envConf!.uuidLen);
    return generateUUID(len);
  },
  line: () => `第${moduleConfig.line + 1}行`,
  icon: () => '🚀🚀🚀',
  // @ts-ignore
  $0: (code: string) => code,
  time: () => dayjs().format(moduleConfig.envConf!.unitTime![moduleConfig.key!] as string),
};

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
  const defaultEnvConf = properties.pluginConfig;
  const currentEnvConf = properties.settings;
  const template = (currentEnvConf as EnvConf)?.logEnhancerConfig[type] || (defaultEnvConf as EnvConf)?.logEnhancerConfig[type];
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

export function parseSnippet(codes: string[]): any[] | null {
  if (!codes || !codes.length) return null;
  const regexName = /(~\/|\^\/).*name/;
  if (!codes?.length) return null;
  return codes
    .map((code) => {
      if (regexName.test(code)) {
        const ids = code.split('/');
        let i = 0;
        let logName = '';
        while (i < ids.length) {
          logName = formattedPath(ids[i]).toString();
          i++;
        }
        resetIsBasePath();
        return logName.replace(/name/g, `${properties.fileName}文件`);
      }
      const target = handlers[code];
      // @ts-ignore
      return target ? target(code) : null;
    })
    .filter(Boolean); // 过滤掉 null
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
