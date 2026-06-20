import type { QuickOpsModule } from '../core/module/quick-ops-module.interface';

import { ExtensionContextProvider } from './providers/extension-context.provider';

import { ConfigurationService } from './services/configuration.service';
import { WorkspaceStateService } from './services/workspace-state.service';
import { EditorContextService } from './services/editor-context.service';
import { TerminalExecutor } from './services/terminal-executor.service';
import { WorkspaceContextService } from './services/workspace-context.service';
import { DirectoryService } from './services/directory.service';

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