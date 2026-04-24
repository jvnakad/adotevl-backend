import { IsString, IsNumber, IsUUID, IsDateString, IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { PaymentMethod } from '../financial-entry.entity';

export class CreateFinancialExpenseDto {
  @ApiProperty({ description: 'Destinatário' })
  @IsString()
  recipient: string;

  @ApiProperty({ description: 'Motivo da saída' })
  @IsString()
  reason: string;

  @ApiProperty({ description: 'ID da conta bancária' })
  @IsUUID()
  bankAccountId: string;

  @ApiProperty({ description: 'Valor' })
  @IsNumber()
  amount: number;

  @ApiProperty({ enum: PaymentMethod, description: 'Forma de saída: DEBITO, CREDITO, PIX, OUTROS' })
  @IsEnum(PaymentMethod, { message: 'Forma de saída inválida. Use: DEBITO, CREDITO, PIX ou OUTROS.' })
  paymentMethod: PaymentMethod;

  @ApiProperty({ description: 'Data da transação (formato: YYYY-MM-DD)' })
  @IsDateString({}, { message: 'Informe uma data válida no formato YYYY-MM-DD.' })
  transactionDate: string;
}
