export interface AnchorData {
  id: string;
  filePath: string;
  line: number;
  content: string;
  group: string;
  timestamp: number;
  description?: string;
  pid?: string;
  sort: number | undefined;
  items?: AnchorData[]; // 🔥 嵌套结构
}

export interface AnchorConfig {
  groups: string[];
  children?: string[]; // 🔥 对应 itemGroups
  anchors: AnchorData[];
}
