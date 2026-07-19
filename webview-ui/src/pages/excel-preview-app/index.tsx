import { useEffect, useState } from 'react';
import * as XLSX from 'xlsx';
import Skeleton, { SkeletonTheme } from 'react-loading-skeleton';
import 'react-loading-skeleton/dist/skeleton.css';
import { vscode } from '../../utils/vscode';
import styles from './index.module.css';
import { getColumnLetter } from '../../utils';

/**
 * @description Excel 表格加载骨架屏
 */
function ExcelPreviewSkeleton() {
  const columns = Array.from({ length: 8 });
  const rows = Array.from({ length: 16 });

  return (
    <SkeletonTheme
      baseColor="var(--vscode-list-inactiveSelectionBackground, rgba(127, 127, 127, 0.12))"
      highlightColor="var(--vscode-list-hoverBackground, rgba(127, 127, 127, 0.2))"
      borderRadius={3}
      duration={1.35}
    >
      <div className={styles.container}>
        <div className={styles['skeleton-table-container']}>
          <div className={styles['skeleton-table']}>
            <div className={styles['skeleton-corner']} />

            {columns.map((_, columnIndex) => (
              <div key={`skeleton-column-${columnIndex}`} className={styles['skeleton-column-header']}>
                <Skeleton width={18} height={10} />
              </div>
            ))}

            {rows.map((_, rowIndex) => (
              <div key={`skeleton-row-${rowIndex}`} className={styles['skeleton-row']}>
                <div className={styles['skeleton-row-header']}>
                  <Skeleton width={16} height={10} />
                </div>

                {columns.map((_, columnIndex) => (
                  <div key={`skeleton-cell-${rowIndex}-${columnIndex}`} className={styles['skeleton-cell']}>
                    <Skeleton width={`${58 + ((rowIndex + columnIndex) % 4) * 9}%`} height={10} />
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>

        <div className={styles['skeleton-sheet-tabs']}>
          <Skeleton width={72} height={18} />
          <Skeleton width={84} height={18} />
          <Skeleton width={64} height={18} />
        </div>
      </div>
    </SkeletonTheme>
  );
}

export default function ExcelPreviewApp() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [, setFileName] = useState('');
  const [workbook, setWorkbook] = useState<XLSX.WorkBook | null>(null);
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [activeSheet, setActiveSheet] = useState<string>('');
  const [sheetData, setSheetData] = useState<any[][]>([]);
  const [maxCols, setMaxCols] = useState<number>(0);

  const loadSheetData = (wb: XLSX.WorkBook, sheetName: string) => {
    const ws = wb.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, defval: '' });
    const maxColumnCount = data.reduce((max, row) => Math.max(max, row.length), 0);
    setSheetData(data);
    setMaxCols(maxColumnCount);
    setActiveSheet(sheetName);
  };

  useEffect(() => {
    const handleMessage = (e: MessageEvent) => {
      const msg = e.data;
      if (msg.type === 'initExcelData') {
        try {
          setFileName(msg.fileName);
          const wb = XLSX.read(msg.contentBase64, { type: 'base64' });
          setWorkbook(wb);
          setSheetNames(wb.SheetNames);
          if (wb.SheetNames.length > 0) {
            loadSheetData(wb, wb.SheetNames[0]);
          }
          setLoading(false);
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
        } catch (err) {
          setError('解析表格文件失败，可能是文件已损坏或格式不受支持。');
          setLoading(false);
        }
      }
    };

    window.addEventListener('message', handleMessage);
    vscode.postMessage({ command: 'webviewLoaded' });
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const handleSheetSwitch = (sheetName: string) => {
    if (workbook && sheetName !== activeSheet) {
      loadSheetData(workbook, sheetName);
    }
  };

  if (loading) {
    return <ExcelPreviewSkeleton />;
  }

  if (error) {
    return <div className={styles.error}>{error}</div>;
  }

  const columnHeaders = Array.from({ length: maxCols }, (_, i) => getColumnLetter(i));

  return (
    <div className={styles.container}>
      <div className={styles.tableContainer}>
        {sheetData.length === 0 ? (
          <div className={styles.loading}>当前工作表为空</div>
        ) : (
          <table className={styles.excelTable}>
            <thead>
              <tr>
                <th className={styles.cornerHeader}></th>
                {columnHeaders.map((colText) => (
                  <th key={`col-head-${colText}`} className={styles.colHeader}>
                    {colText}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {/* 渲染数据行 */}
              {sheetData.map((row, rowIndex) => (
                <tr key={`row-${rowIndex}`}>
                  <td className={styles.rowHeader}>{rowIndex + 1}</td>
                  {columnHeaders.map((_, colIndex) => {
                    const cellValue = row[colIndex] !== undefined ? row[colIndex] : '';
                    return (
                      <td key={`cell-${rowIndex}-${colIndex}`} title={String(cellValue)}>
                        {cellValue}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* 底部工作表切换区 */}
      {sheetNames.length > 0 && (
        <div className={styles.sheetTabs}>
          {sheetNames.map((name) => (
            <div key={name} className={`${styles.sheetTab} ${name === activeSheet ? styles.active : ''}`} onClick={() => handleSheetSwitch(name)}>
              {name}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
