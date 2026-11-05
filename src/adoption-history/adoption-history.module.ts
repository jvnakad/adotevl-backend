import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdoptionHistoryEvent } from './adoption-history.entity';
import { User } from '../user/user.entity';
import { AdoptionHistoryService } from './adoption-history.service';
import { AdoptionHistoryController } from './adoption-history.controller';

@Module({
  imports: [TypeOrmModule.forFeature([AdoptionHistoryEvent, User])],
  controllers: [AdoptionHistoryController],
  providers: [AdoptionHistoryService],
  exports: [AdoptionHistoryService],
})
export class AdoptionHistoryModule {}
