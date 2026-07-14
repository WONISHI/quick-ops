import type { QuickOpsModule } from '@core/module/quick-ops-module.interface';
import { CommonModule } from '@common/common.module';
import { InlineConstantHintController } from '@modules/inline-constant-hint/inline-constant-hint.controller';
import { InlineConstantHintService } from '@modules/inline-constant-hint/inline-constant-hint.service';
import { InlineConstantHintProvider } from '@modules/inline-constant-hint/providers/inline-constant-hint.provider';

export const InlineConstantHintModule: QuickOpsModule = {
  imports: [CommonModule],
  controllers: [InlineConstantHintController],
  providers: [InlineConstantHintService, InlineConstantHintProvider],
  exports: [InlineConstantHintService, InlineConstantHintProvider],
};