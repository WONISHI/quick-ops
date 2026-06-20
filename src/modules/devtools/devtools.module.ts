import type { QuickOpsModule } from '../../core/module/quick-ops-module.interface';
import { CommonModule } from '../../common/common.module';
import { DevToolsController } from './devtools.controller';
import { DevToolsWebviewProvider } from './providers/devtools-webview.provider';

export const DevToolsModule: QuickOpsModule = {
  imports: [CommonModule],
  controllers: [DevToolsController],
  providers: [DevToolsWebviewProvider],
  exports: [DevToolsWebviewProvider],
};