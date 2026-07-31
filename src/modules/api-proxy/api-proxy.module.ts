import type { QuickOpsModule } from '@core/module/quick-ops-module.interface';
import { CommonModule } from '@common/common.module';
import { ApiProxyController } from '@modules/api-proxy/api-proxy.controller';
import { ApiProxyService } from '@modules/api-proxy/api-proxy.service';
import { ApiProxyWebviewProvider } from '@modules/api-proxy/providers/api-proxy-webview.provider';

export const ApiProxyModule: QuickOpsModule = {
  imports: [CommonModule],
  controllers: [ApiProxyController],
  providers: [ApiProxyService, ApiProxyWebviewProvider],
  exports: [ApiProxyService, ApiProxyWebviewProvider],
};