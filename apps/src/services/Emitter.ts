import * as vscode from 'vscode';
import { generateUUID } from '../utils/index';

/**
 * 通道结构
 */
export interface Channel<T = any> {
  emitter: vscode.EventEmitter<T>;
  event: vscode.Event<T>;
  id: string;
}

/**
 * 全局多通道事件总线（静态类）
 */
export default class EventBus {
  // 每个 channel 对应一个 { emitter, event }
  private static events: Map<string, Channel<any>> = new Map();

  /**
   * 获取某个通道的事件（懒加载）
   * @param channel 通道名
   */
  public static getInstance<T>(channel: string): Channel<T> {
    let channelObj = this.events.get(channel) as Channel<T> | undefined;
    if (!channelObj) {
      const emitter = new vscode.EventEmitter<T>();
      channelObj = { emitter, event: emitter.event, id: generateUUID(12) };
      this.events.set(channel, channelObj);
    }
    return channelObj;
  }

  /**
   * 订阅某个通道事件
   * @param channel 通道名
   * @param listener 回调
   */
  public static subscribe<T>(channel: string, listener: (data: T) => void): vscode.Disposable {
    let channelObj = this.events.get(channel) as Channel<T> | undefined;
    if (!channelObj) {
      const emitter = new vscode.EventEmitter<T>();
      channelObj = { emitter, event: emitter.event, id: generateUUID(12) };
      this.events.set(channel, channelObj);
    }
    return channelObj.event(listener);
  }

  /**
   * 触发事件
   * @param channel 通道名
   * @param data 数据
   */
  public static fire<T>(channel: string, data: T) {
    let channelObj = this.events.get(channel) as Channel<T> | undefined;
    if (!channelObj) {
      const emitter = new vscode.EventEmitter<T>();
      channelObj = { emitter, event: emitter.event, id: generateUUID(12) };
      this.events.set(channel, channelObj);
    }
    channelObj.emitter.fire(data);
  }

  /**
   * 销毁某个通道
   */
  public static disposeChannel(channel: string) {
    const channelObj = this.events.get(channel);
    if (channelObj) {
      channelObj.emitter.dispose();
      this.events.delete(channel);
    }
  }

  /**
   * 销毁全部通道
   */
  public static disposeAll() {
    this.events.forEach((channelObj) => channelObj.emitter.dispose());
    this.events.clear();
  }
}
