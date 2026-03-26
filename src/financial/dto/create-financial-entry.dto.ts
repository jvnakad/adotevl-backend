import { IsString, IsNumber, IsOptional, IsUUID, IsDateString } from 'class-validator';

export class CreateFinancialEntryDto {
  @IsString()
  sender: string;

  @IsOptional()
  @IsUUID()
  campaignId?: string;

  @IsNumber()
  amount: number;

  @IsOptional()
  @IsDateString()
  transactionDate?: string;
}
