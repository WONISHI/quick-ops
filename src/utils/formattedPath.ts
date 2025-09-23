import * as path from 'path';
import { properties } from '../global-object/properties';

let targetPath = '';
let isBasePath = '';

function cutPathBeforeSegment(fullPath: string, segment: string) {
  const regex = new RegExp(`(.*)\\\\${segment}.*`);
  return fullPath.replace(regex, '$1');
}

export default function formatPathBySign(sign: string) {
  const signHandlers: Record<string, () => string> = {
    '~': () => {
      targetPath = properties.fullPath;
      return targetPath;
    },
    '^': () => {
      if (isBasePath) {
        targetPath = cutPathBeforeSegment(properties.fullPath, isBasePath);
      } else {
        targetPath = path.basename(targetPath);
      }
      isBasePath = path.basename(targetPath);
      return isBasePath;
    },
    '@': () => properties.settings?.alias?.path['@/'] ?? '',
  };
  return sign in signHandlers ? signHandlers[sign]() : isBasePath ? isBasePath + '//' + sign : targetPath + '//' + sign;
}

export function resetIsBasePath() {
  isBasePath = '';
}
