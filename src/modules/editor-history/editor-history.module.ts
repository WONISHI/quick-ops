import type { QuickOpsModule } from '@core/module/quick-ops-module.interface';
import { EditorHistoryController } from '@modules/editor-history/editor-history.controller';
import { EditorHistoryService } from '@modules/editor-history/editor-history.service';

export const EditorHistoryModule: QuickOpsModule = {
  controllers: [EditorHistoryController],
  providers: [EditorHistoryService],
  exports: [EditorHistoryService],
};