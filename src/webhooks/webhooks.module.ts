import { Module } from '@nestjs/common';
import { AdoptionContractModule } from '../adoption-contract/adoption-contract.module';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';

@Module({
  imports: [AdoptionContractModule],
  controllers: [WebhooksController],
  providers: [WebhooksService],
})
export class WebhooksModule {}
