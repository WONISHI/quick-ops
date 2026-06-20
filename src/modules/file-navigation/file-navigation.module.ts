import type { QuickOpsModule } from '../../core/module/quick-ops-module.interface';
import { CommonModule } from '../../common/common.module';
import { FileNavigationController } from './file-navigation.controller';
import { FileNavigationService } from './file-navigation.service';

export const FileNavigationModule: QuickOpsModule = {
  imports: [CommonModule],
  controllers: [FileNavigationController],
  providers: [FileNavigationService],
  exports: [FileNavigationService],
};