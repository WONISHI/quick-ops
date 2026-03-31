import { useState, useEffect, useMemo } from 'react';
import * as Diff from 'diff';
import '../assets/css/TextCompareApp.css'
import { vscode } from '../utils/vscode';

const EMPTY_TOKEN = "___EMPTY_SLOT___";

/** 🌟 核心算法：分词器 */
function tokenize(text: string): string[] {
    if (!text) return [];
    const regex = /(https?:\/\/[^\?&,。=;\s]+|[,\?&\.。\=:;\s])/;
    const rawTokens = text.split(regex);
    return rawTokens.map(t => t === "" ? EMPTY_TOKEN : t);
}

function isUrl(str: string): boolean {
    return str.startsWith('http://') || str.startsWith('https://');
}

/** 🌟 性能优化：HTML 转义防止 XSS */
function escapeHtml(unsafe: string): string {
    return (unsafe || '').replace(/[&<"']/g, (m) => {
        switch (m) {
            case '&': return '&amp;';
            case '<': return '&lt;';
            case '"': return '&quot;';
            case "'": return '&#039;';
            default: return m;
        }
    });
}

function createSpanStr(text: string, className: string): string {
    return `<span class="${className}">${escapeHtml(text)}</span>`;
}

/** 🌟 核心算法：差异块处理 */
function renderModificationStr(removedTokens: string[], addedTokens: string[], origArr: string[], modArr: string[]) {
    const maxLen = Math.max(removedTokens.length, addedTokens.length);

    for (let i = 0; i < maxLen; i++) {
        let oldT = i < removedTokens.length ? removedTokens[i] : null;
        let newT = i < addedTokens.length ? addedTokens[i] : null;

        if (oldT === EMPTY_TOKEN) oldT = "";
        if (newT === EMPTY_TOKEN) newT = "";

        if (oldT !== null && newT !== null) {
            if (oldT === "" && newT !== "") {
                origArr.push(createSpanStr(newT, 'placeholder'));
                modArr.push(createSpanStr(newT, 'diff-added'));
            } else if (oldT !== "" && newT === "") {
                origArr.push(createSpanStr(oldT, 'diff-removed'));
                modArr.push(createSpanStr(oldT, 'placeholder'));
            } else if (oldT !== "" && newT !== "") {
                if (isUrl(oldT) && isUrl(newT)) {
                    const charDiffs = Diff.diffChars(oldT, newT);
                    charDiffs.forEach(charPart => {
                        if (charPart.added) {
                            origArr.push(createSpanStr(charPart.value, 'placeholder'));
                            modArr.push(createSpanStr(charPart.value, 'diff-modified-add'));
                        } else if (charPart.removed) {
                            origArr.push(createSpanStr(charPart.value, 'diff-modified-del'));
                            modArr.push(createSpanStr(charPart.value, 'placeholder'));
                        } else {
                            origArr.push(createSpanStr(charPart.value, 'diff-modified-base'));
                            modArr.push(createSpanStr(charPart.value, 'diff-modified-base'));
                        }
                    });
                } else {
                    origArr.push(createSpanStr(oldT, 'diff-modified-del'));
                    modArr.push(createSpanStr(newT, 'diff-modified-add'));
                }
            }
        } else if (oldT !== null && oldT !== "") {
            origArr.push(createSpanStr(oldT, 'diff-removed'));
            modArr.push(createSpanStr(oldT, 'placeholder'));
        } else if (newT !== null && newT !== "") {
            origArr.push(createSpanStr(newT, 'placeholder'));
            modArr.push(createSpanStr(newT, 'diff-added'));
        }
    }
}

