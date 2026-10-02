import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdoptionForm } from './adoption-form.entity';
import { AdoptionFormPhoto } from './adoption-form-photo.entity';
import { Organization } from '../organization/organization.entity';
import { Pet } from '../pet/pet.entity';
import { AdoptionContract } from '../adoption-contract/adoption-contract.entity';
import { AdoptionHistoryModule } from '../adoption-history/adoption-history.module';
import { AdoptionFormService } from './adoption-form.service';
import { AdoptionFormController } from './adoption-form.controller';

@Module({
  imports: [TypeOrmModule.forFeature([AdoptionForm, AdoptionFormPhoto, Organization, Pet, AdoptionContract]), AdoptionHistoryModule],
  controllers: [AdoptionFormController],
  providers: [AdoptionFormService],
  exports: [AdoptionFormService],
})
export class AdoptionFormModule {}
