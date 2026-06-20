import * as vscode from 'vscode';
import { LocalProxyServerService } from './local-proxy-server.service';

export interface EmbeddedBrowserNavigateOptions {
  url: string;
  useProxy?: boolean;
}

export interface EmbeddedBrowserNavigateResult {
  url: string;
  proxyUrl?: string;
  finalUrl: string;
  useProxy: boolean;
}

export class EmbeddedBrowserService {
  public static inject = [LocalProxyServerService];

  private lastUrl = '';
  private lastProxyUrl = '';
  private useProxy = false;

  constructor(private readonly localProxyServerService: LocalProxyServerService) {}

  public normalizeUrl(value: string): string {
    const url = String(value || '').trim();

    if (!url) return '';

    if (/^(https?:|file:|vscode-resource:|vscode-webview-resource:)/i.test(url)) {
      return url;
    }

    if (/^[a-zA-Z]:[\\/]/.test(url) || url.startsWith('/')) {
      return vscode.Uri.file(url).toString();
    }

    return `https://${url}`;
  }

  public async navigate(
    options: EmbeddedBrowserNavigateOptions,
  ): Promise<EmbeddedBrowserNavigateResult> {
    const normalizedUrl = this.normalizeUrl(options.url);

    if (!normalizedUrl) {
      return {
        url: '',
        finalUrl: '',
        useProxy: false,
      };
    }

    this.lastUrl = normalizedUrl;
    this.useProxy = Boolean(options.useProxy);

    if (this.useProxy && /^https?:\/\//i.test(normalizedUrl)) {
      const proxyUrl = await this.localProxyServerService.getProxyUrl(normalizedUrl);

      this.lastProxyUrl = proxyUrl;

      return {
        url: normalizedUrl,
        proxyUrl,
        finalUrl: proxyUrl,
        useProxy: true,
      };
    }

    this.lastProxyUrl = '';

    return {
      url: normalizedUrl,
      finalUrl: normalizedUrl,
      useProxy: false,
    };
  }

  public async toggleProxy(): Promise<EmbeddedBrowserNavigateResult | undefined> {
    if (!this.lastUrl) return undefined;

    return this.navigate({
      url: this.lastUrl,
      useProxy: !this.useProxy,
    });
  }

  public getState(): {
    lastUrl: string;
    lastProxyUrl: string;
    useProxy: boolean;
  } {
    return {
      lastUrl: this.lastUrl,
      lastProxyUrl: this.lastProxyUrl,
      useProxy: this.useProxy,
    };
  }

  public stopProxy(): void {
    this.localProxyServerService.stop();
    this.lastProxyUrl = '';
    this.useProxy = false;
  }

  public dispose(): void {
    this.stopProxy();
    this.lastUrl = '';
  }
}