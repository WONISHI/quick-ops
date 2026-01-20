/**
 * 基础服务接口
 * 所有基础设施服务（Infrastructure Services）都应实现此接口
 * 服务通常是单例的，且不包含具体的业务功能逻辑
 */
export interface IService {
  /** 服务的唯一标识符 */
  readonly serviceId: string;

  /** 初始化服务（可选异步） */
  init(): Promise<void> | void;

  /** 销毁服务，清理资源 */
  dispose?(): void;
}
