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
            transition: background-color 0.2s;
        }
        button:hover { background-color: var(--vscode-button-secondaryHoverBackground); }
        button.primary {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
        }
        button.primary:hover { background-color: var(--vscode-button-hoverBackground); }
        
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
        
        .legend-added { background-color: var(--vscode-diffEditor-insertedTextBackground, rgba(46, 160, 67, 0.2)); }
        .legend-removed { background-color: var(--vscode-diffEditor-removedTextBackground, rgba(248, 81, 73, 0.2)); }
        .legend-modified { background-color: rgba(218, 165, 32, 0.15); border: 1px solid rgba(218, 165, 32, 0.4); }

        .diff-wrapper {
            flex: 1;
            background-color: var(--vscode-editor-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 2px;
            padding: 15px;
            overflow: auto;
        }
        
        .diff-content {
            min-width: max-content;
            display: flex;
            flex-direction: column;
            gap: 20px;
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
        
        .placeholder {
            visibility: hidden;
            user-select: none;
        }
        
        /* 纯新增/纯删除块 */
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

        /* 🌟 二阶对比：修改块的专属样式 */
        .diff-modified-base {
            background-color: rgba(218, 165, 32, 0.15);
            border-radius: 1px;
        }
        .diff-modified-del {
            background-color: rgba(248, 81, 73, 0.4);
            color: var(--vscode-editorError-foreground);
            text-decoration: line-through;
            border-radius: 2px;
        }
        .diff-modified-add {
            background-color: rgba(46, 160, 67, 0.4);
            color: var(--vscode-editorInfo-foreground);
            border-radius: 2px;
        }
    </style>
</head>
<body>
    <div class="header">
        <h2>🔬 极速文本差异对比</h2>
        <div class="action-group">
            <button id="fullScreenBtn" title="最大化/还原当前对比窗口">⛶ 切换全屏</button>
            <button id="nativeDiffBtn" class="primary" title="在独立的编辑器 Tab 中进行左右对比">调用原生 Diff</button>
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
            <span>👇 边界保留视图 (Boundary Preserved)</span>
            <span class="legend"><div class="legend-box legend-added"></div> 新增词块</span>
            <span class="legend"><div class="legend-box legend-removed"></div> 删除词块</span>
            <span class="legend"><div class="legend-box legend-modified"></div> 发生修改的词块 (按位高亮差异)</span>
        </div>
        <div id="diff-output" class="diff-wrapper">
            <span style="opacity: 0.5;">输入文本后，对比结果将在此处实时显示...</span>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        const originalEl = document.getElementById('original');
        const modifiedEl = document.getElementById('modified');
        const outputEl = document.getElementById('diff-output');
        
        const initialText = \`${safeInitialText}\`;
        if (initialText) {
            originalEl.value = initialText;
            modifiedEl.focus();
        } else {
            originalEl.focus();
        }

        function clearText(id) {
            document.getElementById(id).value = '';
            scheduleDiff();
        }

        // ========================================================
        // 🌟 第一阶：自定义分词器 (Custom Tokenizer)
        // 规则：链接作为整体保留（不因 : 和 . 切断），其余按照 ,?&.。=:;\s 强行切断
        // ========================================================
        function tokenize(text) {
            if (!text) return [];
            // 正则解析：
            // 捕获组 1: 以 http:// 或 https:// 开头，遇到指定的分割符前视为整体
            // 捕获组 2: 全局分割符 , ? & . 。 = : ; 空白符
            return text.split(/(https?:\\/\\/[^\\?&,。=;\\s]+|[,\\?&\\.。\\=:;\\s])/).filter(t => t !== undefined && t !== '');
        }

        // 创建 DOM 的快捷函数
        function createSpan(text, className) {
            const span = document.createElement('span');
            span.textContent = text;
            if (className) span.className = className;
            return span;
        }

        // ========================================================
        // 🌟 第二阶：组合内部的按位对比算法 (Nested Bitwise Diff)
        // ========================================================
        function renderModification(removedText, addedText, origFrag, modFrag) {
            const charDiffs = Diff.diffChars(removedText, addedText);
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
        }

        function renderDiff() {
            let original = originalEl.value;
            let modified = modifiedEl.value;
            
            if (!original && !modified) {
                outputEl.innerHTML = '<span style="opacity: 0.5;">输入文本后，对比结果将在此处实时显示...</span>';
                return;
            }

            const originalTokens = tokenize(original);
            const modifiedTokens = tokenize(modified);
            
            // 进行词块级比对
            const diffResult = Diff.diffArrays(originalTokens, modifiedTokens);

            const originalFragment = document.createDocumentFragment();
            const modifiedFragment = document.createDocumentFragment();
            
            for (let i = 0; i < diffResult.length; i++) {
                const part = diffResult[i];

                // 探测：如果当前是"删除"，紧接着是"新增"，判定为"发生修改的组合"
                if (part.removed && i + 1 < diffResult.length && diffResult[i + 1].added) {
                    renderModification(part.value.join(''), diffResult[i + 1].value.join(''), originalFragment, modifiedFragment);
                    i++; // 跳过紧跟着的 added
                    continue;
                }
                // 探测：如果当前是"新增"，紧接着是"删除"，判定为"发生修改的组合"
                if (part.added && i + 1 < diffResult.length && diffResult[i + 1].removed) {
                    renderModification(diffResult[i + 1].value.join(''), part.value.join(''), originalFragment, modifiedFragment);
                    i++; // 跳过紧跟着的 removed
                    continue;
                }

                // 常规的（无替换发生的）原样保留、纯新增、纯删除
                const textValue = part.value.join('');
                if (part.added) {
                    originalFragment.appendChild(createSpan(textValue, 'placeholder'));
                    modifiedFragment.appendChild(createSpan(textValue, 'diff-added'));
                } else if (part.removed) {
                    originalFragment.appendChild(createSpan(textValue, 'diff-removed'));
                    modifiedFragment.appendChild(createSpan(textValue, 'placeholder'));
                } else {
                    originalFragment.appendChild(createSpan(textValue, ''));
                    modifiedFragment.appendChild(createSpan(textValue, ''));
                }
            }
            
            outputEl.innerHTML = \`
                <div class="diff-content">
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

        function scheduleDiff() {
            if (!originalEl.value && !modifiedEl.value) {
                outputEl.innerHTML = '<span style="opacity: 0.5;">输入文本后，对比结果将在此处实时显示...</span>';
                return;
            }
            outputEl.innerHTML = '<span style="opacity: 0.5;">正在多阶计算差异，请稍候...</span>';
            
            setTimeout(() => {
                try { renderDiff(); } catch(e) {
                    outputEl.innerHTML = '<span style="color: var(--vscode-editorError-foreground);">文本体积过大或发生解析错误</span>';
                }
            }, 50);
        }

        document.getElementById('fullScreenBtn').addEventListener('click', () => {
            vscode.postMessage({ type: 'toggleFullScreen' });
        });

        let timeout = null;
        const onInput = () => {
            clearTimeout(timeout);
            timeout = setTimeout(scheduleDiff, 400);
        };
        originalEl.addEventListener('input', onInput);
        modifiedEl.addEventListener('input', onInput);

        if (initialText) {
            scheduleDiff();
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
