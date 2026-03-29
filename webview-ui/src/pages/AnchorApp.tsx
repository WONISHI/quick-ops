import React, { useEffect, useRef } from 'react';
import * as d3 from 'd3';
import '../assets/css/AnchorApp.css'; 
import { vscode } from '../utils/vscode';

export default function AnchorApp() {
  const containerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    // 1. 初始化基础变量
    let i = 0; // 用于给节点分配唯一 ID
    let root: any; // 树的根节点数据
    
    const width = containerRef.current.clientWidth;
    const height = containerRef.current.clientHeight;
    
    const colorScale = d3.scaleOrdinal(d3.schemeSet2);
    
    // 初始化缩放行为
    const zoom = d3.zoom().scaleExtent([0.1, 4]).on("zoom", (e) => {
      g.attr("transform", e.transform);
    });

    // 初始化 SVG 容器
    const svg = d3.select(containerRef.current)
      .append("svg")
      .attr("width", "100%")
      .attr("height", "100%")
      .call(zoom as any)
      .on("dblclick.zoom", null); // 禁用双击缩放，以免误触

    const g = svg.append("g");
    
    // 初始化树布局 (节点垂直间距 35, 水平间距 260)
    const tree = d3.tree().nodeSize([35, 260]);

    // 定义对角线生成器 (用于平滑的贝塞尔曲线)
    const diagonal = d3.linkHorizontal().x((d: any) => d.y).y((d: any) => d.x);

    // 🌟 核心：D3 的数据更新与动画逻辑
    function update(source: any) {
      if (!root) return;

      // 计算新的树布局
      const nodes = root.descendants();
      const links = root.links();
      tree(root);

      // 定义统一的过渡动画 (500毫秒)
      const transition = svg.transition().duration(500) as any;

      // ================= 节点 (Nodes) =================
      const node = g.selectAll<SVGGElement, any>("g.node")
        .data(nodes, (d: any) => d.id || (d.id = ++i));

      // ENTER: 新增节点
      const nodeEnter = node.enter().append("g")
        .attr("class", "node")
        .attr("transform", () => `translate(${source.y0},${source.x0})`) // 从父节点位置出生
        .attr("fill-opacity", 0)
        .attr("stroke-opacity", 0);

      // 绘制圆点
      nodeEnter.append("circle")
        .attr("class", "inner")
        .attr("r", 5)
        .style("fill", (d: any) => d._children ? "#555" : colorScale(d.depth.toString()))
        .on("click", (event, d: any) => {
          // 点击展开/折叠
          if (d.children) {
            d._children = d.children;
            d.children = null;
          } else {
            d.children = d._children;
            d._children = null;
          }
          update(d); // 以当前节点为源点触发重绘
        });

      // 绘制文字标签
      nodeEnter.append("text")
        .attr("class", "label")
        .attr("dy", 4)
        .attr("x", (d: any) => d._children ? -12 : 12)
        .attr("text-anchor", (d: any) => d._children ? "end" : "start")
        .text((d: any) => d.data.name)
        .on("click", (event, d: any) => {
          // 点击文字跳转代码
          if (d.data.data) {
            vscode?.postMessage({ command: 'jump', data: d.data.data });
          }
        });

      // 🌟 悬浮窗 (Tooltip) 逻辑
      nodeEnter.on("mouseover", (event, d: any) => {
        const tooltip = d3.select(tooltipRef.current);
        tooltip.transition().duration(200).style("opacity", 1);
        
        // 组装 HTML
        const lineHtml = d.data.data?.line ? `<div>行号: ${d.data.data.line}</div>` : '';
        const contextHtml = d.data.data?.context ? `<div class="code-block">${d.data.data.context}</div>` : '';
        
        tooltip.html(`
          <div class="tooltip-header">📍 ${d.data.name}</div>
          <div class="tooltip-body">
            ${lineHtml}
            ${contextHtml || '<div>暂无代码上下文</div>'}
          </div>
        `)
        .style("left", (event.pageX + 15) + "px")
        .style("top", (event.pageY - 20) + "px");
      })
      .on("mouseout", () => {
        d3.select(tooltipRef.current).transition().duration(300).style("opacity", 0);
      });

      // UPDATE: 更新现有节点位置
      const nodeUpdate = node.merge(nodeEnter).transition(transition)
        .attr("transform", (d: any) => `translate(${d.y},${d.x})`)
        .attr("fill-opacity", 1)
        .attr("stroke-opacity", 1);

      // EXIT: 移除不需要的节点 (收到父节点里去)
      node.exit().transition(transition).remove()
        .attr("transform", () => `translate(${source.y},${source.x})`)
        .attr("fill-opacity", 0)
        .attr("stroke-opacity", 0);


      // ================= 连线 (Links) =================
      const link = g.selectAll<SVGPathElement, any>("path.link")
        .data(links, (d: any) => d.target.id);

      // ENTER: 新增连线
      const linkEnter = link.enter().insert("path", "g")
        .attr("class", "link")
        .attr("d", () => {
          const o = { x: source.x0, y: source.y0 };
          return diagonal({ source: o, target: o } as any); // 从父节点的一个点开始展开
        });

      // UPDATE: 更新现有连线
      link.merge(linkEnter).transition(transition)
        .attr("d", diagonal as any);

      // EXIT: 移除不需要的连线
      link.exit().transition(transition).remove()
        .attr("d", () => {
          const o = { x: source.x, y: source.y };
          return diagonal({ source: o, target: o } as any); // 缩回到父节点
        });

      // 记录下当前节点位置，供下一次动画参考
      nodes.forEach((d: any) => {
        d.x0 = d.x;
        d.y0 = d.y;
      });
    }

    // 处理接收到的数据
    const handleMessage = (event: MessageEvent) => {
      const message = event.data;
      if (message.command === 'refresh' && message.data) {
        root = d3.hierarchy(message.data);
        // 初始化根节点位置为画布左侧中间
        root.x0 = height / 2;
        root.y0 = 0;
        
        update(root);
        
        // 初始加载时将图表平移到合适位置
        svg.transition().duration(500).call(
          zoom.transform as any, 
          d3.zoomIdentity.translate(80, height / 2)
        );
      }
    };
    
    window.addEventListener('message', handleMessage);

    // 处理窗口大小变化
    const handleResize = () => {
      svg.attr("width", containerRef.current?.clientWidth || 0)
         .attr("height", containerRef.current?.clientHeight || 0);
    };
    window.addEventListener('resize', handleResize);

    // 通知 VS Code 可以发送数据了
    vscode?.postMessage({ command: 'ready' });

    // 组件卸载时的清理
    return () => {
      window.removeEventListener('message', handleMessage);
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  const handleZoomIn = () => d3.select(containerRef.current).select('svg').transition().call(d3.zoom().scaleBy as any, 1.2);
  const handleZoomOut = () => d3.select(containerRef.current).select('svg').transition().call(d3.zoom().scaleBy as any, 0.8);
  const handleRefresh = () => vscode?.postMessage({ command: 'refresh' });
  const handleFullscreen = () => vscode?.postMessage({ command: 'toggleFullscreen' });

  return (
    <div className="anchor-app" style={{ width: '100vw', height: '100vh', position: 'relative', overflow: 'hidden' }}>
      {/* 顶部控制栏 */}
      <div id="controls-top-right" style={{ position: 'absolute', top: 20, right: 20, zIndex: 100, display: 'flex', gap: 10 }}>
        <button className="icon-btn" onClick={handleFullscreen} title="切换全屏">
          <i className="fa-solid fa-expand"></i>
        </button>
        <button className="icon-btn" onClick={handleRefresh} title="刷新导图">
          <i className="fa-solid fa-rotate-right"></i>
        </button>
      </div>

      {/* 底部缩放栏 */}
      <div id="controls-bottom" style={{ position: 'absolute', bottom: 40, left: '50%', transform: 'translateX(-50%)', zIndex: 100, display: 'flex', gap: 12 }}>
        <button className="icon-btn" onClick={handleZoomOut} title="缩小">
          <i className="fa-solid fa-minus"></i>
        </button>
        <button className="icon-btn" onClick={handleZoomIn} title="放大">
          <i className="fa-solid fa-plus"></i>
        </button>
      </div>

      {/* D3 SVG 容器 */}
      <div id="tree-container" ref={containerRef} style={{ width: '100%', height: '100%' }}></div>
      
      {/* 悬浮提示窗 */}
      <div id="tooltip" ref={tooltipRef} className="tooltip"></div>
    </div>
  );
}