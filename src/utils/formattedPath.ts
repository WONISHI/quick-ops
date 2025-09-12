import * as path from 'path';
import { properties } from '@/global-object/properties';
export default function formatPathBySign(sign: string) {
  let targetPath = '';
  const signHandlers: Record<string, () => string> = {
    '~': () => {
      targetPath = properties.fullPath;
      return targetPath;
    },
    '^': () => {
      targetPath = path.dirname(targetPath);
      return targetPath;
    },
  };
  return sign in signHandlers ? signHandlers[sign]() : sign;
}
