import { CommonModule } from '@common/common.module';
import { CodeSnippetController } from '@modules/code-snippet/code-snippet.controller';
import { CodeSnippetService } from '@modules/code-snippet/code-snippet.service';
import type { QuickOpsModule } from '@core/module/quick-ops-module.interface';

export const CodeSnippetModule: QuickOpsModule = {
  imports: [CommonModule],
  controllers: [CodeSnippetController],
  providers: [CodeSnippetService],
  exports: [CodeSnippetService],
};