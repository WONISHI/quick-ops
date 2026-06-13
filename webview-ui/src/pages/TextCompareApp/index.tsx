import { useEffect, useRef, useState } from 'react';
import * as Diff from 'diff';
import { vscode } from '../../utils/vscode';
import styles from './index.module.css';

const EMPTY_TOKEN = '___EMPTY_SLOT___';

/** 核心算法：分词器 */
function tokenize(text: string): string[] {
  if (!text) return [];

  const regex = /(https?:\/\/[^\?&,。=;\s]+|[,\?&\.。\=:;\s])/;
  const rawTokens = text.split(regex);

  return rawTokens.map((token) => (token === '' ? EMPTY_TOKEN : token));
}

function isUrl(value: string): boolean {
  return value.startsWith('http://') || value.startsWith('https://');
}

/** HTML 转义防止 XSS */
function escapeHtml(unsafe: string): string {
  return (unsafe || '').replace(/[&<"']/g, (matched) => {
    switch (matched) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '"':
        return '&quot;';
      case "'":
        return '&#039;';
      default:
        return matched;
    }
  });
}

function createSpanStr(text: string, className?: string): string {
  if (!className) {
    return escapeHtml(text);
  }

  return `<span class="${className}">${escapeHtml(text)}</span>`;
}

/** 核心算法：差异块处理 */
function renderModificationStr(
  removedTokens: string[],
  addedTokens: string[],
  originalHtmlList: string[],
  modifiedHtmlList: string[]
) {
  const maxLen = Math.max(removedTokens.length, addedTokens.length);

  for (let i = 0; i < maxLen; i++) {
    let oldToken = i < removedTokens.length ? removedTokens[i] : null;
    let newToken = i < addedTokens.length ? addedTokens[i] : null;

    if (oldToken === EMPTY_TOKEN) oldToken = '';
    if (newToken === EMPTY_TOKEN) newToken = '';

    if (oldToken !== null && newToken !== null) {
      if (oldToken === '' && newToken !== '') {
        originalHtmlList.push(createSpanStr(newToken, styles.placeholder));
        modifiedHtmlList.push(createSpanStr(newToken, styles['diff-added']));
        continue;
      }

      if (oldToken !== '' && newToken === '') {
        originalHtmlList.push(createSpanStr(oldToken, styles['diff-removed']));
        modifiedHtmlList.push(createSpanStr(oldToken, styles.placeholder));
        continue;
      }

      if (oldToken !== '' && newToken !== '') {
        if (isUrl(oldToken) && isUrl(newToken)) {
          const charDiffs = Diff.diffChars(oldToken, newToken);

          charDiffs.forEach((charPart) => {
            if (charPart.added) {
              originalHtmlList.push(createSpanStr(charPart.value, styles.placeholder));
              modifiedHtmlList.push(createSpanStr(charPart.value, styles['diff-modified-add']));
            } else if (charPart.removed) {
              originalHtmlList.push(createSpanStr(charPart.value, styles['diff-modified-del']));
              modifiedHtmlList.push(createSpanStr(charPart.value, styles.placeholder));
            } else {
              originalHtmlList.push(createSpanStr(charPart.value, styles['diff-modified-base']));
              modifiedHtmlList.push(createSpanStr(charPart.value, styles['diff-modified-base']));
            }
          });
        } else {
          originalHtmlList.push(createSpanStr(oldToken, styles['diff-modified-del']));
          modifiedHtmlList.push(createSpanStr(newToken, styles['diff-modified-add']));
        }

        continue;
      }

      originalHtmlList.push(createSpanStr('', ''));
      modifiedHtmlList.push(createSpanStr('', ''));
      continue;
    }

    if (oldToken !== null && oldToken !== '') {
      originalHtmlList.push(createSpanStr(oldToken, styles['diff-removed']));
      modifiedHtmlList.push(createSpanStr(oldToken, styles.placeholder));
      continue;
    }

    if (newToken !== null && newToken !== '') {
      originalHtmlList.push(createSpanStr(newToken, styles.placeholder));
      modifiedHtmlList.push(createSpanStr(newToken, styles['diff-added']));
    }
  }
}

