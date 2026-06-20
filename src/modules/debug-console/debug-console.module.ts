import type { QuickOpsModule } from '../../core/module/quick-ops-module.interface';
import { CommonModule } from '../../common/common.module';
import { DebugConsoleController } from './debug-console.controller';
import { DebugConsoleService } from './debug-console.service';

export const DebugConsoleModule: QuickOpsModule = {
  imports: [CommonModule],
  controllers: [DebugConsoleController],
  providers: [DebugConsoleService],
  exports: [DebugConsoleService],
};