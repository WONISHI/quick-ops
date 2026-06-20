import type { QuickOpsModule } from '../../core/module/quick-ops-module.interface';
import { CommonModule } from '../../common/common.module';
import { TextCompareController } from './text-compare.controller';
import { TextCompareService } from './text-compare.service';

export const TextCompareModule: QuickOpsModule = {
  imports: [CommonModule],
  controllers: [TextCompareController],
  providers: [TextCompareService],
  exports: [TextCompareService],
};