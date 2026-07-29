import { CommonModule } from '@common/common.module';
import { ComponentIntellisenseController } from '@modules/component-intellisense/component-intellisense.controller';
import { ComponentIntellisenseService } from '@modules/component-intellisense/component-intellisense.service';
import { ComponentCompletionProvider } from '@modules/component-intellisense/providers/component-completion.provider';
import type { QuickOpsModule } from '@core/module/quick-ops-module.interface';

export const ComponentIntellisenseModule: QuickOpsModule = {
  imports: [CommonModule],
  controllers: [ComponentIntellisenseController],
  providers: [ComponentIntellisenseService, ComponentCompletionProvider],
  exports: [ComponentIntellisenseService, ComponentCompletionProvider],
};  