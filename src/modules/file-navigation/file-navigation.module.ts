import type { QuickOpsModule } from '@core/module/quick-ops-module.interface';
import { CommonModule } from '@common/common.module';
import { FileNavigationController } from '@modules/file-navigation/file-navigation.controller';
import { FileNavigationService } from '@modules/file-navigation/file-navigation.service';

export const FileNavigationModule: QuickOpsModule = {
  imports: [CommonModule],
  controllers: [FileNavigationController],
  providers: [FileNavigationService],
  exports: [FileNavigationService],
};