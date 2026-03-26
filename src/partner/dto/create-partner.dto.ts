import { IsString, IsOptional, IsEmail } from 'class-validator';

export class CreatePartnerDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  document?: string;

  @IsOptional()
  @IsString()
  contact?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  socialMediaLink?: string;

  @IsOptional()
  @IsString()
  address?: string;
}
