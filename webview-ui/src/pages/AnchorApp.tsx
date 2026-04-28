import { useEffect, useRef } from 'react';
import * as d3 from 'd3';
import { vscode } from '../utils/vscode';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faExpand, faCompress, faRotateRight, faMinus, faPlus, faTag, faPenToSquare, faTrash, faLink, type IconDefinition } from '@fortawesome/free-solid-svg-icons';
import { faFolderOpen as faFolderOpenReg, faFileCode as faFileCodeReg } from '@fortawesome/free-regular-svg-icons';
import type { TreeNodeData, TreeNode, IconTuple } from '../types/AnchorApp';

function getIconSvg(iconDef: IconDefinition, className: string = '') {
  const iconArray = iconDef.icon as unknown as IconTuple;
  const width = iconArray[0];
  const height = iconArray[1];
  const path = iconArray[4];
  return `<svg class="${className}" viewBox="0 0 ${width} ${height}" width="1em" height="1em" fill="currentColor"><path d="${path}"></path></svg>`;
}

// 辅助函数：防止 HTML 注入
function escapeHtml(text: string) {
  if (!text) return '';
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

export default function AnchorApp() {
  const containerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const isFullscreen = useRef(false);
  const hoverTimeout = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!containerRef.current) return;

    let i = 0;
    let root: TreeNode | null = null;

    const colorScale = d3.scaleOrdinal(d3.schemeSet2);

    function getNodeColor(d: TreeNode) {
      if (d.depth === 0) return 'var(--vscode-editor-foreground, #ccc)';
      let ancestor = d;
      while (ancestor.depth > 1 && ancestor.parent) ancestor = ancestor.parent as TreeNode;
      return colorScale((ancestor.id || ancestor.data.name).toString());
    }

    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 4])
      .on('zoom', (e) => {
        if (g) g.attr('transform', e.transform);
      });

    const svg = d3.select(containerRef.current).append('svg').attr('width', '100%').attr('height', '100%').call(zoom).on('dblclick.zoom', null);

    const g = svg.append('g');
    const tree = d3.tree<TreeNodeData>().nodeSize([35, 260]);
    const diagonal = d3
      .linkHorizontal<d3.HierarchyPointLink<TreeNodeData>, d3.HierarchyPointNode<TreeNodeData>>()
      .x((d) => d.y)
      .y((d) => d.x);

    const handleTooltipClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const btn = target.closest('.tooltip-btn') as HTMLElement;
      if (btn) {
        const action = btn.dataset.action;
        const anchorId = btn.dataset.id;
        if (action && anchorId) {
          vscode?.postMessage({ command: 'anchorAction', action, anchorId });
          d3.select(tooltipRef.current).style('opacity', 0).style('pointer-events', 'none');
        }
      }
      e.stopPropagation();
    };

    const tooltipEl = tooltipRef.current;
    if (tooltipEl) {
      tooltipEl.addEventListener('click', handleTooltipClick);
      tooltipEl.addEventListener('mouseenter', () => window.clearTimeout(hoverTimeout.current));
      tooltipEl.addEventListener('mouseleave', () => {
        hoverTimeout.current = window.setTimeout(() => {
          d3.select(tooltipEl).style('opacity', 0).style('pointer-events', 'none');
        }, 300);
      });
    }

    function centerView(animate = false) {
      if (!svg || !root || !containerRef.current) return;
      const w = containerRef.current.clientWidth;
      const h = containerRef.current.clientHeight;

      let minX = Infinity,
        maxX = -Infinity,
        minY = Infinity,
        maxY = -Infinity;

      root.descendants().forEach((d: TreeNode) => {
        if (d.x < minX) minX = d.x;
        if (d.x > maxX) maxX = d.x;
        if (d.y < minY) minY = d.y;
        if (d.y > maxY) maxY = d.y;
      });

      if (minX === Infinity) {
        minX = 0;
        maxX = 0;
        minY = 0;
        maxY = 0;
      }

      const graphCenterX = (minY + maxY) / 2;
      const graphCenterY = (minX + maxX) / 2;

      const tx = w / 2 - graphCenterX;
      const ty = h / 2 - graphCenterY;

      const transform = d3.zoomIdentity.translate(tx, ty).scale(1);

      if (animate) {
        (svg.transition().duration(750) as unknown as d3.Selection<SVGSVGElement, unknown, null, undefined>).call(zoom.transform, transform);
      } else {
        svg.call(zoom.transform, transform);
      }
    }

    function update(source: TreeNode) {
      if (!root) return;

      const nodes = root.descendants() as TreeNode[];
      const links = root.links();
      tree(root);

      const t = svg.transition().duration(400) as unknown as d3.Transition<d3.BaseType, unknown, null, undefined>;
      const isGroup = (d: TreeNode) => d.data.children && d.data.children.length > 0;

      const node = g.selectAll<SVGGElement, TreeNode>('g.node').data(nodes, (d) => d.id || (d.id = String(++i)));

      const nodeEnter = node
        .enter()
        .append('g')
        .attr('class', 'node')
        .attr('transform', () => `translate(${source.y0 || source.y},${source.x0 || source.x})`);

      nodeEnter
        .append('circle')
        .attr('class', 'outer')
        .attr('r', 1e-6)
        .style('stroke', (d) => getNodeColor(d))
        .on('click', (e, d) => {
          toggle(d);
          update(d);
          e.stopPropagation();
        });

      nodeEnter
        .append('circle')
        .attr('class', 'inner')
        .attr('r', 1e-6)
        .style('stroke', (d) => getNodeColor(d))
        .on('click', (e, d) => {
          toggle(d);
          update(d);
          e.stopPropagation();
        });

      const linkIconArray = faLink.icon as unknown as IconTuple;
      nodeEnter
        .append('path')
        .attr('class', 'node-icon')
        .attr('d', linkIconArray[4])
        .attr('transform', 'translate(12, -7) scale(0.028)')
        .attr('fill', 'var(--vscode-textLink-foreground)')
        .style('display', (d) => (d.data.data ? 'block' : 'none'))
        .on('click', (e, d) => {
          if (d.data.data) vscode?.postMessage({ command: 'jump', data: d.data.data });
          e.stopPropagation();
        });

      nodeEnter
        .append('text')
        .attr('class', 'label')
        .attr('dy', 5)
        .attr('x', (d) => (d.data.data ? 32 : 14))
        .style('text-anchor', 'start')
        .text((d) => (d.data.data ? d.data.data.description || d.data.name : d.data.name))
        .on('click', (e, d) => {
          if (d.data.data) vscode?.postMessage({ command: 'jump', data: d.data.data });
          e.stopPropagation();
        });

      nodeEnter
        .append('text')
        .attr('class', 'badge')
        .attr('dy', -8)
        .attr('dx', 8)
        .style('text-anchor', 'middle')
        .text((d) => (d._children ? d._children.length : ''))
        .style('opacity', 0);

      const tooltip = d3.select(tooltipRef.current);
      nodeEnter
        .on('mouseenter', (e, d) => {
          if (!d.data.data) return;
          window.clearTimeout(hoverTimeout.current);

          const raw = d.data.data;
          const anchorId = raw.id;
          const content = raw.content ? escapeHtml(raw.content.trim()) : '';
          const group = escapeHtml(raw.group) || 'Default';
          const file = raw.filePath ? escapeHtml(raw.filePath.split('/').pop() || '') : 'Unknown File';
          const line = raw.line || '?';
          const desc = escapeHtml(raw.description) || 'Anchor Point';

          const htmlContent = `
            <div class="tooltip-header">${getIconSvg(faTag)} <span>${desc}</span></div>
            <div class="tooltip-body">
               <div class="tooltip-row">${getIconSvg(faFolderOpenReg)} <span class="tooltip-val">${group}</span></div>
               <div class="tooltip-row">${getIconSvg(faFileCodeReg)} <span class="tooltip-val">${file} : ${line}</span></div>
               ${content ? `<div class="code-block">${content}</div>` : ''}
            </div>
            <div class="tooltip-actions">
                <button class="tooltip-btn" data-action="edit" data-id="${anchorId}">
                    ${getIconSvg(faPenToSquare)} 编辑
                </button>
                <button class="tooltip-btn danger" data-action="delete" data-id="${anchorId}">
                    ${getIconSvg(faTrash)} 删除
                </button>
            </div>
        `;

          tooltip
            .style('opacity', 1)
            .style('pointer-events', 'auto')
            .html(htmlContent)
            .style('left', e.pageX + 20 + 'px')
            .style('top', e.pageY + 10 + 'px');
        })
        .on('mouseleave', () => {
          hoverTimeout.current = window.setTimeout(() => {
            tooltip.style('opacity', 0).style('pointer-events', 'none');
          }, 300);
        });

      const nodeUpdate = nodeEnter.merge(node);
      nodeUpdate.transition(t).attr('transform', (d: TreeNode) => `translate(${d.y},${d.x})`);

      nodeUpdate
        .select('circle.outer')
        .attr('r', (d) => (isGroup(d as TreeNode) ? 11 : 0))
        .style('opacity', 0);

      nodeUpdate
        .select('circle.inner')
        .attr('r', (d) => (isGroup(d as TreeNode) ? 6 : 4))
        .style('fill', (d) => (isGroup(d as TreeNode) ? ((d as TreeNode)._children ? getNodeColor(d as TreeNode) : 'var(--vscode-editor-background)') : getNodeColor(d as TreeNode)));

      nodeUpdate
        .select('.badge')
        .text((d) => ((d as TreeNode)._children ? (d as TreeNode)._children!.length : ''))
        .transition(t)
        .style('opacity', (d) => ((d as TreeNode)._children ? 1 : 0));

      nodeUpdate.select('text.label').text((d) => ((d as TreeNode).data.data ? (d as TreeNode).data.data!.description || (d as TreeNode).data.name : (d as TreeNode).data.name));

      const nodeExit = node
        .exit()
        .transition(t)
        .attr('transform', () => `translate(${source.y},${source.x})`)
        .remove();
      nodeExit.selectAll('circle').attr('r', 1e-6);
      nodeExit.select('text').style('fill-opacity', 1e-6);

      const link = g.selectAll<SVGPathElement, d3.HierarchyLink<TreeNodeData>>('path.link').data(links, (d) => (d.target as TreeNode).id as string);

      const linkEnter = link
        .enter()
        .insert('path', 'g')
        .attr('class', 'link')
        .attr('fill', 'none')
        .style('stroke', (d) => getNodeColor(d.target as TreeNode))
        .attr('d', () => {
          const o = { x: source.x0 || source.x, y: source.y0 || source.y };
          return diagonal({ source: o, target: o } as unknown as d3.HierarchyPointLink<TreeNodeData>);
        });

      link
        .merge(linkEnter)
        .transition(t)
        .attr('d', diagonal as unknown as d3.ValueFn<SVGPathElement, d3.HierarchyLink<TreeNodeData>, string | null>)
        .style('stroke', (d) => getNodeColor(d.target as TreeNode));

      link
        .exit()
        .transition(t)
        .remove()
        .attr('d', () => {
          const o = { x: source.x, y: source.y };
          return diagonal({ source: o, target: o } as unknown as d3.HierarchyPointLink<TreeNodeData>);
        });

      nodes.forEach((d) => {
        d.x0 = d.x;
        d.y0 = d.y;
      });
    }

    function toggle(d: TreeNode) {
      if (d.children) {
        d._children = d.children;
        d.children = undefined;
      } else {
        d.children = d._children;
        d._children = undefined;
      }
    }

    const handleMessage = (event: MessageEvent) => {
      const message = event.data;
      if (message.command === 'refresh' && message.data) {
        d3.select(tooltipRef.current).style('opacity', 0).style('pointer-events', 'none');

        root = d3.hierarchy<TreeNodeData>(message.data) as TreeNode;

        let idx = 0;
        root.descendants().forEach((d) => {
          d.id = String(idx++);
        });

        tree(root);

        root.x0 = root.x;
        root.y0 = root.y;

        centerView(false);
        update(root);
      }
    };

    window.addEventListener('message', handleMessage);
    const handleResize = () => {
      centerView(false);
    };
    window.addEventListener('resize', handleResize);

    vscode?.postMessage({ command: 'ready' });

    return () => {
      window.removeEventListener('message', handleMessage);
      window.removeEventListener('resize', handleResize);
      if (tooltipEl) tooltipEl.removeEventListener('click', handleTooltipClick);
    };
  }, []);

  const handleZoomIn = () => {
    const svgSel = d3.select(containerRef.current).select<SVGSVGElement>('svg');
    (svgSel.transition() as unknown as d3.Selection<SVGSVGElement, unknown, null, undefined>).call(d3.zoom<SVGSVGElement, unknown>().scaleBy, 1.2);
  };

  const handleZoomOut = () => {
    const svgSel = d3.select(containerRef.current).select<SVGSVGElement>('svg');
    (svgSel.transition() as unknown as d3.Selection<SVGSVGElement, unknown, null, undefined>).call(d3.zoom<SVGSVGElement, unknown>().scaleBy, 0.8);
  };

  const handleZoomReset = () => {
    window.dispatchEvent(new Event('resize'));
  };

  const handleRefresh = () => vscode?.postMessage({ command: 'refresh' });

  const handleFullscreen = () => {
    vscode?.postMessage({ command: 'toggleFullscreen' });
    isFullscreen.current = !isFullscreen.current;
  };

  return (
    <div className="anchor-app" style={{ width: '100vw', height: '100vh', position: 'relative', overflow: 'hidden' }}>
      <style>{`
        :root {
            --node-text-color: var(--vscode-editor-foreground);
            --tooltip-bg: var(--vscode-editorHoverWidget-background, #252526);
            --tooltip-border: var(--vscode-editorHoverWidget-border, #454545);
            --code-bg: var(--vscode-textBlockQuote-background, rgba(128,128,128,0.1));
            --accent-color: var(--vscode-textLink-foreground, #3794ff);
        }

        .node circle { transition: all 0.3s ease; }
        .node circle.outer { fill: transparent; stroke-width: 2px; }
        .node circle.inner { stroke-width: 2.5px; }
        .node:hover circle.outer { opacity: 0.4 !important; }

        .node text.label { 
            font: 13.5px "Segoe UI", sans-serif; font-weight: 500; fill: var(--node-text-color); 
            paint-order: stroke; stroke: var(--vscode-editor-background); stroke-width: 3px; stroke-linecap: round; stroke-linejoin: round;
            cursor: pointer;
        }
        .node:hover text.label { fill: var(--vscode-textLink-activeForeground); }
        
        .node text.badge { font: 10px sans-serif; fill: var(--vscode-descriptionForeground); font-weight: bold; pointer-events: none; }

        .link { fill: none; stroke-width: 1.5px; stroke-opacity: 0.5; transition: all 0.3s; }
        .link:hover { stroke-opacity: 1; stroke-width: 2.5px; }

        .tooltip { 
            position: absolute; opacity: 0; pointer-events: none; 
            background: var(--tooltip-bg); border: 1px solid var(--tooltip-border); 
            color: var(--vscode-editorHoverWidget-foreground); 
            padding: 0; border-radius: 6px; font-size: 12px; z-index: 9999; 
            box-shadow: 0 8px 24px rgba(0,0,0,0.25); 
            transition: opacity 0.2s ease-in-out; 
            min-width: 250px; max-width: 500px; 
        }
        .tooltip::before { content: ''; position: absolute; top: -10px; left: -10px; right: -10px; bottom: -10px; z-index: -1; }
        .tooltip-header { 
            background: var(--vscode-sideBarSectionHeader-background); 
            padding: 8px 12px; font-weight: 600; border-bottom: 1px solid var(--vscode-panel-border);
            display: flex; align-items: center; gap: 8px; font-size: 13px;
            border-top-left-radius: 6px; border-top-right-radius: 6px;
        }
        .tooltip-header svg { color: var(--accent-color); font-size: 14px; }
        .tooltip-body { padding: 10px 12px; display: flex; flex-direction: column; gap: 8px; }
        .tooltip-row { display: flex; align-items: center; gap: 8px; color: var(--vscode-descriptionForeground); }
        .tooltip-val { color: var(--vscode-editor-foreground); word-break: break-all; }

        .code-block {
            background: var(--code-bg); padding: 10px; border-radius: 4px;
            font-family: var(--vscode-editor-font-family, 'Courier New', monospace);
            border-left: 3px solid var(--accent-color);
            white-space: pre-wrap; word-break: break-all; font-size: 11px; margin-top: 4px;
            color: var(--vscode-editor-foreground); line-height: 1.4; max-height: 300px; overflow-y: auto;
        }
        
        .tooltip-actions {
            display: flex; gap: 8px; padding: 8px 12px; border-top: 1px dashed var(--vscode-panel-border);
            background: var(--vscode-editorHoverWidget-background);
            border-bottom-left-radius: 6px; border-bottom-right-radius: 6px; justify-content: flex-end;
        }
        .tooltip-btn {
            background: transparent; border: 1px solid var(--vscode-panel-border);
            color: var(--vscode-editor-foreground); border-radius: 4px; padding: 4px 8px;
            cursor: pointer; font-size: 11px; display: flex; align-items: center; gap: 6px; transition: all 0.2s;
        }
        .tooltip-btn:hover { background: var(--vscode-list-hoverBackground); }
        .tooltip-btn.danger:hover { color: var(--vscode-errorForeground); border-color: var(--vscode-errorForeground); }
      `}</style>

      {/* 顶部控制栏 */}
      <div id="controls-top-right" style={{ position: 'absolute', top: 20, right: 20, zIndex: 100, display: 'flex', gap: 10 }}>
        <button className="icon-btn" onClick={handleFullscreen} title={isFullscreen.current ? '恢复默认布局' : '切换编辑器最大化'}>
          <FontAwesomeIcon icon={isFullscreen.current ? faCompress : faExpand} />
        </button>
        <button className="icon-btn" onClick={handleRefresh} title="刷新导图">
          <FontAwesomeIcon icon={faRotateRight} />
        </button>
      </div>

      {/* 底部缩放栏 */}
      <div id="controls-bottom" style={{ position: 'absolute', bottom: 40, left: '50%', transform: 'translateX(-50%)', zIndex: 100, display: 'flex', gap: 12 }}>
        <button className="icon-btn" onClick={handleZoomOut} title="缩小">
          <FontAwesomeIcon icon={faMinus} />
        </button>
        <button className="icon-btn" onClick={handleZoomReset} title="适应视口">
          <FontAwesomeIcon icon={faExpand} />
        </button>
        <button className="icon-btn" onClick={handleZoomIn} title="放大">
          <FontAwesomeIcon icon={faPlus} />
        </button>
      </div>

      {/* D3 SVG 容器 */}
      <div
        id="tree-container"
        ref={containerRef}
        style={{ width: '100%', height: '100%', cursor: 'grab' }}
        onMouseDown={(e) => (e.currentTarget.style.cursor = 'grabbing')}
        onMouseUp={(e) => (e.currentTarget.style.cursor = 'grab')}
      ></div>

      {/* 悬浮提示窗 */}
      <div id="tooltip" ref={tooltipRef} className="tooltip"></div>
    </div>
  );
}
