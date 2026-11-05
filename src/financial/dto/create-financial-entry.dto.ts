import { IsString, IsNumber, IsOptional, IsUUID, IsDateString, IsEnum, IsPositive, Max } from 'class-validator';
import { IsCalendarDate, MONEY_MAX } from '../../common/validation/calendar-date';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaymentMethod } from '../financial-entry.entity';

export class CreateFinancialEntryDto {
  @ApiProperty({ description: 'Remetente' })
  @IsString()
  sender: string;

  @ApiPropertyOptional({ description: 'ID da campanha vinculada' })
  @IsOptional()
  @IsUUID()
  campaignId?: string;

  @ApiProperty({ description: 'ID da conta bancária' })
  @IsUUID()
  bankAccountId: string;

  @ApiProperty({ description: 'Valor' })
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'O valor deve ser um número com no máximo 2 casas decimais.' })
  @IsPositive({ message: 'O valor deve ser maior que zero.' })
  @Max(MONEY_MAX, { message: 'O valor máximo é 99.999.999,99.' })
  amount: number;

  @ApiProperty({ enum: PaymentMethod, description: 'Forma de recebimento: DEBITO, CREDITO, PIX, OUTROS' })
  @IsEnum(PaymentMethod, { message: 'Forma de recebimento inválida. Use: DEBITO, CREDITO, PIX ou OUTROS.' })
  paymentMethod: PaymentMethod;

  @ApiProperty({ description: 'Data da transação (formato: YYYY-MM-DD)' })
  @IsDateString({}, { message: 'Informe uma data válida no formato YYYY-MM-DD.' })
  @IsCalendarDate()
  transactionDate: string;
}
