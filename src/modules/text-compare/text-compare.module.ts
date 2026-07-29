import { CommonModule } from '@common/common.module';
import { TextCompareController } from '@modules/text-compare/text-compare.controller';
import { TextCompareService } from '@modules/text-compare/text-compare.service';
import type { QuickOpsModule } from '@core/module/quick-ops-module.interface';

export const TextCompareModule: QuickOpsModule = {
  imports: [CommonModule],
  controllers: [TextCompareController],
  providers: [TextCompareService],
  exports: [TextCompareService],
};