import type { ExportResult, ExportItem } from '../utils/parse';

export interface ExportGlobalVariables extends ExportResult {
  activeLine: number;
  isDefaultName: boolean;
  isName: boolean;
  selectExports: ExportItem;
}

export const exportGlobalVariables: ExportGlobalVariables = {
  // 是否有默认导出
  activeLine: -1,
  isDefaultName: false,
  isName: false,
  namedExports: [],
  defaultExport: [],
  selectExports: [],
};

export function setExportGlobalVariables(variables: Partial<ExportGlobalVariables>) {
  Object.assign(exportGlobalVariables, variables);
}
