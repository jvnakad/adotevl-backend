import { IsString, IsOptional, IsUUID } from 'class-validator';

export class CreateMedicalRecordDto {
  @IsUUID()
  petId: string;

  @IsString()
  consultationType: string;

  @IsString()
  @IsOptional()
  observation?: string;
}
