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

  @IsUUID()
  organizationId: string;
}
