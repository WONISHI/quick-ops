export function generateUUID(length: number = 32): string {
  const chars = '0123456789abcdef'; // 十六进制字符
  let uuid = '';
  for (let i = 0; i < length; i++) {
    const randomIndex = Math.floor(Math.random() * chars.length);
    uuid += chars[randomIndex];
  }
  return uuid;
}

export function getVisualColumn(text: string, character: number): number {
    let col = 0;
    for (let i = 0; i < character; i++) {
        const ch = text[i];
        if (/[\uD800-\uDBFF]/.test(ch)) {
            continue;
        }
        col++;
    }
    return col;
}
