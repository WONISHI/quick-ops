import type { QuickOpsModule } from '../../core/module/quick-ops-module.interface';
import { CommonModule } from '../../common/common.module';
import { SnippetGeneratorController } from './snippet-generator.controller';
import { SnippetGeneratorService } from './snippet-generator.service';

export const SnippetGeneratorModule: QuickOpsModule = {
  imports: [CommonModule],
  controllers: [SnippetGeneratorController],
  providers: [SnippetGeneratorService],
  exports: [SnippetGeneratorService],
};