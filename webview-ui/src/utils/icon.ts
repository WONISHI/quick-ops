import type { IconDefinition } from '@fortawesome/fontawesome-svg-core';
import type { IconTuple } from '../types/AnchorApp';
import { escapeAttr } from './html';

export function getIconSvg(iconDef: IconDefinition, className: string = '') {
  const iconArray = iconDef.icon as unknown as IconTuple;
  const width = iconArray[0];
  const height = iconArray[1];
  const path = iconArray[4];

  const pathData = Array.isArray(path) ? path.join(' ') : path;

  return `<svg class="${escapeAttr(className)}" viewBox="0 0 ${width} ${height}" width="1em" height="1em" fill="currentColor"><path d="${escapeAttr(pathData)}"></path></svg>`;
}