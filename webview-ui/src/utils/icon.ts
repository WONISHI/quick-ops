import type { IconDefinition } from '@fortawesome/fontawesome-svg-core';
import { escapeAttr } from '@utils/html';

export function getIconSvg(iconDef: IconDefinition, className: string = '') {
  const iconArray = iconDef.icon as any;
  const width = iconArray[0];
  const height = iconArray[1];
  const path = iconArray[4];

  const pathData = Array.isArray(path) ? path.join(' ') : path;

  return `<svg class="${escapeAttr(className)}" viewBox="0 0 ${width} ${height}" width="1em" height="1em" fill="currentColor"><path d="${escapeAttr(pathData)}"></path></svg>`;
}