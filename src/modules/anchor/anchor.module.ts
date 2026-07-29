import { CommonModule } from '@common/common.module';
import { AnchorController } from '@modules/anchor/anchor.controller';
import { AnchorService } from '@modules/anchor/anchor.service';
import type { QuickOpsModule } from '@core/module/quick-ops-module.interface';

export const AnchorModule: QuickOpsModule = {
  imports: [CommonModule],
  controllers: [AnchorController],
  providers: [AnchorService],
  exports: [AnchorService],
};