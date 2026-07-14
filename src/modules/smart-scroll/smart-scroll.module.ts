import type { QuickOpsModule } from '@core/module/quick-ops-module.interface';
import { CommonModule } from '@common/common.module';
import { SmartScrollController } from '@modules/smart-scroll/smart-scroll.controller';
import { SmartScrollService } from '@modules/smart-scroll/smart-scroll.service';

export const SmartScrollModule: QuickOpsModule = {
  imports: [CommonModule],
  controllers: [SmartScrollController],
  providers: [SmartScrollService],
  exports: [SmartScrollService],
};