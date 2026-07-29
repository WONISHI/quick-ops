export interface CommonCommandItem {
  label: string;
  icon: string;
  command: string;
}

export type ConsoleType = 'log' | 'info' | 'warn' | 'error';