import type { QuickOpsModule } from '../../core/module/quick-ops-module.interface';
import { EditorHistoryController } from './editor-history.controller';
import { EditorHistoryService } from './editor-history.service';

export const EditorHistoryModule: QuickOpsModule = {
  controllers: [EditorHistoryController],
  providers: [EditorHistoryService],
  exports: [EditorHistoryService],
};