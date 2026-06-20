import type { QuickOpsModule } from '../../core/module/quick-ops-module.interface';
import { CommonModule } from '../../common/common.module';
import { LivePreviewController } from './live-preview.controller';
import { LivePreviewService } from './live-preview.service';
import { LivePreviewProvider } from './providers/live-preview.provider';
import { EmbeddedBrowserService } from './services/embedded-browser.service';
import { LocalProxyServerService } from './services/local-proxy-server.service';

export const LivePreviewModule: QuickOpsModule = {
  imports: [CommonModule],
  controllers: [LivePreviewController],
  providers: [
    LivePreviewService,
    LivePreviewProvider,
    EmbeddedBrowserService,
    LocalProxyServerService,
  ],
  exports: [
    LivePreviewService,
    LivePreviewProvider,
    EmbeddedBrowserService,
    LocalProxyServerService,
  ],
};