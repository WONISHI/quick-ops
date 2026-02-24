export default class ColorLog {
  static black(prefix: string, content: string) {
    console.log(`%c${prefix}%c: ${content}`, 'background: black; color: white; padding: 2px 4px; border-radius: 3px;', '');
  }

  static orange(prefix: string, content: string) {
    console.log(`%c${prefix}%c: ${content}`, 'background: orange; color: white; padding: 2px 4px; border-radius: 3px;', '');
  }

  static red(prefix: string, content: string) {
    console.log(`%c${prefix}%c: ${content}`, 'background: red; color: white; padding: 2px 4px; border-radius: 3px;', '');
  }

  static green(prefix: string, content: string) {
    console.log(`%c${prefix}%c: ${content}`, 'background: green; color: white; padding: 2px 4px; border-radius: 3px;', '');
  }
}
