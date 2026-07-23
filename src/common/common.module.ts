import type { QuickOpsModule } from '@core/module/quick-ops-module.interface';

import { ExtensionContextProvider } from '@common/providers/extension-context.provider';

import { ConfigurationService } from '@common/services/configuration.service';
import { WorkspaceStateService } from '@common/services/workspace-state.service';
import { EditorContextService } from '@common/services/editor-context.service';
import { TerminalExecutor } from '@common/services/terminal-executor.service';
import { WorkspaceContextService } from '@common/services/workspace-context.service';
import { DirectoryService } from '@common/services/directory.service';

export const CommonModule: QuickOpsModule = {
  global: true,
  providers: [
    ExtensionContextProvider,

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
    {
      provide: WorkspaceContextService,
      useValue: WorkspaceContextService.getInstance(),
    },
    {
      provide: DirectoryService,
      useValue: DirectoryService.getInstance(),
    },
  ],
  exports: [
    ExtensionContextProvider,
    ConfigurationService,
    WorkspaceStateService,
    EditorContextService,
    TerminalExecutor,
    WorkspaceContextService,
    DirectoryService,
  ],
};