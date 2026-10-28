import { IsString, IsOptional, IsUUID } from 'class-validator';

export class CreateOrganizationAddressDto {
  @IsString()
  name: string;

  @IsString()
  zipCode: string;

  @IsString()
  street: string;

  @IsString()
  city: string;

  @IsString()
  neighborhood: string;

  @IsString()
  state: string;

  @IsOptional()
  @IsString()
  country?: string;

  /** Ignorado: a organização vem do token de quem cria. Mantido opcional por compatibilidade com o painel. */
  @IsOptional()
  @IsUUID()
  organizationId?: string;
}
