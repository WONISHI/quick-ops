import type { QuickOpsModule } from '@core/module/quick-ops-module.interface';
import { CommonModule } from '@common/common.module';
import { FocusHistoryController } from '@modules/focus-history/focus-history.controller';
import { FocusHistoryService } from '@modules/focus-history/focus-history.service';

export const FocusHistoryModule: QuickOpsModule = {
  imports: [CommonModule],
  controllers: [FocusHistoryController],
  providers: [FocusHistoryService],
  exports: [FocusHistoryService],
};