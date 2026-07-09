import dagre from 'dagre';
import { MarkerType, Position } from '@xyflow/react';
import { NODE_HEIGHT, NODE_WIDTH, colorList } from '@pages/anchor-app/src/constants';
import type { AnchorData, AnchorFlowEdge, AnchorFlowNode, AnchorFlowNodeData, TreeNodeData } from '@pages/anchor-app/src/type';

/**
 * @description 获取节点绑定的锚点数据
 */
export function getNodeRawData(node: TreeNodeData): AnchorData | undefined {
  return node.data;
}

/**
 * @description 生成 React Flow 节点 ID
 */
export function getNodeId(node: TreeNodeData, path: string[]): string {
  const raw = getNodeRawData(node);

  if (raw?.id) {
    return `anchor:${raw.id}`;
  }

  return `group:${path.join('/') || 'root'}`;
}

/**
 * @description 获取节点显示名称
 */
export function getNodeLabel(node: TreeNodeData): string {
  const raw = getNodeRawData(node);

  if (raw) {
    return raw.description || node.name || 'Anchor';
  }

  return node.name || 'Group';
}

/**
 * @description 根据一级分组生成颜色索引
 */
export function getColorIndex(path: string[]): number {
  if (path.length <= 1) return 0;

  const key = path[1] || path[0] || 'root';
  let hash = 0;

  for (let index = 0; index < key.length; index++) {
    hash = (hash << 5) - hash + key.charCodeAt(index);
    hash |= 0;
  }

  return Math.abs(hash) % colorList.length;
}

/**
 * @description 将树形锚点数据转换成 React Flow nodes / edges
 */
export function createFlowData(
  root: TreeNodeData | null,
  collapsedMap: Record<string, boolean>,
  handlers: Pick<AnchorFlowNodeData, 'onToggle' | 'onJump'>,
): {
  nodes: AnchorFlowNode[];
  edges: AnchorFlowEdge[];
} {
  if (!root) {
    return {
      nodes: [],
      edges: [],
    };
  }

  const nodes: AnchorFlowNode[] = [];
  const edges: AnchorFlowEdge[] = [];

  const walk = (node: TreeNodeData, path: string[], parentId?: string): void => {
    const nodeId = getNodeId(node, path);
    const children = node.children || [];
    const hasChildren = children.length > 0;
    const collapsed = !!collapsedMap[nodeId];
    const colorIndex = getColorIndex(path);

    nodes.push({
      id: nodeId,
      type: 'anchorNode',
      position: {
        x: 0,
        y: 0,
      },
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      data: {
        treeData: node,
        label: getNodeLabel(node),
        hasChildren,
        childCount: children.length,
        collapsed,
        colorIndex,
        ...handlers,
      },
    });

    if (parentId) {
      edges.push({
        id: `${parentId}->${nodeId}`,
        source: parentId,
        target: nodeId,
        type: 'smoothstep',
        markerEnd: {
          type: MarkerType.ArrowClosed,
          width: 14,
          height: 14,
        },
        style: {
          strokeWidth: 1.5,
          stroke: colorList[colorIndex],
        },
      });
    }

    if (!collapsed) {
      children.forEach((child, index) => {
        walk(child, [...path, `${child.name || 'node'}-${index}`], nodeId);
      });
    }
  };

  walk(root, [root.name || 'root']);

  return layoutFlow(nodes, edges);
}

/**
 * @description 使用 dagre 自动计算思维导图布局
 */
export function layoutFlow(
  nodes: AnchorFlowNode[],
  edges: AnchorFlowEdge[],
): {
  nodes: AnchorFlowNode[];
  edges: AnchorFlowEdge[];
} {
  const graph = new dagre.graphlib.Graph();

  graph.setDefaultEdgeLabel(() => ({}));
  graph.setGraph({
    rankdir: 'LR',
    nodesep: 34,
    ranksep: 110,
    marginx: 40,
    marginy: 40,
  });

  nodes.forEach((node) => {
    graph.setNode(node.id, {
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
    });
  });

  edges.forEach((edge) => {
    graph.setEdge(edge.source, edge.target);
  });

  dagre.layout(graph);

  return {
    nodes: nodes.map((node) => {
      const layoutNode = graph.node(node.id);

      return {
        ...node,
        position: {
          x: layoutNode.x - NODE_WIDTH / 2,
          y: layoutNode.y - NODE_HEIGHT / 2,
        },
      };
    }),
    edges,
  };
}
