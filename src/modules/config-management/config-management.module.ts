import { CommonModule } from '@common/common.module';
import { ConfigManagementController } from '@modules/config-management/config-management.controller';
import type { QuickOpsModule } from '@core/module/quick-ops-module.interface';

export const ConfigManagementModule: QuickOpsModule = {
  imports: [CommonModule],
  controllers: [ConfigManagementController],
};