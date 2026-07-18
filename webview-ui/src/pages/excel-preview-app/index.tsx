import { useEffect, useState } from 'react';
import * as XLSX from 'xlsx';
import { vscode } from '../../utils/vscode';
import styles from './index.module.css';
import { getColumnLetter } from "../../utils"

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
    return <div className={styles.loading}>正在解析表格数据...</div>;
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
