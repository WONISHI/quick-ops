import type { QuickOpsModule } from '@core/module/quick-ops-module.interface';
import { CommonModule } from '@common/common.module';
import { MarkDecorationController } from '@modules/mark-decoration/mark-decoration.controller';
import { MarkDecorationService } from '@modules/mark-decoration/mark-decoration.service';

export const MarkDecorationModule: QuickOpsModule = {
  imports: [CommonModule],
  controllers: [MarkDecorationController],
  providers: [MarkDecorationService],
  exports: [MarkDecorationService],
};