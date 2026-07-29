import { CommonModule } from '@common/common.module';
import { DebugConsoleController } from '@modules/debug-console/debug-console.controller';
import { DebugConsoleService } from '@modules/debug-console/debug-console.service';
import type { QuickOpsModule } from '@core/module/quick-ops-module.interface';

export const DebugConsoleModule: QuickOpsModule = {
  imports: [CommonModule],
  controllers: [DebugConsoleController],
  providers: [DebugConsoleService],
  exports: [DebugConsoleService],
};