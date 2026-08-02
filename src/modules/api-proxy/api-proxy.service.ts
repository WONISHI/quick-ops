import { ExtensionContextProvider } from '@common/providers/extension-context.provider';
import { API_PROXY_RULES_STATE_KEY } from '@modules/api-proxy/constants/api-proxy.constant';
import type { ApiProxyRule } from '@modules/api-proxy/api-proxy.type';

/**
 * ApiProxyService 只保留代理配置的基础读写能力。
 *
 * 实际代理服务、日志、Webview 状态同步由 ApiProxyWebviewProvider 统一负责，
 * 避免 service/provider 各自创建一套 http-proxy 运行时。
 */
export class ApiProxyService {
  public static inject = [ExtensionContextProvider];

  constructor(private readonly extensionContextProvider: ExtensionContextProvider) {}

  public getRules(): ApiProxyRule[] {
    return this.extensionContextProvider.getContext().globalState.get<ApiProxyRule[]>(API_PROXY_RULES_STATE_KEY) || [];
  }

  public async saveRules(rules: ApiProxyRule[]): Promise<void> {
    await this.extensionContextProvider.getContext().globalState.update(API_PROXY_RULES_STATE_KEY, Array.isArray(rules) ? rules : []);
  }

  public async clearRules(): Promise<void> {
    await this.extensionContextProvider.getContext().globalState.update(API_PROXY_RULES_STATE_KEY, undefined);
  }

  public dispose(): void {}
}
