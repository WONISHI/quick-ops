import type { QuickOpsModule } from '../../core/module/quick-ops-module.interface';
import { CommonModule } from '../../common/common.module';
import { LogEnhancerController } from './log-enhancer.controller';
import { LogEnhancerService } from './log-enhancer.service';

export const LogEnhancerModule: QuickOpsModule = {
  imports: [CommonModule],
  controllers: [LogEnhancerController],
  providers: [LogEnhancerService],
  exports: [LogEnhancerService],
};