export interface AnchorData {
  id: string;
  group: string;
  filePath: string;
  line: number;
  content: string;
  description: string;
}

export interface TreeNodeData {
  name: string;
  children?: TreeNodeData[];
  data?: AnchorData;
}

export interface TreeNode extends d3.HierarchyPointNode<TreeNodeData> {
  id?: string;
  x0?: number;
  y0?: number;
  _children?: TreeNode[] | undefined;
}


export type IconTuple = [number, number, string[], string, string];