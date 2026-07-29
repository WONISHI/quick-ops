import { CommonModule } from '@common/common.module';
import { LivePreviewController } from '@modules/live-preview/live-preview.controller';
import { LivePreviewService } from '@modules/live-preview/live-preview.service';
import { LivePreviewProvider } from '@modules/live-preview/providers/live-preview.provider';
import { DevToolsWebviewProvider } from '@modules/live-preview/providers/dev-tools-webview.provider';
import { EmbeddedBrowserService } from '@modules/live-preview/services/embedded-browser.service';
import { LocalProxyServerService } from '@modules/live-preview/services/local-proxy-server.service';
import type { QuickOpsModule } from '@core/module/quick-ops-module.interface';

export const LivePreviewModule: QuickOpsModule = {
  imports: [CommonModule],
  controllers: [LivePreviewController],
  providers: [LivePreviewService, LivePreviewProvider, DevToolsWebviewProvider, EmbeddedBrowserService, LocalProxyServerService],
  exports: [LivePreviewService, LivePreviewProvider, DevToolsWebviewProvider, EmbeddedBrowserService, LocalProxyServerService],
};
