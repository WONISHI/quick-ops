class ColorLog {
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

export default class ColorLogPlugin {
  public init() {
    return {
      pluginId: 'color-log-plugin',
      on: [
        {
          name: 'ready',
          callback: () => ColorLog.black('[QuickOps]', 'Application Starting...'),
        },
        {
          name: 'readied',
          callback: () => ColorLog.black('[QuickOps]', 'Application started successfully.'),
        },
        {
          name: 'disposed',
          callback: () => ColorLog.red('[QuickOps]', 'Application Disposed.'),
        },
        {
          name: 'moduleInitReadied',
          callback: (moduleName: any, instance: any) => {
            const id = instance.id;
            ColorLog.black(`[${id}]`, 'Activated.');
          },
        },
      ],
    };
  }
}