export default function TextCompareApp() {
  const [original, setOriginal] = useState('');
  const [modified, setModified] = useState('');
  const [isWrap, setIsWrap] = useState(true);
  const [triggerDiff, setTriggerDiff] = useState(0);
  const [diffResult, setDiffResult] = useState<{
    origHtml: string;
    modHtml: string;
    error?: string;
  } | null>(null);

  const modifiedInputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const message = event.data;

      if (message.type === 'updateOriginal') {
        setOriginal(message.text);
        modifiedInputRef.current?.focus();
      }
    };

    window.addEventListener('message', handleMessage);

    vscode?.postMessage({ type: 'ready' });

    return () => {
      window.removeEventListener('message', handleMessage);
    };
  }, []);

  useEffect(() => {
    if (!original.trim() || !modified.trim()) {
      setDiffResult(null);
      return;
    }

    try {
      const originalTokens = tokenize(original);
      const modifiedTokens = tokenize(modified);
      const diffs = Diff.diffArrays(originalTokens, modifiedTokens);

      const originalHtmlList: string[] = [];
      const modifiedHtmlList: string[] = [];

      for (let i = 0; i < diffs.length; i++) {
        const part = diffs[i];
        const nextPart = diffs[i + 1];

        if (part.removed && nextPart && nextPart.added) {
          renderModificationStr(part.value, nextPart.value, originalHtmlList, modifiedHtmlList);
          i++;
          continue;
        }

        if (part.added && nextPart && nextPart.removed) {
          renderModificationStr(nextPart.value, part.value, originalHtmlList, modifiedHtmlList);
          i++;
          continue;
        }

        part.value.forEach((token) => {
          const value = token === EMPTY_TOKEN ? '' : token;

          if (!value) return;

          if (part.added) {
            originalHtmlList.push(createSpanStr(value, styles.placeholder));
            modifiedHtmlList.push(createSpanStr(value, styles['diff-added']));
            return;
          }

          if (part.removed) {
            originalHtmlList.push(createSpanStr(value, styles['diff-removed']));
            modifiedHtmlList.push(createSpanStr(value, styles.placeholder));
            return;
          }

          originalHtmlList.push(createSpanStr(value, styles['diff-base']));
          modifiedHtmlList.push(createSpanStr(value, styles['diff-base']));
        });
      }

      setDiffResult({
        origHtml: originalHtmlList.join(''),
        modHtml: modifiedHtmlList.join(''),
      });
    } catch (error: any) {
      setDiffResult({
        origHtml: '',
        modHtml: '',
        error: error?.message || String(error),
      });
    }
  }, [original, modified, triggerDiff]);

  const handleNativeDiff = () => {
    vscode?.postMessage({
      type: 'runDiff',
      original,
      modified,
    });
  };

  const canCompare = !!original.trim() && !!modified.trim();

  return (
    <div className={styles['compare-container']}>
      <div className={styles['compare-header']}>
        <h2>🔬 极速文本差异对比</h2>

        <div className={styles['action-group']}>
          <button
            className={styles.primary}
            disabled={!canCompare}
            onClick={() => setTriggerDiff((prev) => prev + 1)}
          >
            开始对比
          </button>

          <button
            title="最大化/还原当前对比窗口"
            onClick={() => vscode?.postMessage({ type: 'toggleFullScreen' })}
          >
            ⛶ 切换全屏
          </button>

          <button
            disabled={!canCompare}
            title="在独立的编辑器 Tab 中进行左右对比"
            onClick={handleNativeDiff}
          >
            调用原生 Diff
          </button>
        </div>
      </div>

      <div className={styles.editors}>
        <div className={styles['editor-box']}>
          <label>
            <span>【原文本】(Original)</span>
            <button
              className={styles['clear-btn']}
              onClick={() => setOriginal('')}
            >
              清空
            </button>
          </label>

          <textarea
            value={original}
            onChange={(event) => setOriginal(event.target.value)}
            placeholder="在此粘贴原始链接、JSON 或代码..."
          />
        </div>

        <div className={styles['editor-box']}>
          <label>
            <span>【新文本】(Modified)</span>
            <button
              className={styles['clear-btn']}
              onClick={() => setModified('')}
            >
              清空
            </button>
          </label>

          <textarea
            ref={modifiedInputRef}
            value={modified}
            onChange={(event) => setModified(event.target.value)}
            placeholder="在此粘贴修改后的内容..."
          />
        </div>
      </div>

      <div className={styles['result-container']}>
        <div className={styles['result-header']}>
          <div className={styles['result-title-row']}>
            👇 边界保留与空位感知视图 (Boundary & Empty-Slot Preserved)
          </div>

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

            <label
              className={styles['wrap-toggle']}
              title="开启后长文本将自动换行显示，无需横向滚动"
            >
              <input
                type="checkbox"
                checked={isWrap}
                onChange={(event) => setIsWrap(event.target.checked)}
              />
              自动换行 (Wrap)
            </label>
          </div>
        </div>

        <div className={styles['diff-wrapper']}>
          {!diffResult ? (
            <span className={styles['diff-empty']}>
              请同时输入原文本和新文本，点击右上角【开始对比】按钮...
            </span>
          ) : diffResult.error ? (
            <span className={styles['diff-error']}>渲染出错: {diffResult.error}</span>
          ) : (
            <div
              className={[
                styles['diff-content'],
                isWrap ? styles['is-wrapped'] : '',
              ].filter(Boolean).join(' ')}
            >
              <div className={styles['diff-line-container']}>
                <div className={styles['diff-title']}>[- 原文]</div>
                <div
                  className={styles['diff-text']}
                  dangerouslySetInnerHTML={{ __html: diffResult.origHtml || '' }}
                />
              </div>

              <hr className={styles['diff-divider']} />

              <div className={styles['diff-line-container']}>
                <div className={styles['diff-title']}>[+ 新文]</div>
                <div
                  className={styles['diff-text']}
                  dangerouslySetInnerHTML={{ __html: diffResult.modHtml || '' }}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
