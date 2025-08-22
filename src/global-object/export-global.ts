import type { ExportResult, ExportItem } from '../utils/parse';
import type { FileType } from '../types/utils';

export interface ExportGlobalVariables extends ExportResult {
  activeLine: number;
  isDefaultName: boolean;
  isName: boolean;
  fileType: FileType | undefined;
  selectExports: ExportItem;
  filterDefaultExports: () => ExportItem;
  filterNamedExports: () => ExportItem;
}

export const exportGlobalVariables: ExportGlobalVariables = {
  // 是否有默认导出
  activeLine: -1,
  isDefaultName: false,
  isName: false,
  namedExports: [],
  defaultExport: [],
  selectExports: [],
  fileType: undefined,
  filterDefaultExports: function () {
    let { defaultExport, selectExports } = this;
    return defaultExport.filter((fn) => !selectExports.includes(fn));
  },
  filterNamedExports: function () {
    let { namedExports, selectExports } = this;
    return namedExports.filter((fn) => !selectExports.includes(fn));
  }
};

export function setExportGlobalVariables(variables: Partial<ExportGlobalVariables>) {
  Object.assign(exportGlobalVariables, variables);
}
