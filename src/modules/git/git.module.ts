import type { QuickOpsModule } from '../../core/module/quick-ops-module.interface';
import { CommonModule } from '../../common/common.module';
import { GitController } from './git.controller';
import { GitService } from './git.service';
import { GitWebviewProvider } from './providers/git-webview.provider';
import { GitDetailWebviewProvider } from './providers/git-detail-webview.provider';
import { GitVirtualContentProvider } from './providers/git-virtual-content.provider';

export const GitModule: QuickOpsModule = {
  imports: [CommonModule],
  controllers: [GitController],
  providers: [
    GitService,
    GitWebviewProvider,
    GitDetailWebviewProvider,
    GitVirtualContentProvider,
  ],
  exports: [
    GitService,
    GitWebviewProvider,
    GitDetailWebviewProvider,
    GitVirtualContentProvider,
  ],
};