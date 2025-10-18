import * as vscode from 'vscode';

export default class VSCodeNotifier {
  static info(message: string, duration?: number) {
    return this.show('info', message, duration);
  }

  static warn(message: string, duration?: number) {
    return this.show('warn', message, duration);
  }

  static error(message: string, duration?: number) {
    return this.show('error', message, duration);
  }

  private static show(type: 'info' | 'warn' | 'error', message: string, duration?: number) {
    let disposable: vscode.Disposable;

    switch (type) {
      case 'info':
        disposable = vscode.window.setStatusBarMessage(`ℹ️ ${message}`);
        break;
      case 'warn':
        disposable = vscode.window.setStatusBarMessage(`⚠️ ${message}`);
        break;
      case 'error':
        disposable = vscode.window.setStatusBarMessage(`❌ ${message}`);
        break;
    }

    if (duration) {
      const timer = setTimeout(() => {
        disposable.dispose();
        clearTimeout(timer);
      }, duration);
    }

    return disposable;
  }
}
