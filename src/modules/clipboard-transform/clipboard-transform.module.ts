import type { QuickOpsModule } from '../../core/module/quick-ops-module.interface';
import { ClipboardTransformController } from './clipboard-transform.controller';
import { ClipboardTransformService } from './clipboard-transform.service';

export const ClipboardTransformModule: QuickOpsModule = {
  controllers: [ClipboardTransformController],
  providers: [ClipboardTransformService],
  exports: [ClipboardTransformService],
};