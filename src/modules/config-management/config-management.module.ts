import type { QuickOpsModule } from '../../core/module/quick-ops-module.interface';
import { CommonModule } from '../../common/common.module';
import { ConfigManagementController } from './config-management.controller';

export const ConfigManagementModule: QuickOpsModule = {
  imports: [CommonModule],
  controllers: [ConfigManagementController],
};