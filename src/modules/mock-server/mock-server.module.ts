import { CommonModule } from '@common/common.module';
import { MockServerController } from '@modules/mock-server/mock-server.controller';
import { MockServerService } from '@modules/mock-server/mock-server.service';
import type { QuickOpsModule } from '@core/module/quick-ops-module.interface';

export const MockServerModule: QuickOpsModule = {
  imports: [CommonModule],
  controllers: [MockServerController],
  providers: [MockServerService],
  exports: [MockServerService],
};