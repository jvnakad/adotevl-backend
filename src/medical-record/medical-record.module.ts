import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MedicalRecord } from './medical-record.entity';
import { MedicalRecordService } from './medical-record.service';
import { MedicalRecordController } from './medical-record.controller';

@Module({
  imports: [TypeOrmModule.forFeature([MedicalRecord])],
  controllers: [MedicalRecordController],
  providers: [MedicalRecordService],
  exports: [MedicalRecordService],
})
export class MedicalRecordModule {}
