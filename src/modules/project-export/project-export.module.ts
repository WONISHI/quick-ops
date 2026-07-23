import type { QuickOpsModule } from '@core/module/quick-ops-module.interface';
import { CommonModule } from '@common/common.module';
import { ProjectExportController } from '@modules/project-export/project-export.controller';
import { ProjectExportService } from '@modules/project-export/project-export.service';

export const ProjectExportModule: QuickOpsModule = {
  imports: [CommonModule],
  controllers: [ProjectExportController],
  providers: [ProjectExportService],
  exports: [ProjectExportService],
};