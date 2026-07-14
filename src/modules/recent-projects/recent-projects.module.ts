import type { QuickOpsModule } from '@core/module/quick-ops-module.interface';
import { CommonModule } from '@common/common.module';
import { RecentProjectsController } from '@modules/recent-projects/recent-projects.controller';
import { RecentProjectsService } from '@modules/recent-projects/recent-projects.service';
import { RecentProjectsProvider } from '@modules/recent-projects/providers/recent-projects.provider';
import { ReadOnlyFileSystemProvider } from '@modules/recent-projects/providers/read-only-file-system.provider';
import { GitVirtualContentProvider } from '@modules/git/providers/git-virtual-content.provider';

export const RecentProjectsModule: QuickOpsModule = {
  imports: [CommonModule],
  controllers: [RecentProjectsController],
  providers: [
    RecentProjectsService,
    RecentProjectsProvider,
    ReadOnlyFileSystemProvider,
    GitVirtualContentProvider,
  ],
  exports: [
    RecentProjectsService,
    RecentProjectsProvider,
    ReadOnlyFileSystemProvider,
    GitVirtualContentProvider,
  ],
};
