import type { QuickOpsModule } from '../../core/module/quick-ops-module.interface';
import { CommonModule } from '../../common/common.module';
import { RecentProjectsController } from './recent-projects.controller';
import { RecentProjectsService } from './recent-projects.service';
import { RecentProjectsProvider } from './providers/recent-projects.provider';
import { ReadOnlyFileSystemProvider } from './providers/read-only-file-system.provider';

export const RecentProjectsModule: QuickOpsModule = {
  imports: [CommonModule],
  controllers: [RecentProjectsController],
  providers: [RecentProjectsService, RecentProjectsProvider, ReadOnlyFileSystemProvider],
  exports: [RecentProjectsService, RecentProjectsProvider, ReadOnlyFileSystemProvider],
};
