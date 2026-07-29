import { CommonModule } from '@common/common.module';
import { SnippetGeneratorController } from '@modules/snippet-generator/snippet-generator.controller';
import { SnippetGeneratorService } from './snippet-generator.service';
import type { QuickOpsModule } from '@core/module/quick-ops-module.interface';

export const SnippetGeneratorModule: QuickOpsModule = {
  imports: [CommonModule],
  controllers: [SnippetGeneratorController],
  providers: [SnippetGeneratorService],
  exports: [SnippetGeneratorService],
};