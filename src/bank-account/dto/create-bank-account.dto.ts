import { IsString, IsOptional, IsUUID } from 'class-validator';

export class CreateBankAccountDto {
  @IsString()
  bankName: string;

  @IsOptional()
  @IsString()
  bankCode?: string;

  @IsOptional()
  @IsString()
  agency?: string;

  @IsOptional()
  @IsString()
  agencyDigit?: string;

  @IsString()
  accountNumber: string;

  @IsOptional()
  @IsString()
  accountDigit?: string;

  @IsOptional()
  @IsString()
  accountType?: string;

  @IsOptional()
  @IsString()
  pixKey?: string;

  @IsOptional()
  @IsString()
  pixKeyType?: string;

  @IsString()
  ownerName: string;

  @IsOptional()
  @IsString()
  document?: string;

  @IsUUID()
  organizationId: string;
}
