import { IsString, IsOptional, IsNotEmpty } from 'class-validator';
import { IsPersonEmail } from '../../common/validation/person';

export class CreatePartnerDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsOptional()
  @IsString()
  organizationId?: string;

  @IsOptional()
  @IsString()
  document?: string;

  @IsOptional()
  @IsString()
  contact?: string;

  @IsPersonEmail({ optional: true })
  email?: string;

  @IsOptional()
  @IsString()
  socialMediaLink?: string;

  @IsOptional()
  @IsString()
  address?: string;
}
