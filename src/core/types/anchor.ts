export interface AnchorData {
  filePath: string;
  line: number;
  content: string;
  group: string;
  id: string;
  timestamp: number;
  description?: string;
  sort?: string;
  items?: AnchorData[];
}

export interface AnchorConfig {
  groups: string[];
  'items-group'?: string[];
  anchors: AnchorData[];
}
