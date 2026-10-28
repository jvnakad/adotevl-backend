import { IsString, IsNumber, IsOptional, IsUUID, IsDateString, IsEnum, IsPositive, Max } from 'class-validator';
import { IsCalendarDate, MONEY_MAX } from '../../common/validation/calendar-date';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaymentMethod } from '../financial-entry.entity';

export class UpdateFinancialEntryDto {
  @ApiPropertyOptional({ description: 'Remetente' })
  @IsOptional()
  @IsString()
  sender?: string;

  @ApiPropertyOptional({ description: 'ID da campanha vinculada' })
  @IsOptional()
  @IsUUID()
  campaignId?: string;

  @ApiPropertyOptional({ description: 'ID da conta bancária' })
  @IsOptional()
  @IsUUID()
  bankAccountId?: string;

  @ApiPropertyOptional({ description: 'Valor' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'O valor deve ser um número com no máximo 2 casas decimais.' })
  @IsPositive({ message: 'O valor deve ser maior que zero.' })
  @Max(MONEY_MAX, { message: 'O valor máximo é 99.999.999,99.' })
  amount?: number;

  @ApiPropertyOptional({ enum: PaymentMethod, description: 'Forma de recebimento: DEBITO, CREDITO, PIX, OUTROS' })
  @IsOptional()
  @IsEnum(PaymentMethod, { message: 'Forma de recebimento inválida. Use: DEBITO, CREDITO, PIX ou OUTROS.' })
  paymentMethod?: PaymentMethod;

  @ApiPropertyOptional({ description: 'Data da transação (formato: YYYY-MM-DD)' })
  @IsOptional()
  @IsDateString({}, { message: 'Informe uma data válida no formato YYYY-MM-DD.' })
  @IsCalendarDate()
  transactionDate?: string;
}
