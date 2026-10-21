import { IsOptional, IsUUID, IsDateString } from 'class-validator';
import { IsCpf, IsFullName } from '../../common/validation/person';

export class CreateVolunteerDto {
  @IsFullName()
  name: string;

  @IsCpf()
  cpf: string;

  @IsDateString()
  @IsOptional()
  birthDate?: string;

  @IsUUID()
  userId: string;

  @IsUUID()
  @IsOptional()
  teamId?: string;
}
