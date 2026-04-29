import { useEffect, useState } from 'react';
import * as XLSX from 'xlsx';
import { vscode } from '../utils/vscode';
import styles from '../assets/css/ExcelPreviewApp.module.css';


function getColumnLetter(n: number): string {
  let name = '';
  while (n >= 0) {
    name = String.fromCharCode((n % 26) + 65) + name;
    n = Math.floor(n / 26) - 1;
  }
  return name;
}

export default function ExcelPreviewApp() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [, setFileName] = useState('');
  
  // 缓存整个工作簿实例
  const [workbook, setWorkbook] = useState<XLSX.WorkBook | null>(null);
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [activeSheet, setActiveSheet] = useState<string>('');
  
  // 当前工作表的二维数组数据
  const [sheetData, setSheetData] = useState<any[][]>([]);
  // 当前表格的最大列数
  const [maxCols, setMaxCols] = useState<number>(0);

  useEffect(() => {
    // 监听来自 Extension 的数据
    const handleMessage = (e: MessageEvent) => {
      const msg = e.data;
      if (msg.type === 'initExcelData') {
        try {
          setFileName(msg.fileName);
          
          // 使用 base64 解析工作簿
          const wb = XLSX.read(msg.contentBase64, { type: 'base64' });
          setWorkbook(wb);
          setSheetNames(wb.SheetNames);
          
          if (wb.SheetNames.length > 0) {
            loadSheetData(wb, wb.SheetNames[0]);
          }
          
          setLoading(false);
        } catch (err) {
          setError('解析表格文件失败，可能是文件已损坏或格式不受支持。');
          setLoading(false);
        }
      }
    };

    window.addEventListener('message', handleMessage);
    
    // 通知后端 Webview 已经准备好接收数据
    vscode.postMessage({ command: 'webviewLoaded' });

    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const loadSheetData = (wb: XLSX.WorkBook, sheetName: string) => {
    const ws = wb.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, defval: '' });
    
    const maxColumnCount = data.reduce((max:number, row) => Math.max(max, row.length), 0);
    
    setSheetData(data);
    setMaxCols(maxColumnCount);
    setActiveSheet(sheetName);
  };

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

  // 生成 A, B, C... 列头数组
  const columnHeaders = Array.from({ length: maxCols }, (_, i) => getColumnLetter(i));

  return (
    <div className={styles.container}>
      {/* 顶部表格数据区 */}
      <div className={styles.tableContainer}>
        {sheetData.length === 0 ? (
          <div className={styles.loading}>当前工作表为空</div>
        ) : (
          <table className={styles.excelTable}>
            <thead>
              <tr>
                {/* 左上角空白占位格 */}
                <th className={styles.cornerHeader}></th>
                {/* 渲染列头 A, B, C ... */}
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
                  {/* 渲染行头 1, 2, 3 ... */}
                  <td className={styles.rowHeader}>{rowIndex + 1}</td>
                  
                  {/* 根据最大列数补齐单元格，防止有些行长度不够 */}
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
            <div
              key={name}
              className={`${styles.sheetTab} ${name === activeSheet ? styles.active : ''}`}
              onClick={() => handleSheetSwitch(name)}
            >
              {name}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}