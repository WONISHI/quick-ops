import { CommonModule } from '@common/common.module';
import { GitController } from '@modules/git/git.controller';
import { GitService } from '@modules/git/git.service';
import { GitWebviewProvider } from '@modules/git/providers/git-webview.provider';
import { GitDetailWebviewProvider } from '@modules/git/providers/git-detail-webview.provider';
import { GitVirtualContentProvider } from '@modules/git/providers/git-virtual-content.provider';
import type { QuickOpsModule } from '@core/module/quick-ops-module.interface';

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