export default function TextCompareApp() {
    const [original, setOriginal] = useState('');
    const [modified, setModified] = useState('');
    const [isWrap, setIsWrap] = useState(true);

    // 监听来自 VS Code 的更新信号
    useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
            const message = event.data;
            if (message.type === 'updateOriginal') {
                setOriginal(message.text);
            }
        };
        window.addEventListener('message', handleMessage);
        return () => window.removeEventListener('message', handleMessage);
    }, []);

    // 🌟 使用 useMemo 缓存高性能计算结果
    const diffResult = useMemo(() => {
        if (!original.trim() || !modified.trim()) return null;

        try {
            const originalTokens = tokenize(original);
            const modifiedTokens = tokenize(modified);
            const diffs = Diff.diffArrays(originalTokens, modifiedTokens);

            const origHtmlArr: string[] = [];
            const modHtmlArr: string[] = [];

            for (let i = 0; i < diffs.length; i++) {
                const part = diffs[i];
                const nextPart = diffs[i + 1];

                // 处理修改块
                if (part.removed && nextPart && nextPart.added) {
                    renderModificationStr(part.value, nextPart.value, origHtmlArr, modHtmlArr);
                    i++;
                    continue;
                }
                if (part.added && nextPart && nextPart.removed) {
                    renderModificationStr(nextPart.value, part.value, origHtmlArr, modHtmlArr);
                    i++;
                    continue;
                }

                // 处理新增/删除/无变化块
                part.value.forEach(token => {
                    const val = token === EMPTY_TOKEN ? "" : token;
                    if (!val) return;
                    if (part.added) {
                        origHtmlArr.push(createSpanStr(val, 'placeholder'));
                        modHtmlArr.push(createSpanStr(val, 'diff-added'));
                    } else if (part.removed) {
                        origHtmlArr.push(createSpanStr(val, 'diff-removed'));
                        modHtmlArr.push(createSpanStr(val, 'placeholder'));
                    } else {
                        origHtmlArr.push(createSpanStr(val, 'diff-base'));
                        modHtmlArr.push(createSpanStr(val, 'diff-base'));
                    }
                });
            }
            return { origHtml: origHtmlArr.join(''), modHtml: modHtmlArr.join('') };
        } catch (e: any) {
            return { error: e.message };
        }
    }, [original, modified]);

    const handleNativeDiff = () => {
        vscode?.postMessage({ type: 'runDiff', original, modified });
    };

    return (
        <div className="container">
            <div className="header">
                <h2>🔬 文本差异对比 (React)</h2>
                <div className="action-group">
                    <button onClick={() => vscode?.postMessage({ type: 'toggleFullScreen' })}>⛶ 切换全屏</button>
                    <button
                        className="primary"
                        disabled={!original.trim() || !modified.trim()}
                        onClick={handleNativeDiff}
                    >
                        调用原生 Diff
                    </button>
                </div>
            </div>

            <div className="editors">
                <div className="editor-container">
                    <label>【原文本】 <button className="clear-btn" onClick={() => setOriginal('')}>清空</button></label>
                    <textarea
                        value={original}
                        onChange={e => setOriginal(e.target.value)}
                        placeholder="粘贴原文本..."
                    />
                </div>
                <div className="editor-container">
                    <label>【新文本】 <button className="clear-btn" onClick={() => setModified('')}>清空</button></label>
                    <textarea
                        value={modified}
                        onChange={e => setModified(e.target.value)}
                        placeholder="粘贴新文本..."
                    />
                </div>
            </div>

            <div className="result-container">
                <div className="result-header">
                    <span>👇 对比结果</span>
                    <label className="wrap-toggle">
                        <input type="checkbox" checked={isWrap} onChange={e => setIsWrap(e.target.checked)} /> 自动换行
                    </label>
                </div>
                <div className="diff-wrapper">
                    {!diffResult ? (
                        <span style={{ opacity: 0.5 }}>请同时输入原文本和新文本开始实时对比...</span>
                    ) : diffResult.error ? (
                        <span className="error">错误: {diffResult.error}</span>
                    ) : (
                        <div className={`diff-content ${isWrap ? 'is-wrapped' : ''}`}>
                            <div className="diff-line-container">
                                <div className="diff-title">[- 原文]</div>
                                <div
                                    className="diff-text"
                                    dangerouslySetInnerHTML={{ __html: diffResult.origHtml || '' }}
                                />
                            </div>
                            <hr className="diff-hr" />
                            <div className="diff-line-container">
                                <div className="diff-title">[+ 新文]</div>
                                <div
                                    className="diff-text"
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