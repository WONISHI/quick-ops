import type { QuickOpsModule } from '../../core/module/quick-ops-module.interface';
import { CommonModule } from '../../common/common.module';
import { MockServerController } from './mock-server.controller';
import { MockServerService } from './mock-server.service';

export const MockServerModule: QuickOpsModule = {
  imports: [CommonModule],
  controllers: [MockServerController],
  providers: [MockServerService],
  exports: [MockServerService],
};