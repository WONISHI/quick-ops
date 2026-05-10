import { isUrlLike } from "./index"

export default class UrlParser {
  // 识别 Windows 盘符路径 (如 C:\)、Unix 根路径 (如 /)、以及标准的 file:// 协议
  static isAbsolutePath(path: string): boolean {
    return path.toLowerCase().startsWith('file://') || /^(?:[a-zA-Z]:[\\/]+|\/)/.test(path);
  }

  static parse(rawInput: string): string {
    let finalUrl = rawInput.trim();
    if (!finalUrl) return '';

    // 🌟 如果是本地绝对路径或 file:// 协议，直接返回，原封不动
    if (this.isAbsolutePath(finalUrl)) {
      return finalUrl;
    }

    if (isUrlLike(finalUrl)) {
      // file:// 已经在上面被拦截了，这里只需要处理缺省 http 的情况
      if (!finalUrl.startsWith('http://') && !finalUrl.startsWith('https://')) {
        finalUrl = 'http://' + finalUrl;
      }
    } else {
      // 既不是本地文件，又长得不像网址，那就当做关键词去搜索
      finalUrl = 'https://www.bing.com/search?q=' + encodeURIComponent(finalUrl);
    }
    
    return finalUrl;
  }
}