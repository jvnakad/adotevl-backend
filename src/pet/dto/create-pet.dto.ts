import { IsString, IsOptional, IsBoolean, IsNumber, IsDateString, IsUUID, IsEnum } from 'class-validator';
import { PetStatus } from '../pet.entity';

export class CreatePetDto {
  @IsString()
  name: string;

  @IsString()
  species: string;

  @IsString()
  @IsOptional()
  animal?: string;

  @IsNumber()
  @IsOptional()
  age?: number;

  @IsString()
  sex: string;

  @IsString()
  @IsOptional()
  size?: string;

  @IsNumber()
  @IsOptional()
  weight?: number;

  @IsBoolean()
  @IsOptional()
  castration?: boolean;

  @IsDateString()
  @IsOptional()
  rescueDate?: string;

  @IsDateString()
  @IsOptional()
  adoptionDate?: string;

  @IsString()
  @IsOptional()
  about?: string;

  @IsEnum(PetStatus, { message: 'Status inválido. Use: DISPONIVEL, EM_PROCESSO ou ADOTADO.' })
  @IsOptional()
  status?: PetStatus;

  @IsUUID()
  organizationId: string;
}
