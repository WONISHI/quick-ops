import * as Diff from 'diff';
import styles from './index.module.css';
import type { DiffResult } from '@pages/text-compare-app/src/type';

const EMPTY_TOKEN = '___EMPTY_SLOT___';


/**
 * @description 对文本进行分词
 */
function tokenize(text: string): string[] {
  if (!text) return [];

  const regex = /(https?:\/\/[^?&,。=;\s]+|[,?&.。=:;\s])/;
  const rawTokens = text.split(regex);

  return rawTokens.map((token) => (token === '' ? EMPTY_TOKEN : token));
}

/**
 * @description 判断文本是否为 HTTP 地址
 */
function isUrl(value: string): boolean {
  return value.startsWith('http://') || value.startsWith('https://');
}

/**
 * @description 转义 HTML，防止差异文本产生 XSS
 */
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

/**
 * @description 创建差异展示标签
 */
function createSpanStr(text: string, className?: string): string {
  if (!className) {
    return escapeHtml(text);
  }

  return `<span class="${className}">${escapeHtml(text)}</span>`;
}

/**
 * @description 处理相邻的删除块和新增块
 */
function renderModificationStr(removedTokens: string[], addedTokens: string[], originalHtmlList: string[], modifiedHtmlList: string[]): void {
  const maxLen = Math.max(removedTokens.length, addedTokens.length);

  for (let i = 0; i < maxLen; i++) {
    let oldToken = i < removedTokens.length ? removedTokens[i] : null;

    let newToken = i < addedTokens.length ? addedTokens[i] : null;

    if (oldToken === EMPTY_TOKEN) {
      oldToken = '';
    }

    if (newToken === EMPTY_TOKEN) {
      newToken = '';
    }

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

              return;
            }

            if (charPart.removed) {
              originalHtmlList.push(createSpanStr(charPart.value, styles['diff-modified-del']));

              modifiedHtmlList.push(createSpanStr(charPart.value, styles.placeholder));

              return;
            }

            originalHtmlList.push(createSpanStr(charPart.value, styles['diff-modified-base']));

            modifiedHtmlList.push(createSpanStr(charPart.value, styles['diff-modified-base']));
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

/**
 * @description 计算两个文本之间的差异
 */
export function createDiffResult(original: string, modified: string): DiffResult | null {
  if (!original.trim() || !modified.trim()) {
    return null;
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

      if (part.removed && nextPart?.added) {
        renderModificationStr(part.value, nextPart.value, originalHtmlList, modifiedHtmlList);

        i++;
        continue;
      }

      if (part.added && nextPart?.removed) {
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

    return {
      origHtml: originalHtmlList.join(''),
      modHtml: modifiedHtmlList.join(''),
    };
  } catch (error: unknown) {
    return {
      origHtml: '',
      modHtml: '',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}