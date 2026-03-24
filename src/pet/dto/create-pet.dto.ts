import { IsString, IsOptional, IsBoolean, IsNumber, IsDateString, IsUUID } from 'class-validator';

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

  @IsUUID()
  organizationId: string;
}
