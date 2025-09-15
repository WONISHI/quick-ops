import * as path from 'path';
import { properties } from '../global-object/properties';

let targetPath = '';
let isBasePath = false;

function cutPathBeforeSegment(fullPath: string, segment: string) {
  const regex = new RegExp(`(.*)\\\\${segment}.*`);
  return fullPath.replace(regex, '$1');
}

export default function formatPathBySign(sign: string) {
  const signHandlers: Record<string, () => string> = {
    '~': () => {
      targetPath = properties.fullPath;
      isBasePath = true;
      return targetPath;
    },
    '^': () => {
      if (isBasePath) {
        targetPath = path.basename(targetPath);
      } else {
        targetPath = cutPathBeforeSegment(properties.fullPath, targetPath);
        console.log('999999','targetPath');
      }
      isBasePath = false;
      return path.basename(targetPath);
    },
  };
  return sign in signHandlers ? signHandlers[sign]() : targetPath + '/' + sign;
}
