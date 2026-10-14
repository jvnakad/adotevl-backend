import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdoptionContract } from './adoption-contract.entity';
import { AdoptionForm } from '../adoption-form/adoption-form.entity';
import { Pet } from '../pet/pet.entity';
import { AdoptionHistoryModule } from '../adoption-history/adoption-history.module';
import { AdoptionContractService } from './adoption-contract.service';
import { AdoptionContractController } from './adoption-contract.controller';

@Module({
  imports: [TypeOrmModule.forFeature([AdoptionContract, AdoptionForm, Pet]), AdoptionHistoryModule],
  controllers: [AdoptionContractController],
  providers: [AdoptionContractService],
})
export class AdoptionContractModule {}
