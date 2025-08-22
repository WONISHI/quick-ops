import type { ExportResult } from '../utils/parse';

export interface ExportGlobalVariables extends ExportResult {
  isDefaultName: boolean;
  isName: boolean;
}

export const exportGlobalVariables: ExportGlobalVariables = {
  // 是否有默认导出
  isDefaultName: false,
  isName: false,
  namedExports: [],
  defaultExport: [],
};

export function setExportGlobalVariables(variables: Partial<ExportGlobalVariables>) {
  Object.assign(exportGlobalVariables, variables);
}
