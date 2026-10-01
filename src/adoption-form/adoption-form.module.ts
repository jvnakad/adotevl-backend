import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdoptionForm } from './adoption-form.entity';
import { AdoptionFormPhoto } from './adoption-form-photo.entity';
import { Organization } from '../organization/organization.entity';
import { AdoptionFormService } from './adoption-form.service';
import { AdoptionFormController } from './adoption-form.controller';

@Module({
  imports: [TypeOrmModule.forFeature([AdoptionForm, AdoptionFormPhoto, Organization])],
  controllers: [AdoptionFormController],
  providers: [AdoptionFormService],
  exports: [AdoptionFormService],
})
export class AdoptionFormModule {}
