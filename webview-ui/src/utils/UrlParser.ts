import { isUrlLike } from "./index";
export default class UrlParser {
  static isAbsolutePath(path: string): boolean {
    const lowerPath = path.toLowerCase();
    if (lowerPath.startsWith('file://')) {
      return true;
    }
    return /^(?:[a-zA-Z]:[\\/]+|[a-zA-Z]%3a[\\/]+|^\/)/i.test(lowerPath);
  }

  static parse(rawInput: string): string {
    let finalUrl = rawInput.trim();
    if (!finalUrl) return '';
    if (this.isAbsolutePath(finalUrl)) {
      return finalUrl;
    }

    if (isUrlLike(finalUrl)) {
      if (!finalUrl.startsWith('http://') && !finalUrl.startsWith('https://')) {
        finalUrl = 'http://' + finalUrl;
      }
    } else {
      finalUrl = 'https://www.bing.com/search?q=' + encodeURIComponent(finalUrl);
    }
    
    return finalUrl;
  }
}