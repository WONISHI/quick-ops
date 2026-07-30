import { useEffect, useRef, useState } from 'react';
import styles from './index.module.css';
import TextCompareSkeleton from '@pages/text-compare-app/components/text-compare-skeleton';
import 'react-loading-skeleton/dist/skeleton.css';
import { vscode } from '@utils/vscode';
import { createDiffResult } from '@pages/text-compare-app/src/utils';
import type { DiffResult } from '@pages/text-compare-app/src/type';

export default function TextCompareApp() {
  /**
   * @description 是否正在等待 Extension Host 发送初始文本
   */
  const [initializing, setInitializing] = useState(true);

  const [original, setOriginal] = useState('');
  const [modified, setModified] = useState('');
  const [isWrap, setIsWrap] = useState(true);
  const [diffResult, setDiffResult] = useState<DiffResult | null>(null);

  const modifiedInputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const message = event.data;

      if (message.type === 'updateOriginal') {
        setOriginal(message.text || '');
        setDiffResult(null);
        setInitializing(false);
        modifiedInputRef.current?.focus();
      }
    };

    window.addEventListener('message', handleMessage);

    vscode?.postMessage({
      type: 'ready',
    });

    /**
     * Extension Host 未发送初始文本时，避免页面一直停留在骨架屏。
     */
    const initializingTimer = window.setTimeout(() => {
      setInitializing(false);
    }, 800);

    return () => {
      window.clearTimeout(initializingTimer);
      window.removeEventListener('message', handleMessage);
    };
  }, []);

  const canCompare = Boolean(original.trim()) && Boolean(modified.trim());

  /**
   * @description 执行文本差异对比
   */
  const handleCompare = () => {
    setDiffResult(createDiffResult(original, modified));
  };

  /**
   * @description 清空原文本
   */
  const handleClearOriginal = () => {
    setOriginal('');
    setDiffResult(null);
  };

  /**
   * @description 清空新文本
   */
  const handleClearModified = () => {
    setModified('');
    setDiffResult(null);
  };

  /**
   * @description 修改原文本并清理旧的对比结果
   */
  const handleOriginalChange = (value: string) => {
    setOriginal(value);
    setDiffResult(null);
  };

  /**
   * @description 修改新文本并清理旧的对比结果
   */
  const handleModifiedChange = (value: string) => {
    setModified(value);
    setDiffResult(null);
  };

  /**
   * @description 调用 VS Code 原生 Diff
   */
  const handleNativeDiff = () => {
    vscode?.postMessage({
      type: 'runDiff',
      original,
      modified,
    });
  };

  if (initializing) {
    return <TextCompareSkeleton />;
  }

  return (
    <div className={styles['compare-container']}>
      <div className={styles['compare-header']}>
        <h2>🔬 极速文本差异对比</h2>

        <div className={styles['action-group']}>
          <button className={styles.primary} disabled={!canCompare} onClick={handleCompare}>
            开始对比
          </button>

          <button disabled={!canCompare} title="在独立的编辑器 Tab 中进行左右对比" onClick={handleNativeDiff}>
            调用原生 Diff
          </button>
        </div>
      </div>

      <div className={styles.editors}>
        <div className={styles['editor-box']}>
          <label>
            <span>【原文本】(Original)</span>

            <button className={styles['clear-btn']} onClick={handleClearOriginal}>
              清空
            </button>
          </label>

          <textarea value={original} onChange={(event) => handleOriginalChange(event.target.value)} placeholder="在此粘贴原始链接、JSON 或代码..." />
        </div>

        <div className={styles['editor-box']}>
          <label>
            <span>【新文本】(Modified)</span>

            <button className={styles['clear-btn']} onClick={handleClearModified}>
              清空
            </button>
          </label>

          <textarea ref={modifiedInputRef} value={modified} onChange={(event) => handleModifiedChange(event.target.value)} placeholder="在此粘贴修改后的内容..." />
        </div>
      </div>

      <div className={styles['result-container']}>
        <div className={styles['result-header']}>
          <div className={styles['result-title-row']}>👇 边界保留与空位感知视图 (Boundary & Empty-Slot Preserved)</div>

          <div className={styles['result-tools-row']}>
            <span className={styles.legend}>
              <span className={`${styles['legend-box']} ${styles['legend-added']}`} />
              新增词块
            </span>

            <span className={styles.legend}>
              <span className={`${styles['legend-box']} ${styles['legend-removed']}`} />
              删除词块
            </span>

            <span className={styles.legend}>
              <span className={`${styles['legend-box']} ${styles['legend-modified']}`} />
              整体替换 / 链接修改
            </span>

            <label className={styles['wrap-toggle']} title="开启后长文本将自动换行显示，无需横向滚动">
              <input type="checkbox" checked={isWrap} onChange={(event) => setIsWrap(event.target.checked)} />
              自动换行 (Wrap)
            </label>
          </div>
        </div>

        <div className={styles['diff-wrapper']}>
          {!diffResult ? (
            <span className={styles['diff-empty']}>请同时输入原文本和新文本，点击右上角【开始对比】按钮...</span>
          ) : diffResult.error ? (
            <span className={styles['diff-error']}>渲染出错: {diffResult.error}</span>
          ) : (
            <div className={[styles['diff-content'], isWrap ? styles['is-wrapped'] : ''].filter(Boolean).join(' ')}>
              <div className={styles['diff-line-container']}>
                <div className={styles['diff-title']}>[- 原文]</div>

                <div
                  className={styles['diff-text']}
                  dangerouslySetInnerHTML={{
                    __html: diffResult.origHtml || '',
                  }}
                />
              </div>

              <hr className={styles['diff-divider']} />

              <div className={styles['diff-line-container']}>
                <div className={styles['diff-title']}>[+ 新文]</div>

                <div
                  className={styles['diff-text']}
                  dangerouslySetInnerHTML={{
                    __html: diffResult.modHtml || '',
                  }}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
