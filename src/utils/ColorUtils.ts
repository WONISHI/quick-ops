import * as vscode from 'vscode';

export class ColorUtils {
  // 预定义一组鲜明的颜色 (Hex)
  private static colors = [
    '#e57373', // Red
    '#ba68c8', // Purple
    '#7986cb', // Indigo
    '#4fc3f7', // Light Blue
    '#4db6ac', // Teal
    '#81c784', // Green
    '#fff176', // Yellow
    '#ffb74d', // Orange
    '#a1887f', // Brown
    '#90a4ae', // Blue Grey
  ];

  // 预定义一组对应的 Emoji (用于 CodeLens 文本显示)
  private static emojis = ['🎯', '🧹', '✏️', '📝', '📋', '💾', '🔍', '⚙️', '🗑️', '🐫', '🐪', '🐍', '📌', '⭐', '🧪', '🚀', '⏳'];

  /**
   * 根据字符串计算哈希值，返回一个固定的索引
   */
  private static getHashIndex(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    // 取绝对值并取模
    const index = Math.abs(hash) % this.colors.length;
    return index;
  }

  /**
   * 获取分组对应的 Hex 颜色
   */
  public static getColor(group: string): string {
    return this.colors[this.getHashIndex(group)];
  }

  /**
   * 获取分组对应的 Emoji 图标
   */
  public static getEmoji(group: string): string {
    return this.emojis[this.getHashIndex(group)];
  }

  /**
   * 生成一个 SVG 圆点的 Data URI (用于 Gutter 装饰)
   */
  public static getSvgDotUri(color: string): vscode.Uri {
    const svg = `
      <svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
        <circle cx="8" cy="8" r="5" fill="${color}" />
      </svg>
    `;
    const encoded = Buffer.from(svg).toString('base64');
    return vscode.Uri.parse(`data:image/svg+xml;base64,${encoded}`);
  }
}
