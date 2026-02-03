export interface ExportItem {
  name: string;
  code?: string;
}

export interface ParseResult {
  namedExports: ExportItem[];
  defaultExport: string[];
}

export interface ExportState {
  namedExports: ExportItem[];
  defaultExport: string[];
  selectedExports: string[];
}
