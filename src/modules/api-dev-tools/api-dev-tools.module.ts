import { CommonModule } from '@common/common.module';
import { ApiDevToolsController } from '@modules/api-dev-tools/api-dev-tools.controller';
import { ApiDevToolsService } from '@modules/api-dev-tools/api-dev-tools.service';
import { ApiDevToolsWebviewProvider } from '@modules/api-dev-tools/providers/api-dev-tools-webview.provider';
import type { QuickOpsModule } from '@core/module/quick-ops-module.interface';

export const ApiDevToolsModule: QuickOpsModule = {
  imports: [CommonModule],
  controllers: [ApiDevToolsController],
  providers: [ApiDevToolsService, ApiDevToolsWebviewProvider],
  exports: [ApiDevToolsService, ApiDevToolsWebviewProvider],
};