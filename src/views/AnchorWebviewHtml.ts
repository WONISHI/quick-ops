import * as vscode from 'vscode';

// 辅助函数：生成 Nonce 随机字符串
function getNonce() {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

export function getAnchorMindMapHtml(webview: vscode.Webview): string {
  const nonce = getNonce();
  const scriptSrc = `https://d3js.org https://cdn.jsdelivr.net`;
  const styleSrc = `https://cdnjs.cloudflare.com https://cdn.jsdelivr.net`;

  return `<!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline' ${styleSrc}; script-src 'nonce-${nonce}' ${scriptSrc}; img-src ${webview.cspSource} https:; font-src ${webview.cspSource} https:;">

        <script nonce="${nonce}" src="https://d3js.org/d3.v7.min.js" 
                onerror="this.onerror=null;this.src='https://cdn.jsdelivr.net/npm/d3@7';"></script>
        
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" 
              onerror="this.onerror=null;this.href='https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css';">

        <style>
            :root {
                --node-text-color: var(--vscode-editor-foreground);
                --node-hover-bg: var(--vscode-list-hoverBackground);
                --tooltip-bg: var(--vscode-editorHoverWidget-background);
                --tooltip-border: var(--vscode-editorHoverWidget-border);
                --code-bg: var(--vscode-textBlockQuote-background);
                --accent-color: var(--vscode-textLink-foreground);
            }

            body { background-color: var(--vscode-editor-background); color: var(--vscode-editor-foreground); margin: 0; padding: 0; width: 100vw; height: 100vh; overflow: hidden; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; }
            
            #tree-container { width: 100%; height: 100%; cursor: grab; opacity: 0; transition: opacity 0.5s; }
            #tree-container:active { cursor: grabbing; }
            
            #loading {
                position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
                display: flex; flex-direction: column; align-items: center; gap: 10px;
                color: var(--vscode-descriptionForeground);
            }
            .spinner {
                width: 30px; height: 30px;
                border: 3px solid var(--vscode-editor-background);
                border-top: 3px solid var(--accent-color);
                border-radius: 50%;
                animation: spin 1s linear infinite;
            }
            @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }

            #error-message { display: none; position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); text-align: center; color: var(--vscode-errorForeground); }

            .node { cursor: pointer; }
            .node circle { transition: all 0.3s ease; }
            .node circle.outer { fill: transparent; stroke-width: 2px; opacity: 0; }
            .node circle.inner { stroke-width: 2px; fill: var(--vscode-editor-background); }
            .node:hover circle.outer { opacity: 0.5; stroke: var(--accent-color); }

            .node text.node-icon {
                font-family: "Font Awesome 6 Free"; font-weight: 900; font-size: 14px; fill: var(--accent-color); pointer-events: none; 
            }

            .node text.label { 
                font: 13px "Segoe UI", sans-serif; font-weight: 500; fill: var(--node-text-color); 
                paint-order: stroke; stroke: var(--vscode-editor-background); stroke-width: 3px; stroke-linecap: round; stroke-linejoin: round;
            }
            .node:hover text.label { fill: var(--vscode-textLink-activeForeground); font-weight: 600; }

            .link { fill: none; stroke-width: 2px; stroke-opacity: 0.6; transition: all 0.5s; }
            .link:hover { stroke-opacity: 1; stroke-width: 2.5px; }
            
            .node text.badge { font: 10px sans-serif; fill: var(--vscode-descriptionForeground); font-weight: bold; pointer-events: none; }

            #controls-top-right { 
                position: absolute; top: 20px; right: 20px; z-index: 100; 
                display: flex; gap: 10px;
                opacity: 0; transition: opacity 0.5s; 
            }
            #controls-bottom { 
                position: absolute; bottom: 40px; left: 50%; transform: translateX(-50%); z-index: 100; 
                display: flex; gap: 12px; padding: 10px; 
                opacity: 0; transition: opacity 0.5s; 
            }

            .icon-btn {
                background-color: #ffffff; color: #444; border: none;
                width: 36px; height: 36px; border-radius: 8px;
                font-size: 15px; cursor: pointer; display: flex; align-items: center; justify-content: center;
                box-shadow: 0 4px 12px rgba(0,0,0,0.15); transition: all 0.2s ease;
            }
            .icon-btn:hover { transform: translateY(-2px); background-color: #f0f0f0; color: #000; box-shadow: 0 6px 16px rgba(0,0,0,0.2); }
            .icon-btn:active { transform: translateY(0); box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
            
            .tooltip { 
                position: absolute; opacity: 0; 
                pointer-events: none; /* 默认不可交互，展示时开启 */
                background: var(--tooltip-bg); border: 1px solid var(--tooltip-border); 
                color: var(--vscode-editorHoverWidget-foreground); 
                padding: 0; border-radius: 6px; font-size: 12px; z-index: 9999; 
                box-shadow: 0 8px 24px rgba(0,0,0,0.25); 
                transition: opacity 0.2s ease-in-out; 
                min-width: 250px; max-width: 500px; 
            }
            .tooltip::before {
                content: '';
                position: absolute;
                top: -10px; left: -10px; right: -10px; bottom: -10px;
                z-index: -1;
            }
            .tooltip-header { 
                background: var(--vscode-sideBarSectionHeader-background); 
                padding: 8px 12px; font-weight: 600; border-bottom: 1px solid var(--vscode-panel-border);
                display: flex; align-items: center; gap: 8px; font-size: 13px;
                border-top-left-radius: 6px; border-top-right-radius: 6px;
            }
            .tooltip-header i { color: var(--accent-color); }
            .tooltip-body { padding: 10px 12px; display: flex; flex-direction: column; gap: 8px; }
            .tooltip-row { display: flex; align-items: center; gap: 8px; color: var(--vscode-descriptionForeground); }
            .tooltip-row i { width: 16px; text-align: center; font-size: 11px; }
            .tooltip-val { color: var(--vscode-editor-foreground); word-break: break-all; }

            .code-block {
                background: var(--code-bg); padding: 10px; border-radius: 4px;
                font-family: var(--vscode-editor-font-family, 'Courier New', monospace);
                border-left: 3px solid var(--accent-color);
                white-space: pre-wrap; word-break: break-all; font-size: 11px; margin-top: 4px;
                color: var(--vscode-editor-foreground); line-height: 1.4; max-height: 300px; overflow-y: auto;
            }
            
            .tooltip-actions {
                display: flex; gap: 8px; padding: 8px 12px;
                border-top: 1px dashed var(--vscode-panel-border);
                background: var(--vscode-editorHoverWidget-background);
                border-bottom-left-radius: 6px; border-bottom-right-radius: 6px;
                justify-content: flex-end;
            }
            .tooltip-btn {
                background: transparent; border: 1px solid var(--vscode-panel-border);
                color: var(--vscode-editor-foreground); border-radius: 4px; padding: 4px 8px;
                cursor: pointer; font-size: 11px; display: flex; align-items: center; gap: 4px;
                transition: all 0.2s;
            }
            .tooltip-btn:hover { background: var(--vscode-list-hoverBackground); }
            .tooltip-btn.danger:hover { color: var(--vscode-errorForeground); border-color: var(--vscode-errorForeground); }
        </style>
    </head>
    <body>
        <div id="loading">
            <div class="spinner"></div>
            <div>Loading Resources...</div>
        </div>

        <div id="error-message">
            <h3><i class="fa-solid fa-triangle-exclamation"></i> 资源加载失败</h3>
            <p>请检查网络连接 (CDN)</p>
        </div>

        <div id="controls-top-right">
          <button id="fullscreen-btn" class="icon-btn" title="切换编辑器最大化 (Toggle Maximize)"><i class="fa-solid fa-expand"></i></button>
          <button id="refresh-btn" class="icon-btn" title="刷新"><i class="fa-solid fa-rotate-right"></i></button>
        </div>

        <div id="controls-bottom">
          <button id="zoom-out-btn" class="icon-btn" title="缩小"><i class="fa-solid fa-minus"></i></button>
          <button id="zoom-reset-btn" class="icon-btn" title="适应"><i class="fa-solid fa-compress"></i></button>
          <button id="zoom-in-btn" class="icon-btn" title="放大"><i class="fa-solid fa-plus"></i></button>
        </div>

        <div id="tree-container"></div>
        <div id="tooltip" class="tooltip"></div>

        <script nonce="${nonce}">
            const vscode = acquireVsCodeApi();
            vscode.postMessage({ command: 'ready' });

            function escapeHtml(text) {
                if (!text) return "";
                return text
                    .replace(/&/g, "&amp;")
                    .replace(/</g, "&lt;")
                    .replace(/>/g, "&gt;")
                    .replace(/"/g, "&quot;")
                    .replace(/'/g, "&#039;");
            }

            window.onload = function() {
                if (typeof d3 === 'undefined') {
                    document.getElementById('loading').style.display = 'none';
                    document.getElementById('error-message').style.display = 'block';
                    return;
                }
                initD3();
            };

            let root, svg, g, zoom, tree;
            let colorScale; 
            let hoverTimeout; 

            function getNodeColor(d) {
                if(d.depth === 0) return "var(--vscode-editor-foreground)";
                let ancestor = d;
                while(ancestor.depth > 1) ancestor = ancestor.parent;
                return colorScale(ancestor.id || ancestor.data.name);
            }

            function initD3() {
                colorScale = d3.scaleOrdinal(d3.schemeSet2);
                zoom = d3.zoom().scaleExtent([0.1, 4]).on("zoom", (e) => {
                    if(g) g.attr("transform", e.transform);
                });

                svg = d3.select("#tree-container").append("svg")
                    .attr("width", "100%")
                    .attr("height", "100%")
                    .call(zoom)
                    .on("dblclick.zoom", null);

                g = svg.append("g");
                tree = d3.tree().nodeSize([35, 260]); 
                setupEvents();
            }

            function setupEvents() {
                document.getElementById('refresh-btn').addEventListener('click', () => vscode.postMessage({ command: 'refresh' }));
                document.getElementById('fullscreen-btn').addEventListener('click', toggleFullscreen);
                document.getElementById('zoom-in-btn').addEventListener('click', () => svg.transition().call(zoom.scaleBy, 1.2));
                document.getElementById('zoom-out-btn').addEventListener('click', () => svg.transition().call(zoom.scaleBy, 0.8));
                document.getElementById('zoom-reset-btn').addEventListener('click', () => centerView(true));
                
                window.addEventListener('resize', () => {
                    centerView(false); 
                });
                
                // 🌟 处理 Tooltip 内部的按钮点击事件
                document.getElementById('tooltip').addEventListener('click', (e) => {
                    const btn = e.target.closest('.tooltip-btn');
                    if(btn) {
                        const action = btn.dataset.action;
                        const anchorId = btn.dataset.id;
                        if(action && anchorId) {
                            // 告诉 VSCode 插件去执行操作
                            vscode.postMessage({ command: 'anchorAction', action: action, anchorId: anchorId });
                            
                            // 🌟 核心修复：点击删除/编辑后，立即强制隐藏弹窗并移除鼠标交互，避免变成"幽灵弹窗"
                            d3.select("#tooltip")
                              .style("opacity", 0)
                              .style("pointer-events", "none");
                        }
                    }
                    e.stopPropagation();
                });
                
                document.getElementById('tooltip').addEventListener('mouseenter', () => {
                    clearTimeout(hoverTimeout);
                });
                
                document.getElementById('tooltip').addEventListener('mouseleave', () => {
                    hoverTimeout = setTimeout(() => {
                        d3.select("#tooltip").style("opacity", 0).style("pointer-events", "none");
                    }, 300);
                });
            }

            function toggleFullscreen() {
                vscode.postMessage({ command: 'toggleFullscreen' });
                const btnIcon = document.querySelector('#fullscreen-btn i');
                const btn = document.getElementById('fullscreen-btn');
                if (btnIcon.classList.contains('fa-expand')) {
                    btnIcon.classList.remove('fa-expand');
                    btnIcon.classList.add('fa-compress');
                    btn.title = "恢复默认布局";
                } else {
                    btnIcon.classList.remove('fa-compress');
                    btnIcon.classList.add('fa-expand');
                    btn.title = "切换编辑器最大化";
                }
                setTimeout(() => centerView(true), 400);
            }

            window.addEventListener('message', event => {
                if (event.data.command === 'refresh' && typeof d3 !== 'undefined') {
                    initData(event.data.data);
                }
            });

            function centerView(animate = false) {
                if (!svg || !root) return;
                const w = window.innerWidth;
                const h = window.innerHeight;
                
                let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
                
                root.descendants().forEach(d => {
                    if (d.x < minX) minX = d.x;
                    if (d.x > maxX) maxX = d.x;
                    if (d.y < minY) minY = d.y;
                    if (d.y > maxY) maxY = d.y;
                });
                
                if (minX === Infinity) { minX = 0; maxX = 0; minY = 0; maxY = 0; }
                
                const graphCenterX = (minY + maxY) / 2; 
                const graphCenterY = (minX + maxX) / 2; 
                
                const tx = (w / 2) - graphCenterX;
                const ty = (h / 2) - graphCenterY;
                
                const transform = d3.zoomIdentity.translate(tx, ty).scale(1);
                
                if (animate) svg.transition().duration(750).call(zoom.transform, transform);
                else svg.call(zoom.transform, transform);
            }

            function initData(data) {
                document.getElementById('loading').style.display = 'none';
                document.getElementById('tree-container').style.opacity = '1';
                document.getElementById('controls-top-right').style.opacity = '1';
                document.getElementById('controls-bottom').style.opacity = '1';

                g.selectAll("*").remove(); 
                
                // 🌟 数据刷新时，强行重置 Tooltip 状态，防止它卡在屏幕上
                d3.select("#tooltip").style("opacity", 0).style("pointer-events", "none");

                if (!data || !data.children || data.children.length === 0) {
                    g.append("text").attr("x", 50).attr("y", 50).text("暂无数据").style("fill", "var(--vscode-descriptionForeground)");
                    return;
                }
                root = d3.hierarchy(data);
                let i = 0;
                root.descendants().forEach(d => { d.id = i++; });
                update(root);
                centerView(false);
            }

            function update(source) {
                const nodes = root.descendants();
                const links = root.links();

                tree(root);

                const node = g.selectAll(".node").data(nodes, d => d.id);

                const nodeEnter = node.enter().append("g")
                    .attr("class", "node")
                    .attr("transform", d => "translate(" + (source.y0 || source.y) + "," + (source.x0 || source.x) + ")");

                nodeEnter.append("circle").attr("class", "outer").attr("r", 1e-6).style("stroke", d => getNodeColor(d)).on("click", clickToggle);
                nodeEnter.append("circle").attr("class", "inner").attr("r", 1e-6).style("stroke", d => getNodeColor(d)).on("click", clickToggle);
                
                function clickToggle(e, d) { toggle(d); update(d); e.stopPropagation(); }
                
                nodeEnter.append("text")
                    .attr("class", "node-icon")
                    .attr("dy", 5).attr("x", 16).style("text-anchor", "middle")
                    .text(d => d.data.data ? "\\uf0c1" : "")
                    .on("click", (e, d) => {
                        if(d.data.data) vscode.postMessage({ command: 'jump', data: d.data.data });
                        e.stopPropagation();
                    });

                nodeEnter.append("text")
                    .attr("class", "label")
                    .attr("dy", 5).attr("x", d => d.data.data ? 30 : 14).style("text-anchor", "start")
                    .text(d => d.data.data ? (d.data.data.description || d.data.name) : d.data.name)
                    .on("click", (e, d) => {
                        if(d.data.data) vscode.postMessage({ command: 'jump', data: d.data.data });
                        e.stopPropagation();
                    });

                nodeEnter.append("text")
                    .attr("class", "badge")
                    .attr("dy", -8).attr("dx", 8).style("text-anchor", "middle")
                    .text(d => d._children ? d._children.length : "")
                    .style("opacity", 0);

                const tooltip = d3.select("#tooltip");
                
                nodeEnter.on("mouseenter", (e, d) => {
                    if (!d.data.data) return;
                    clearTimeout(hoverTimeout); 
                    
                    const raw = d.data.data;
                    const anchorId = raw.id; 
                    const content = raw.content ? escapeHtml(raw.content.trim()) : "";
                    const group = escapeHtml(raw.group) || "Default";
                    const file = raw.filePath ? escapeHtml(raw.filePath.split('/').pop()) : "Unknown File";
                    const line = raw.line || "?";
                    const desc = escapeHtml(raw.description) || "Anchor Point";
                    
                    const htmlContent = \`
                        <div class="tooltip-header"><i class="fa-solid fa-tag"></i> <span>\${desc}</span></div>
                        <div class="tooltip-body">
                           <div class="tooltip-row"><i class="fa-regular fa-folder-open"></i> <span class="tooltip-val">\${group}</span></div>
                           <div class="tooltip-row"><i class="fa-regular fa-file-code"></i> <span class="tooltip-val">\${file} : \${line}</span></div>
                           \${content ? \`<div class="code-block">\${content}</div>\` : ''}
                        </div>
                        <div class="tooltip-actions">
                            <button class="tooltip-btn" data-action="edit" data-id="\${anchorId}">
                                <i class="fa-solid fa-pen-to-square"></i> 编辑
                            </button>
                            <button class="tooltip-btn danger" data-action="delete" data-id="\${anchorId}">
                                <i class="fa-solid fa-trash"></i> 删除
                            </button>
                        </div>
                    \`;
                    tooltip.style("opacity", 1)
                           .style("pointer-events", "auto") // 🌟 激活鼠标事件以便点击按钮
                           .html(htmlContent)
                           .style("left", (e.pageX + 20) + "px").style("top", (e.pageY + 10) + "px");
                }).on("mouseleave", (e) => {
                    hoverTimeout = setTimeout(() => {
                        tooltip.style("opacity", 0).style("pointer-events", "none");
                    }, 300);
                });

                const nodeUpdate = nodeEnter.merge(node);
                nodeUpdate.transition().duration(250).attr("transform", d => "translate(" + d.y + "," + d.x + ")");
                
                const isGroup = d => d.data.children && d.data.children.length > 0;
                
                nodeUpdate.select("circle.outer").attr("r", d => isGroup(d) ? 10 : 0).style("opacity", d => isGroup(d) ? 0 : 0);
                nodeUpdate.select("circle.inner").attr("r", d => isGroup(d) ? 5 : 3).style("fill", d => isGroup(d) ? (d._children ? getNodeColor(d) : "var(--vscode-editor-background)") : getNodeColor(d));
                nodeUpdate.select(".badge").text(d => d._children ? d._children.length : "").transition().duration(250).style("opacity", d => d._children ? 1 : 0);

                const nodeExit = node.exit().transition().duration(250).attr("transform", d => "translate(" + source.y + "," + source.x + ")").remove();
                nodeExit.selectAll("circle").attr("r", 1e-6);
                nodeExit.select("text").style("fill-opacity", 1e-6);

                const link = g.selectAll(".link").data(links, d => d.target.id);
                const linkEnter = link.enter().insert("path", "g").attr("class", "link")
                    .style("stroke", d => getNodeColor(d.target))
                    .attr("d", d => {
                        const o = {x: source.x0 || source.x, y: source.y0 || source.y};
                        return d3.linkHorizontal().x(d => d.y).y(d => d.x)({source: o, target: o});
                    });
                
                const linkUpdate = linkEnter.merge(link);
                linkUpdate.transition().duration(250).attr("d", d3.linkHorizontal().x(d => d.y).y(d => d.x)).style("stroke", d => getNodeColor(d.target));
                link.exit().transition().duration(250).attr("d", d => {
                        const o = {x: source.x, y: source.y};
                        return d3.linkHorizontal().x(d => d.y).y(d => d.x)({source: o, target: o});
                    }).remove();

                nodes.forEach(d => { d.x0 = d.x; d.y0 = d.y; });
            }

            function toggle(d) {
                if (d.children) { d._children = d.children; d.children = null; } 
                else { d.children = d._children; d._children = null; }
            }
        </script>
    </body>
    </html>`;
}