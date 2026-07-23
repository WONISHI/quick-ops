import { COLOR_LOG_STYLE_MAP } from '@plugins/color-log/type';
import type { ColorLogType, ModuleInstanceLike } from '@plugins/color-log/type';

class ColorLog {
  /**
   * @description 日志标签公共样式
   */
  private static readonly commonStyle = ['color: #ffffff', 'padding: 2px 6px', 'border-radius: 3px', 'font-weight: 500'].join(';');

  /**
   * @description 输出带颜色前缀的日志
   */
  private static print(type: ColorLogType, prefix: string, content: string): void {
    const backgroundStyle = COLOR_LOG_STYLE_MAP[type];

    console.log(`%c${prefix}%c ${content}`, `${backgroundStyle}${this.commonStyle};`, '');
  }

  public static black(prefix: string, content: string): void {
    this.print('black', prefix, content);
  }

  public static orange(prefix: string, content: string): void {
    this.print('orange', prefix, content);
  }

  public static red(prefix: string, content: string): void {
    this.print('red', prefix, content);
  }

  public static green(prefix: string, content: string): void {
    this.print('green', prefix, content);
  }
}

/**
 * @description ETI 生命周期彩色日志插件
 *
 * 监听：
 * - ready：应用开始启动
 * - readied：应用启动完成
 * - disposed：应用已销毁
 * - moduleInitReadied：模块初始化完成
 */
export default class ColorLogPlugin {
  public readonly pluginId = 'color-log-plugin';

  /**
   * @description 注册生命周期监听
   */
  public init() {
    return {
      pluginId: this.pluginId,
      on: [
        {
          name: 'ready',
          callback: () => {
            ColorLog.black('[QuickOps]', 'Application Starting...');
          },
        },
        {
          name: 'readied',
          callback: () => {
            ColorLog.green('[QuickOps]', 'Application started successfully.');
          },
        },
        {
          name: 'disposed',
          callback: () => {
            ColorLog.red('[QuickOps]', 'Application Disposed.');
          },
        },
        {
          name: 'moduleInitReadied',
          callback: (moduleName: string, instance?: ModuleInstanceLike) => {
            const id = instance?.id || moduleName || instance?.constructor?.name || 'UnknownModule';

            ColorLog.black(`[${id}]`, 'Activated.');
          },
        },
      ],
    };
  }
}
