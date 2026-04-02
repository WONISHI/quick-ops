export interface MarkStyle {
  color?: string;
  backgroundColor?: string;
  borderRadius?: string;
  fontWeight?: string;

  /**
   * 左侧细边颜色（荧光边）
   */
  borderColor?: string;

  /**
   * 整行背景透明度色
   */
  wholeLineBackgroundColor?: string;

  /**
   * 左侧 gutter 图标（svg/png）
   */
  gutterIconPath?: string;

  /**
   * 行内标签文字颜色（如 TODO / BLOCKER）
   */
  labelColor?: string;
}