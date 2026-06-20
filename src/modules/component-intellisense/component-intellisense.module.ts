import type { QuickOpsModule } from '../../core/module/quick-ops-module.interface';
import { CommonModule } from '../../common/common.module';
import { ComponentIntellisenseController } from './component-intellisense.controller';
import { ComponentIntellisenseService } from './component-intellisense.service';
import { ComponentCompletionProvider } from './providers/component-completion.provider';

export const ComponentIntellisenseModule: QuickOpsModule = {
  imports: [CommonModule],
  controllers: [ComponentIntellisenseController],
  providers: [ComponentIntellisenseService, ComponentCompletionProvider],
  exports: [ComponentIntellisenseService, ComponentCompletionProvider],
};  