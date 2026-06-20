import type { QuickOpsModule } from '../../core/module/quick-ops-module.interface';
import { CommonModule } from '../../common/common.module';
import { PackageScriptsController } from './package-scripts.controller';
import { PackageScriptsService } from './package-scripts.service';

export const PackageScriptsModule: QuickOpsModule = {
  imports: [CommonModule],
  controllers: [PackageScriptsController],
  providers: [PackageScriptsService],
  exports: [PackageScriptsService],
};