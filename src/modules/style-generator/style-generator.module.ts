import type { QuickOpsModule } from '@core/module/quick-ops-module.interface';
import { StyleGeneratorController } from '@modules/style-generator/style-generator.controller';
import { StyleGeneratorService } from '@modules/style-generator/style-generator.service';

export const StyleGeneratorModule: QuickOpsModule = {
  controllers: [StyleGeneratorController],
  providers: [StyleGeneratorService],
  exports: [StyleGeneratorService],
};