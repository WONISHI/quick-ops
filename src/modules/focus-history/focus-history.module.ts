import type { QuickOpsModule } from '../../core/module/quick-ops-module.interface';
import { CommonModule } from '../../common/common.module';
import { FocusHistoryController } from './focus-history.controller';
import { FocusHistoryService } from './focus-history.service';

export const FocusHistoryModule: QuickOpsModule = {
  imports: [CommonModule],
  controllers: [FocusHistoryController],
  providers: [FocusHistoryService],
  exports: [FocusHistoryService],
};