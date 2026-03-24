import { IsString, IsOptional, IsUUID, IsDateString, Matches } from 'class-validator';

export class CreateVolunteerDto {
  @IsString()
  name: string;

  @IsString()
  @Matches(/^\d{11}$/, { message: 'CPF deve conter 11 dígitos numéricos.' })
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
