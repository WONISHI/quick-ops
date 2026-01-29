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
  items?: AnchorData[]; 
}

export interface AnchorConfig {
  groups: string[];
  children?: string[]; 
  anchors: AnchorData[];
}
