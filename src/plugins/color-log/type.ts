export type ColorLogType = 'black' | 'orange' | 'red' | 'green';

export interface ModuleInstanceLike {
  id?: string;
  constructor?: {
    name?: string;
  };
}

export const COLOR_LOG_STYLE_MAP: Record<ColorLogType, string> = {
  black: 'background: #1f1f1f;',
  orange: 'background: #f59e0b;',
  red: 'background: #ef4444;',
  green: 'background: #22c55e;',
};
