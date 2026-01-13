export function generateUUID(length: number = 32): string {
  const chars = '0123456789abcdef'; // 十六进制字符
  let uuid = '';
  for (let i = 0; i < length; i++) {
    const randomIndex = Math.floor(Math.random() * chars.length);
    uuid += chars[randomIndex];
  }
  return uuid;
}

