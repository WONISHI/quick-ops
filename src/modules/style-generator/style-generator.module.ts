import type { QuickOpsModule } from '../../core/module/quick-ops-module.interface';
import { StyleGeneratorController } from './style-generator.controller';
import { StyleGeneratorService } from './style-generator.service';

export const StyleGeneratorModule: QuickOpsModule = {
  controllers: [StyleGeneratorController],
  providers: [StyleGeneratorService],
  exports: [StyleGeneratorService],
};