export interface AnchorData {
  id: string; // 唯一标识
  filePath: string; // 文件路径 (相对路径)
  line: number; // 行号 (0-based)
  content: string; // 代码内容摘要
  group: string; // 分组名称
  timestamp: number; // 创建时间
  description?: string;
}

export interface AnchorConfig {
  groups: string[]; // 所有分组
  anchors: AnchorData[]; // 所有锚点
}
