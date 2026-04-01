import { useState, useEffect, useRef } from 'react';
import * as Diff from 'diff';
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
            } else {
                origArr.push(createSpanStr("", ""));
                modArr.push(createSpanStr("", ""));
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
    
    // 强制触发比对的标记
    const [triggerDiff, setTriggerDiff] = useState(0);
    // 渲染结果缓存
    const [diffResult, setDiffResult] = useState<{origHtml: string, modHtml: string, error?: string} | null>(null);

    const modifiedInputRef = useRef<HTMLTextAreaElement>(null);

    // 监听来自 VS Code 的更新信号
    useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
            const message = event.data;
            if (message.type === 'updateOriginal') {
                setOriginal(message.text);
                modifiedInputRef.current?.focus();
            }
        };
        window.addEventListener('message', handleMessage);
        
        // 告诉后端准备好了，可以发数据
        vscode?.postMessage({ type: 'ready' });

        return () => window.removeEventListener('message', handleMessage);
    }, []);

    // 只要两个文本都有值，或者手动点击按钮，就触发比对计算
    useEffect(() => {
        if (!original.trim() || !modified.trim()) {
            setDiffResult(null);
            return;
        }

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
            setDiffResult({ origHtml: origHtmlArr.join(''), modHtml: modHtmlArr.join('') });
        } catch (e: any) {
            setDiffResult({ origHtml: '', modHtml: '', error: e.message });
        }
    }, [original, modified, triggerDiff]);

    const handleNativeDiff = () => {
        vscode?.postMessage({ type: 'runDiff', original, modified });
    };
    
    const canCompare = !!original.trim() && !!modified.trim();

    return (
        <div className="compare-container">
            {/* 🌟 局部作用域样式，完全继承原来的主题和布局 */}
            <style>{`
                body { padding: 0; margin: 0; }
                .compare-container {
                    font-family: var(--vscode-font-family);
                    color: var(--vscode-foreground);
                    background-color: var(--vscode-editor-background);
                    padding: 20px;
                    display: flex;
                    flex-direction: column;
                    height: 100vh;
                    box-sizing: border-box;
                }
                .compare-header {
                    display: flex; justify-content: space-between; align-items: center;
                    margin-bottom: 15px; flex-shrink: 0;
                }
                .compare-header h2 { margin: 0; font-size: 16px; font-weight: normal; opacity: 0.9; }
                .action-group { display: flex; align-items: center; gap: 10px; }

                .compare-container button {
                    background-color: var(--vscode-button-secondaryBackground);
                    color: var(--vscode-button-secondaryForeground);
                    border: 1px solid var(--vscode-button-border, transparent);
                    padding: 6px 16px; border-radius: 2px; cursor: pointer;
                    font-size: 13px; transition: background-color 0.2s, opacity 0.2s;
                }
                .compare-container button:hover:not(:disabled) { background-color: var(--vscode-button-secondaryHoverBackground); }
                
                .compare-container button.primary { background-color: var(--vscode-button-background); color: var(--vscode-button-foreground); }
                .compare-container button.primary:hover:not(:disabled) { background-color: var(--vscode-button-hoverBackground); }
                
                .compare-container button:disabled { opacity: 0.4; cursor: not-allowed; }
                
                .editors { display: flex; gap: 20px; height: 35%; min-height: 150px; flex-shrink: 0; }
                .editor-box { flex: 1; display: flex; flex-direction: column; }
                .editor-box label {
                    margin-bottom: 8px; font-size: 13px; opacity: 0.8;
                    display: flex; justify-content: space-between;
                }
                .clear-btn { background: none !important; border: none !important; color: var(--vscode-textLink-foreground) !important; padding: 0 !important; cursor: pointer; font-size: 12px !important; height: auto; }
                .clear-btn:hover { background: none; text-decoration: underline; color: var(--vscode-textLink-activeForeground) !important; }
                
                .editor-box textarea {
                    flex: 1; background-color: var(--vscode-input-background); color: var(--vscode-input-foreground);
                    border: 1px solid var(--vscode-input-border); padding: 10px;
                    font-family: var(--vscode-editor-font-family), monospace;
                    font-size: var(--vscode-editor-font-size, 13px);
                    resize: none; border-radius: 2px; outline: none; white-space: pre;
                }
                .editor-box textarea:focus { border-color: var(--vscode-focusBorder); }

                .result-container { margin-top: 20px; flex: 1; display: flex; flex-direction: column; overflow: hidden; }
                .result-header { margin-bottom: 8px; font-size: 13px; opacity: 0.8; display: flex; gap: 15px; align-items: center; }
                .legend { display: flex; align-items: center; gap: 4px; font-size: 12px; }
                .legend-box { width: 12px; height: 12px; border-radius: 2px; }
                
                .wrap-toggle { display: flex; align-items: center; cursor: pointer; margin-left: auto; color: var(--vscode-textLink-foreground); font-weight: 500; }
                .wrap-toggle:hover { color: var(--vscode-textLink-activeForeground); }
                .wrap-toggle input { margin-right: 4px; cursor: pointer; }

                .legend-added { background-color: var(--vscode-diffEditor-insertedTextBackground, rgba(46, 160, 67, 0.2)); }
                .legend-removed { background-color: var(--vscode-diffEditor-removedTextBackground, rgba(248, 81, 73, 0.2)); }
                .legend-modified { background-color: rgba(218, 165, 32, 0.25); border: 1px solid rgba(218, 165, 32, 0.4); }

                .diff-wrapper {
                    flex: 1; background-color: var(--vscode-editor-background);
                    border: 1px solid var(--vscode-panel-border); border-radius: 2px;
                    padding: 15px; overflow: auto;
                }
                
                .diff-content { min-width: max-content; display: flex; flex-direction: column; gap: 20px; }
                .diff-content.is-wrapped { min-width: 0; width: 100%; }

                .diff-line-container { display: flex; flex-direction: column; }
                .diff-title {
                    font-size: 12px; opacity: 0.7; margin-bottom: 8px; position: sticky; left: 0;
                    display: inline-block; padding: 2px 6px; background: var(--vscode-badge-background);
                    color: var(--vscode-badge-foreground); border-radius: 4px; width: max-content;
                }
                
                .diff-text { white-space: pre; font-family: var(--vscode-editor-font-family), monospace; font-size: var(--vscode-editor-font-size, 13px); line-height: 1.5; }
                .diff-content.is-wrapped .diff-text { white-space: pre-wrap; word-break: break-all; }
                
                .placeholder { visibility: hidden; user-select: none; }
                .diff-added { background-color: var(--vscode-diffEditor-insertedTextBackground, rgba(46, 160, 67, 0.2)); color: var(--vscode-editorInfo-foreground); border-radius: 2px; }
                .diff-removed { background-color: var(--vscode-diffEditor-removedTextBackground, rgba(248, 81, 73, 0.2)); color: var(--vscode-editorError-foreground); text-decoration: line-through; opacity: 0.8; border-radius: 2px; }
                .diff-modified-base { background-color: rgba(218, 165, 32, 0.15); border-radius: 1px; }
                .diff-modified-del { background-color: rgba(218, 165, 32, 0.4); color: var(--vscode-editorWarning-foreground, inherit); text-decoration: line-through; opacity: 0.8; border-radius: 2px; }
                .diff-modified-add { background-color: rgba(218, 165, 32, 0.4); color: var(--vscode-editorWarning-foreground, inherit); font-weight: 500; border-radius: 2px; }
            `}</style>

            <div className="compare-header">
                <h2>🔬 极速文本差异对比</h2>
                <div className="action-group">
                    <button 
                        className="primary" 
                        disabled={!canCompare} 
                        onClick={() => setTriggerDiff(prev => prev + 1)}
                    >
                        开始对比
                    </button>
                    <button title="最大化/还原当前对比窗口" onClick={() => vscode?.postMessage({ type: 'toggleFullScreen' })}>
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

            <div className="editors">
                <div className="editor-box">
                    <label>
                        <span>【原文本】(Original)</span> 
                        <button className="clear-btn" onClick={() => setOriginal('')}>清空</button>
                    </label>
                    <textarea
                        value={original}
                        onChange={e => setOriginal(e.target.value)}
                        placeholder="在此粘贴原始链接、JSON 或代码..."
                    />
                </div>
                <div className="editor-box">
                    <label>
                        <span>【新文本】(Modified)</span> 
                        <button className="clear-btn" onClick={() => setModified('')}>清空</button>
                    </label>
                    <textarea
                        ref={modifiedInputRef}
                        value={modified}
                        onChange={e => setModified(e.target.value)}
                        placeholder="在此粘贴修改后的内容..."
                    />
                </div>
            </div>

            <div className="result-container">
                <div className="result-header">
                    <span>👇 边界保留与空位感知视图 (Boundary & Empty-Slot Preserved)</span>
                    <span className="legend"><div className="legend-box legend-added"></div> 新增词块</span>
                    <span className="legend"><div className="legend-box legend-removed"></div> 删除词块</span>
                    <span className="legend"><div className="legend-box legend-modified"></div> 整体替换 / 链接修改</span>
                    
                    <label className="wrap-toggle" title="开启后长文本将自动换行显示，无需横向滚动">
                        <input type="checkbox" checked={isWrap} onChange={e => setIsWrap(e.target.checked)} /> 自动换行 (Wrap)
                    </label>
                </div>
                <div className="diff-wrapper">
                    {!diffResult ? (
                        <span style={{ opacity: 0.5 }}>请同时输入原文本和新文本，点击右上角【开始对比】按钮...</span>
                    ) : diffResult.error ? (
                        <span style={{ color: 'var(--vscode-editorError-foreground)' }}>渲染出错: {diffResult.error}</span>
                    ) : (
                        <div className={`diff-content ${isWrap ? 'is-wrapped' : ''}`}>
                            <div className="diff-line-container">
                                <div className="diff-title">[- 原文]</div>
                                <div
                                    className="diff-text"
                                    dangerouslySetInnerHTML={{ __html: diffResult.origHtml || '' }}
                                />
                            </div>
                            <hr style={{ border: 0, borderBottom: '1px dashed var(--vscode-panel-border)', margin: 0, width: '100%' }} />
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