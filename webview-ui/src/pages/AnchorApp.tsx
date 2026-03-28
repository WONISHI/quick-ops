import React, { useEffect, useRef } from 'react';
import * as d3 from 'd3';
import '../assets/css/AnchorApp.css'; // 将原 HTML 里的 CSS 复制到这个文件里

const vscode = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : null;

export default function AnchorApp() {
  const containerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let svg: any, g: any, zoom: any, tree: any, root: any;
    const colorScale = d3.scaleOrdinal(d3.schemeSet2);

    // 初始化 D3 容器
    if (containerRef.current && !svg) {
      zoom = d3.zoom().scaleExtent([0.1, 4]).on("zoom", (e) => {
        if (g) g.attr("transform", e.transform);
      });

      svg = d3.select(containerRef.current)
        .append("svg")
        .attr("width", "100%")
        .attr("height", "100%")
        .call(zoom)
        .on("dblclick.zoom", null);

      g = svg.append("g");
      tree = d3.tree().nodeSize([35, 260]);
    }

    // 监听 VSCode 数据
    const handleMessage = (event: MessageEvent) => {
      const message = event.data;
      if (message.command === 'refresh' && message.data) {
        renderTree(message.data);
      }
    };
    window.addEventListener('message', handleMessage);

    // 告诉 VSCode 准备好了
    vscode?.postMessage({ command: 'ready' });

    function renderTree(data: any) {
      if (!data || !data.children) return;
      g.selectAll("*").remove();

      root = d3.hierarchy(data);
      let i = 0;
      root.descendants().forEach((d: any) => { d.id = i++; });

      const nodes = root.descendants();
      const links = root.links();
      tree(root);

      // ... 复制你原来 initData 和 update 里面的全部 d3.select 和 enter() 逻辑 ...
      // 这里仅展示核心绑定逻辑，你可以直接将原本 `update(source)` 里的核心代码贴进来。
      const node = g.selectAll(".node").data(nodes, (d: any) => d.id);
      const nodeEnter = node.enter().append("g").attr("class", "node")
        .attr("transform", (d: any) => `translate(${d.y},${d.x})`);

      nodeEnter.append("circle").attr("class", "inner").attr("r", 5)
        .style("fill", (d: any) => colorScale(d.depth.toString()))
        .on("click", (e: any, d: any) => {
          if (d.children) { d._children = d.children; d.children = null; } 
          else { d.children = d._children; d._children = null; }
          renderTree(data); // 简易重绘
        });

      nodeEnter.append("text").attr("class", "label").attr("dy", 5).attr("x", 14)
        .text((d: any) => d.data.name)
        .on("click", (e: any, d: any) => {
          if (d.data.data) vscode?.postMessage({ command: 'jump', data: d.data.data });
        });

      const link = g.selectAll(".link").data(links, (d: any) => d.target.id);
      link.enter().insert("path", "g").attr("class", "link")
        .attr("d", d3.linkHorizontal().x((d: any) => d.y).y((d: any) => d.x));
    }

    return () => {
      window.removeEventListener('message', handleMessage);
    };
  }, []);

  const handleZoomIn = () => d3.select(containerRef.current).select('svg').transition().call(d3.zoom().scaleBy as any, 1.2);
  const handleZoomOut = () => d3.select(containerRef.current).select('svg').transition().call(d3.zoom().scaleBy as any, 0.8);
  const handleRefresh = () => vscode?.postMessage({ command: 'refresh' });
  const handleFullscreen = () => vscode?.postMessage({ command: 'toggleFullscreen' });

  return (
    <div className="anchor-app" style={{ width: '100vw', height: '100vh', position: 'relative', overflow: 'hidden' }}>
      <div id="controls-top-right" style={{ position: 'absolute', top: 20, right: 20, zIndex: 100, display: 'flex', gap: 10 }}>
        <button className="icon-btn" onClick={handleFullscreen}><i className="fa-solid fa-expand"></i></button>
        <button className="icon-btn" onClick={handleRefresh}><i className="fa-solid fa-rotate-right"></i></button>
      </div>

      <div id="controls-bottom" style={{ position: 'absolute', bottom: 40, left: '50%', transform: 'translateX(-50%)', zIndex: 100, display: 'flex', gap: 12 }}>
        <button className="icon-btn" onClick={handleZoomOut}><i className="fa-solid fa-minus"></i></button>
        <button className="icon-btn" onClick={handleZoomIn}><i className="fa-solid fa-plus"></i></button>
      </div>

      <div id="tree-container" ref={containerRef} style={{ width: '100%', height: '100%' }}></div>
      <div id="tooltip" ref={tooltipRef} className="tooltip"></div>
    </div>
  );
}