import { CommonModule } from '@common/common.module';
import { DevToolsController } from '@modules/devtools/devtools.controller';
import { DevToolsWebviewProvider } from '@modules/devtools/providers/devtools-webview.provider';
import type { QuickOpsModule } from '@core/module/quick-ops-module.interface';

export const DevToolsModule: QuickOpsModule = {
  imports: [CommonModule],
  controllers: [DevToolsController],
  providers: [DevToolsWebviewProvider],
  exports: [DevToolsWebviewProvider],
};