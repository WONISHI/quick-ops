import type { Edge as ReactFlowEdge, Node as ReactFlowNode } from '@xyflow/react';

export interface AnchorData {
  id: string;
  pid?: string;
  filePath: string;
  line: number;
  content: string;
  group: string;
  description?: string;
  sort?: number;
  timestamp?: number;
  items?: AnchorData[];
}

export interface TreeNodeData {
  name: string;
  id?: string;
  data?: AnchorData;
  children?: TreeNodeData[];
}

/**
 * @description React Flow 节点 data 类型
 */
export interface AnchorFlowNodeData extends Record<string, unknown> {
  treeData: TreeNodeData;
  label: string;
  hasChildren: boolean;
  childCount: number;
  collapsed: boolean;
  colorIndex: number;
  onToggle: (nodeId: string) => void;
  onJump: (data: AnchorData) => void;
}

/**
 * @description React Flow 完整节点类型
 */
export type AnchorFlowNode = ReactFlowNode<AnchorFlowNodeData, 'anchorNode'>;

/**
 * @description React Flow 边类型
 */
export type AnchorFlowEdge = ReactFlowEdge;

export interface TooltipState {
  visible: boolean;
  x: number;
  y: number;
  data: AnchorData | null;
}