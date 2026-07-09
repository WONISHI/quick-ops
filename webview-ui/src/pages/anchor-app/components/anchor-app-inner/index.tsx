import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Background, Controls, ReactFlow, useReactFlow } from '@xyflow/react';
import { vscode } from '@utils/vscode';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCompress, faExpand, faMinus, faPenToSquare, faPlus, faRotateRight, faTag, faTrash } from '@fortawesome/free-solid-svg-icons';
import { faFileCode as faFileCodeReg, faFolderOpen as faFolderOpenReg } from '@fortawesome/free-regular-svg-icons';
import AnchorNode from '@pages/anchor-app/components/anchor-node';
import { createFlowData, getNodeRawData } from '@pages/anchor-app/src/flow';
import styles from '@pages/anchor-app/index.module.css';
import type { MouseEvent } from 'react';
import type { NodeTypes } from '@xyflow/react';
import type { AnchorData, AnchorFlowEdge, AnchorFlowNode, TooltipState, TreeNodeData } from '@pages/anchor-app/src/type';

const nodeTypes = {
  anchorNode: AnchorNode,
} as NodeTypes;

export default function AnchorAppInner() {
  const { fitView, zoomIn, zoomOut } = useReactFlow<AnchorFlowNode, AnchorFlowEdge>();

  const [mindMapData, setMindMapData] = useState<TreeNodeData | null>(null);
  const [collapsedMap, setCollapsedMap] = useState<Record<string, boolean>>({});
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [tooltip, setTooltip] = useState<TooltipState>({
    visible: false,
    x: 0,
    y: 0,
    data: null,
  });

  const tooltipTimerRef = useRef<number | undefined>(undefined);

  const clearTooltipTimer = useCallback((): void => {
    if (tooltipTimerRef.current) {
      window.clearTimeout(tooltipTimerRef.current);
      tooltipTimerRef.current = undefined;
    }
  }, []);

  const handleToggle = useCallback((nodeId: string): void => {
    setCollapsedMap((prev) => ({
      ...prev,
      [nodeId]: !prev[nodeId],
    }));
  }, []);

  const handleJump = useCallback((data: AnchorData): void => {
    vscode?.postMessage({
      command: 'jump',
      data,
    });
  }, []);

  const handleHideTooltip = useCallback((): void => {
    clearTooltipTimer();

    tooltipTimerRef.current = window.setTimeout(() => {
      setTooltip((prev) => ({
        ...prev,
        visible: false,
      }));
    }, 220);
  }, [clearTooltipTimer]);

  const flowData = useMemo(() => {
    return createFlowData(mindMapData, collapsedMap, {
      onToggle: handleToggle,
      onJump: handleJump,
    });
  }, [mindMapData, collapsedMap, handleToggle, handleJump]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent): void => {
      const message = event.data;

      if (message.command === 'refresh' && message.data) {
        setTooltip((prev) => ({
          ...prev,
          visible: false,
        }));
        setMindMapData(message.data);
      }
    };

    window.addEventListener('message', handleMessage);

    vscode?.postMessage({
      command: 'ready',
    });

    return () => {
      window.removeEventListener('message', handleMessage);
      clearTooltipTimer();
    };
  }, [clearTooltipTimer]);

  useEffect(() => {
    if (flowData.nodes.length === 0) return;

    const timer = window.setTimeout(() => {
      fitView({
        padding: 0.18,
        duration: 350,
      });
    }, 60);

    return () => {
      window.clearTimeout(timer);
    };
  }, [flowData.nodes.length, fitView]);

  const handleRefresh = (): void => {
    vscode?.postMessage({
      command: 'refresh',
    });
  };

  const handleFullscreen = (): void => {
    vscode?.postMessage({
      command: 'toggleFullscreen',
    });

    setIsFullscreen((prev) => !prev);
  };

  const handleFitView = (): void => {
    fitView({
      padding: 0.18,
      duration: 350,
    });
  };

  const handleAnchorAction = (action: 'edit' | 'delete'): void => {
    if (!tooltip.data?.id) return;

    vscode?.postMessage({
      command: 'anchorAction',
      action,
      anchorId: tooltip.data.id,
    });

    setTooltip((prev) => ({
      ...prev,
      visible: false,
    }));
  };

  const handleNodeMouseEnter = useCallback(
    (event: MouseEvent, node: AnchorFlowNode): void => {
      const raw = getNodeRawData(node.data.treeData);

      if (!raw) return;

      clearTooltipTimer();

      setTooltip({
        visible: true,
        x: event.clientX + 18,
        y: event.clientY + 12,
        data: raw,
      });
    },
    [clearTooltipTimer],
  );

  const handleNodeMouseMove = useCallback(
    (event: MouseEvent, node: AnchorFlowNode): void => {
      const raw = getNodeRawData(node.data.treeData);

      if (!raw) return;

      clearTooltipTimer();

      setTooltip({
        visible: true,
        x: event.clientX + 18,
        y: event.clientY + 12,
        data: raw,
      });
    },
    [clearTooltipTimer],
  );

  const handleNodeMouseLeave = useCallback((): void => {
    handleHideTooltip();
  }, [handleHideTooltip]);

  const handleTooltipMouseEnter = (): void => {
    clearTooltipTimer();
  };

  const handleTooltipMouseLeave = (): void => {
    handleHideTooltip();
  };

  const fileName = tooltip.data?.filePath ? tooltip.data.filePath.split(/[\\/]/).pop() || tooltip.data.filePath : 'Unknown File';

  return (
    <div className={styles.appWrapper}>
      <div className={styles.topControls}>
        <button className={styles.iconBtn} onClick={handleFullscreen} title={isFullscreen ? '恢复默认布局' : '切换编辑器最大化'}>
          <FontAwesomeIcon icon={isFullscreen ? faCompress : faExpand} />
        </button>

        <button className={styles.iconBtn} onClick={handleRefresh} title="刷新导图">
          <FontAwesomeIcon icon={faRotateRight} />
        </button>
      </div>

      <div className={styles.bottomControls}>
        <button className={styles.iconBtn} onClick={() => zoomOut({ duration: 200 })} title="缩小">
          <FontAwesomeIcon icon={faMinus} />
        </button>

        <button className={styles.iconBtn} onClick={handleFitView} title="适应视口">
          <FontAwesomeIcon icon={faExpand} />
        </button>

        <button className={styles.iconBtn} onClick={() => zoomIn({ duration: 200 })} title="放大">
          <FontAwesomeIcon icon={faPlus} />
        </button>
      </div>

      <ReactFlow<AnchorFlowNode, AnchorFlowEdge>
        className={styles.treeContainer}
        nodes={flowData.nodes}
        edges={flowData.edges}
        nodeTypes={nodeTypes}
        fitView
        minZoom={0.1}
        maxZoom={4}
        nodesDraggable
        nodesConnectable={false}
        elementsSelectable
        onNodeMouseEnter={handleNodeMouseEnter}
        onNodeMouseMove={handleNodeMouseMove}
        onNodeMouseLeave={handleNodeMouseLeave}
        proOptions={{
          hideAttribution: true,
        }}
      >
        <Background gap={18} size={1} />
        <Controls showInteractive={false} position="bottom-right" />
      </ReactFlow>

      {flowData.nodes.length === 0 && <div className={styles.empty}>暂无锚点数据</div>}

      {tooltip.visible && tooltip.data && (
        <div
          className={styles.tooltip}
          style={{
            left: tooltip.x,
            top: tooltip.y,
          }}
          onMouseEnter={handleTooltipMouseEnter}
          onMouseLeave={handleTooltipMouseLeave}
        >
          <div className={styles.tooltipHeader}>
            <FontAwesomeIcon icon={faTag} />
            <span>{tooltip.data.description || 'Anchor Point'}</span>
          </div>

          <div className={styles.tooltipBody}>
            <div className={styles.tooltipRow}>
              <FontAwesomeIcon icon={faFolderOpenReg} />
              <span className={styles.tooltipVal}>{tooltip.data.group || 'Default'}</span>
            </div>

            <div className={styles.tooltipRow}>
              <FontAwesomeIcon icon={faFileCodeReg} />
              <span className={styles.tooltipVal}>
                {fileName} : {tooltip.data.line || '?'}
              </span>
            </div>

            {tooltip.data.content && <pre className={styles.codeBlock}>{tooltip.data.content.trim()}</pre>}
          </div>

          <div className={styles.tooltipActions}>
            <button className={styles.tooltipBtn} onClick={() => handleAnchorAction('edit')}>
              <FontAwesomeIcon icon={faPenToSquare} />
              编辑
            </button>

            <button className={`${styles.tooltipBtn} ${styles.danger}`} onClick={() => handleAnchorAction('delete')}>
              <FontAwesomeIcon icon={faTrash} />
              删除
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
