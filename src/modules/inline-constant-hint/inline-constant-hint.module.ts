import type { QuickOpsModule } from '../../core/module/quick-ops-module.interface';
import { CommonModule } from '../../common/common.module';
import { InlineConstantHintController } from './inline-constant-hint.controller';
import { InlineConstantHintService } from './inline-constant-hint.service';
import { InlineConstantHintProvider } from './providers/inline-constant-hint.provider';

export const InlineConstantHintModule: QuickOpsModule = {
  imports: [CommonModule],
  controllers: [InlineConstantHintController],
  providers: [InlineConstantHintService, InlineConstantHintProvider],
  exports: [InlineConstantHintService, InlineConstantHintProvider],
};