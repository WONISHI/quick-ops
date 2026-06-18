import type { QuickOpsModule } from '../core/module/quick-ops-module.interface';
import { ConfigurationService } from './services/configuration.service';
import { WorkspaceStateService } from './services/workspace-state.service';
import { EditorContextService } from './services/editor-context.service';
import { TerminalExecutor } from './services/terminal-executor.service';

export const CommonModule: QuickOpsModule = {
  global: true,
  providers: [
    {
      provide: ConfigurationService,
      useValue: ConfigurationService.getInstance(),
    },
    {
      provide: WorkspaceStateService,
      useValue: WorkspaceStateService.getInstance(),
    },
    {
      provide: EditorContextService,
      useValue: EditorContextService.getInstance(),
    },
    {
      provide: TerminalExecutor,
      useValue: TerminalExecutor.getInstance(),
    },
  ],
  exports: [
    ConfigurationService,
    WorkspaceStateService,
    EditorContextService,
    TerminalExecutor,
  ],
};