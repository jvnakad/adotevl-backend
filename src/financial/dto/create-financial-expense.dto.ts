import { IsString, IsNumber } from 'class-validator';

export class CreateFinancialExpenseDto {
  @IsString()
  recipient: string;

  @IsString()
  reason: string;

  @IsNumber()
  amount: number;
}
