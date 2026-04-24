import { IsString, IsNumber, IsOptional, IsUUID, IsDateString, IsEnum } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaymentMethod } from '../financial-entry.entity';

export class UpdateFinancialExpenseDto {
  @ApiPropertyOptional({ description: 'Destinatário' })
  @IsOptional()
  @IsString()
  recipient?: string;

  @ApiPropertyOptional({ description: 'Motivo da saída' })
  @IsOptional()
  @IsString()
  reason?: string;

  @ApiPropertyOptional({ description: 'ID da conta bancária' })
  @IsOptional()
  @IsUUID()
  bankAccountId?: string;

  @ApiPropertyOptional({ description: 'Valor' })
  @IsOptional()
  @IsNumber()
  amount?: number;

  @ApiPropertyOptional({ enum: PaymentMethod, description: 'Forma de saída: DEBITO, CREDITO, PIX, OUTROS' })
  @IsOptional()
  @IsEnum(PaymentMethod, { message: 'Forma de saída inválida. Use: DEBITO, CREDITO, PIX ou OUTROS.' })
  paymentMethod?: PaymentMethod;

  @ApiPropertyOptional({ description: 'Data da transação (formato: YYYY-MM-DD)' })
  @IsOptional()
  @IsDateString({}, { message: 'Informe uma data válida no formato YYYY-MM-DD.' })
  transactionDate?: string;
}
