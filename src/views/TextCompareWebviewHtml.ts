import * as vscode from 'vscode';

export function getTextCompareWebviewHtml(webview: vscode.Webview, initialText: string): string {
    const safeInitialText = initialText.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$/g, '\\$');

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>文本差异对比</title>
    <script src="https://cdn.jsdelivr.net/npm/diff@5.1.0/dist/diff.min.js"></script>
    <script>
        if (typeof Diff === 'undefined') {
            document.write('<script src="https://unpkg.com/diff@5.1.0/dist/diff.min.js"><\\/script>');
        }
    </script>
    <style>
        body {
            font-family: var(--vscode-font-family);
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
            padding: 20px;
            display: flex;
            flex-direction: column;
            height: 100vh;
            box-sizing: border-box;
            margin: 0;
        }
        .header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 15px;
            flex-shrink: 0;
        }
        h2 { margin: 0; font-size: 16px; font-weight: normal; opacity: 0.9; }
        .action-group { display: flex; align-items: center; gap: 10px; }

        button {
            background-color: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            border: 1px solid var(--vscode-button-border, transparent);
            padding: 6px 16px;
            border-radius: 2px;
            cursor: pointer;
            font-size: 13px;
            transition: background-color 0.2s, opacity 0.2s;
        }
        button:hover:not(:disabled) { background-color: var(--vscode-button-secondaryHoverBackground); }
        
        button.primary {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
        }
        button.primary:hover:not(:disabled) { background-color: var(--vscode-button-hoverBackground); }
        
        /* 🌟 按钮禁用状态样式 */
        button:disabled {
            opacity: 0.4;
            cursor: not-allowed;
        }
        
        .editors {
            display: flex;
            gap: 20px;
            height: 35%;
            min-height: 150px;
            flex-shrink: 0;
        }
        .editor-container {
            flex: 1;
            display: flex;
            flex-direction: column;
        }
        .editor-container label {
            margin-bottom: 8px;
            font-size: 13px;
            opacity: 0.8;
            display: flex;
            justify-content: space-between;
        }
        .clear-btn {
            background: none; border: none; color: var(--vscode-textLink-foreground);
            padding: 0; cursor: pointer; font-size: 12px; height: auto;
        }
        .clear-btn:hover { background: none; text-decoration: underline; color: var(--vscode-textLink-activeForeground); }
        
        textarea {
            flex: 1;
            background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            padding: 10px;
            font-family: var(--vscode-editor-font-family), monospace;
            font-size: var(--vscode-editor-font-size, 13px);
            resize: none;
            border-radius: 2px;
            outline: none;
            white-space: pre;
        }
        textarea:focus { border-color: var(--vscode-focusBorder); }

        .result-container {
            margin-top: 20px;
            flex: 1;
            display: flex;
            flex-direction: column;
            overflow: hidden;
        }
        .result-header {
            margin-bottom: 8px;
            font-size: 13px;
            opacity: 0.8;
            display: flex;
            gap: 15px;
            align-items: center;
        }
        .legend { display: flex; align-items: center; gap: 4px; font-size: 12px; }
        .legend-box { width: 12px; height: 12px; border-radius: 2px; }
        
        .wrap-toggle {
            display: flex;
            align-items: center;
            cursor: pointer;
            margin-left: auto;
            color: var(--vscode-textLink-foreground);
            font-weight: 500;
        }
        .wrap-toggle:hover { color: var(--vscode-textLink-activeForeground); }
        .wrap-toggle input { margin-right: 4px; cursor: pointer; }

        .legend-added { background-color: var(--vscode-diffEditor-insertedTextBackground, rgba(46, 160, 67, 0.2)); }
        .legend-removed { background-color: var(--vscode-diffEditor-removedTextBackground, rgba(248, 81, 73, 0.2)); }
        .legend-modified { background-color: rgba(218, 165, 32, 0.25); border: 1px solid rgba(218, 165, 32, 0.4); }

        .diff-wrapper {
            flex: 1;
            background-color: var(--vscode-editor-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 2px;
            padding: 15px;
            overflow: auto;
        }
        
        .diff-content {
            /* 默认不换行，宽度撑满以适配长背景色 */
            min-width: max-content;
            display: flex;
            flex-direction: column;
            gap: 20px;
        }
        
        /* 🌟 核心修复：开启换行模式时，撤销 max-content 限制，允许宽度收缩 */
        .diff-content.is-wrapped {
            min-width: 0;
            width: 100%;
        }

        .diff-line-container {
            display: flex;
            flex-direction: column;
        }
        .diff-title {
            font-size: 12px;
            opacity: 0.7;
            margin-bottom: 8px;
            position: sticky;
            left: 0;
            display: inline-block;
            padding: 2px 6px;
            background: var(--vscode-badge-background);
            color: var(--vscode-badge-foreground);
            border-radius: 4px;
            width: max-content;
        }
        
        .diff-text {
            white-space: pre; 
            font-family: var(--vscode-editor-font-family), monospace;
            font-size: var(--vscode-editor-font-size, 13px);
            line-height: 1.5;
        }
        
        /* 🌟 核心修复：让被 is-wrapped 包裹的子元素实现强制换行 */
        .diff-content.is-wrapped .diff-text {
            white-space: pre-wrap;
            word-break: break-all;
        }
        
        .placeholder {
            visibility: hidden;
            user-select: none;
        }
        
        .diff-added {
            background-color: var(--vscode-diffEditor-insertedTextBackground, rgba(46, 160, 67, 0.2));
            color: var(--vscode-editorInfo-foreground);
            border-radius: 2px;
        }
        .diff-removed {
            background-color: var(--vscode-diffEditor-removedTextBackground, rgba(248, 81, 73, 0.2));
            color: var(--vscode-editorError-foreground);
            text-decoration: line-through;
            opacity: 0.8;
            border-radius: 2px;
        }

        .diff-modified-base {
            background-color: rgba(218, 165, 32, 0.15);
            border-radius: 1px;
        }
        .diff-modified-del {
            background-color: rgba(218, 165, 32, 0.4);
            color: var(--vscode-editorWarning-foreground, inherit);
            text-decoration: line-through;
            opacity: 0.8;
            border-radius: 2px;
        }
        .diff-modified-add {
            background-color: rgba(218, 165, 32, 0.4);
            color: var(--vscode-editorWarning-foreground, inherit);
            font-weight: 500;
            border-radius: 2px;
        }
    </style>
</head>
<body>
    <div class="header">
        <h2>🔬 极速文本差异对比</h2>
        <div class="action-group">
            <button id="compareBtn" class="primary" disabled>开始对比</button>
            <button id="fullScreenBtn" title="最大化/还原当前对比窗口">⛶ 切换全屏</button>
            <button id="nativeDiffBtn" title="在独立的编辑器 Tab 中进行左右对比">调用原生 Diff</button>
        </div>
    </div>
    
    <div class="editors">
        <div class="editor-container">
            <label><span>【原文本】(Original)</span> <button class="clear-btn" onclick="clearText('original')">清空</button></label>
            <textarea id="original" placeholder="在此粘贴原始链接、JSON 或代码..."></textarea>
        </div>
        <div class="editor-container">
            <label><span>【新文本】(Modified)</span> <button class="clear-btn" onclick="clearText('modified')">清空</button></label>
            <textarea id="modified" placeholder="在此粘贴修改后的内容..."></textarea>
        </div>
    </div>

    <div class="result-container">
        <div class="result-header">
            <span>👇 边界保留与空位感知视图 (Boundary & Empty-Slot Preserved)</span>
            <span class="legend"><div class="legend-box legend-added"></div> 新增词块</span>
            <span class="legend"><div class="legend-box legend-removed"></div> 删除词块</span>
            <span class="legend"><div class="legend-box legend-modified"></div> 整体替换 / 链接修改</span>
            
            <label class="wrap-toggle" title="开启后长文本将自动换行显示，无需横向滚动">
                <input type="checkbox" id="wrapToggle" checked> 自动换行 (Wrap)
            </label>
        </div>
        <div id="diff-output" class="diff-wrapper">
            <span style="opacity: 0.5;">请同时输入原文本和新文本，点击右上角【开始对比】按钮...</span>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        const originalEl = document.getElementById('original');
        const modifiedEl = document.getElementById('modified');
        const outputEl = document.getElementById('diff-output');
        const wrapToggleEl = document.getElementById('wrapToggle');
        const compareBtn = document.getElementById('compareBtn');

        window.addEventListener('message', event => {
            const message = event.data;
            if (message.type === 'updateOriginal') {
                originalEl.value = message.text;
                updateButtonState();
                scheduleDiff(); // 自动触发一次对比渲染
            }
        });
        
        const initialText = \`${safeInitialText}\`;
        if (initialText) {
            originalEl.value = initialText;
            modifiedEl.focus();
        } else {
            originalEl.focus();
        }

        // 🌟 更新按钮点击状态
        function updateButtonState() {
            if (originalEl.value.trim() && modifiedEl.value.trim()) {
                compareBtn.disabled = false;
            } else {
                compareBtn.disabled = true;
            }
        }

        // 🌟 换行控制逻辑
        wrapToggleEl.addEventListener('change', (e) => {
            const isWrap = e.target.checked;
            const diffContent = document.querySelector('.diff-content');
            if (diffContent) {
                // 将 is-wrapped 类加在父级容器上，由 CSS 自动控制内部换行
                diffContent.classList.toggle('is-wrapped', isWrap);
            }
        });

        function clearText(id) {
            document.getElementById(id).value = '';
            updateButtonState();
            // 清空时，重置视图
            outputEl.innerHTML = '<span style="opacity: 0.5;">请同时输入原文本和新文本，点击右上角【开始对比】按钮...</span>';
        }

        const EMPTY_TOKEN = "___EMPTY_SLOT___";

        function tokenize(text) {
            if (!text) return [];
            const regex = /(https?:\\/\\/[^\\?&,。=;\\s]+|[,\\?&\\.。\\=:;\\s])/;
            const rawTokens = text.split(regex);
            return rawTokens.map(t => t === "" ? EMPTY_TOKEN : t);
        }

        function isUrl(str) {
            return str.startsWith('http://') || str.startsWith('https://');
        }

        function createSpan(text, className) {
            const span = document.createElement('span');
            span.textContent = text;
            if (className) span.className = className;
            return span;
        }

        function renderModification(removedTokens, addedTokens, origFrag, modFrag) {
            const maxLen = Math.max(removedTokens.length, addedTokens.length);
            
            for (let i = 0; i < maxLen; i++) {
                let oldT = i < removedTokens.length ? removedTokens[i] : null;
                let newT = i < addedTokens.length ? addedTokens[i] : null;
                
                if (oldT === EMPTY_TOKEN) oldT = "";
                if (newT === EMPTY_TOKEN) newT = "";

                if (oldT !== null && newT !== null) {
                    if (oldT === "" && newT !== "") {
                        origFrag.appendChild(createSpan(newT, 'placeholder'));
                        modFrag.appendChild(createSpan(newT, 'diff-added'));
                    } else if (oldT !== "" && newT === "") {
                        origFrag.appendChild(createSpan(oldT, 'diff-removed'));
                        modFrag.appendChild(createSpan(oldT, 'placeholder'));
                    } else if (oldT !== "" && newT !== "") {
                        if (isUrl(oldT) && isUrl(newT)) {
                            const charDiffs = Diff.diffChars(oldT, newT);
                            charDiffs.forEach(charPart => {
                                if (charPart.added) {
                                    origFrag.appendChild(createSpan(charPart.value, 'placeholder'));
                                    modFrag.appendChild(createSpan(charPart.value, 'diff-modified-add'));
                                } else if (charPart.removed) {
                                    origFrag.appendChild(createSpan(charPart.value, 'diff-modified-del'));
                                    modFrag.appendChild(createSpan(charPart.value, 'placeholder'));
                                } else {
                                    origFrag.appendChild(createSpan(charPart.value, 'diff-modified-base'));
                                    modFrag.appendChild(createSpan(charPart.value, 'diff-modified-base'));
                                }
                            });
                        } else {
                            origFrag.appendChild(createSpan(oldT, 'diff-modified-del'));
                            modFrag.appendChild(createSpan(newT, 'diff-modified-add'));
                        }
                    } else {
                        origFrag.appendChild(createSpan("", ""));
                        modFrag.appendChild(createSpan("", ""));
                    }
                } else if (oldT !== null) {
                    if (oldT !== "") {
                        origFrag.appendChild(createSpan(oldT, 'diff-removed'));
                        modFrag.appendChild(createSpan(oldT, 'placeholder'));
                    }
                } else if (newT !== null) {
                    if (newT !== "") {
                        origFrag.appendChild(createSpan(newT, 'placeholder'));
                        modFrag.appendChild(createSpan(newT, 'diff-added'));
                    }
                }
            }
        }

        function renderDiff() {
            let original = originalEl.value;
            let modified = modifiedEl.value;
            
            if (!original || !modified) {
                return;
            }

            if (typeof Diff === 'undefined') {
                throw new Error("对比核心库未加载，请检查网络是否能访问 CDN。");
            }

            const originalTokens = tokenize(original);
            const modifiedTokens = tokenize(modified);
            
            const diffResult = Diff.diffArrays(originalTokens, modifiedTokens);

            const originalFragment = document.createDocumentFragment();
            const modifiedFragment = document.createDocumentFragment();
            
            for (let i = 0; i < diffResult.length; i++) {
                const part = diffResult[i];
                const nextPart = diffResult[i + 1];

                if (part.removed && nextPart && nextPart.added) {
                    renderModification(part.value, nextPart.value, originalFragment, modifiedFragment);
                    i++;
                    continue;
                }
                if (part.added && nextPart && nextPart.removed) {
                    renderModification(nextPart.value, part.value, originalFragment, modifiedFragment);
                    i++; 
                    continue;
                }

                part.value.forEach(token => {
                    const textValue = token === EMPTY_TOKEN ? "" : token;
                    if (textValue === "") return; 

                    if (part.added) {
                        originalFragment.appendChild(createSpan(textValue, 'placeholder'));
                        modifiedFragment.appendChild(createSpan(textValue, 'diff-added'));
                    } else if (part.removed) {
                        originalFragment.appendChild(createSpan(textValue, 'diff-removed'));
                        modifiedFragment.appendChild(createSpan(textValue, 'placeholder'));
                    } else {
                        originalFragment.appendChild(createSpan(textValue, 'diff-base'));
                        modifiedFragment.appendChild(createSpan(textValue, 'diff-base'));
                    }
                });
            }
            
            const wrapClass = wrapToggleEl.checked ? ' is-wrapped' : '';
            
            outputEl.innerHTML = \`
                <div class="diff-content\${wrapClass}">
                    <div class="diff-line-container">
                        <div class="diff-title">[- 原文]</div>
                        <div class="diff-text" id="diff-original-content"></div>
                    </div>
                    <hr style="border: 0; border-bottom: 1px dashed var(--vscode-panel-border); margin: 0; width: 100%;" />
                    <div class="diff-line-container">
                        <div class="diff-title">[+ 新文]</div>
                        <div class="diff-text" id="diff-modified-content"></div>
                    </div>
                </div>
            \`;

            document.getElementById('diff-original-content').appendChild(originalFragment);
            document.getElementById('diff-modified-content').appendChild(modifiedFragment);
        }

        // 点击开始对比按钮才执行运算
        compareBtn.addEventListener('click', () => {
            outputEl.innerHTML = '<span style="opacity: 0.5;">正在计算差异，请稍候...</span>';
            setTimeout(() => {
                try { 
                    renderDiff(); 
                } catch(e) {
                    outputEl.innerHTML = \`<span style="color: var(--vscode-editorError-foreground);">渲染出错: \${e.message}</span>\`;
                }
            }, 10);
        });

        document.getElementById('fullScreenBtn').addEventListener('click', () => {
            vscode.postMessage({ type: 'toggleFullScreen' });
        });

        // 🌟 监听输入，仅更新按钮状态，不执行自动对比
        originalEl.addEventListener('input', updateButtonState);
        modifiedEl.addEventListener('input', updateButtonState);

        // 初始化校验
        updateButtonState();
        // 初始如果两边都有值(例如注入的情况)，可以直接触发一下对比
        if (originalEl.value && modifiedEl.value) {
            compareBtn.click();
        }

        document.getElementById('nativeDiffBtn').addEventListener('click', () => {
            vscode.postMessage({
                type: 'runDiff',
                original: originalEl.value,
                modified: modifiedEl.value
            });
        });
    </script>
</body>
</html>`;
}