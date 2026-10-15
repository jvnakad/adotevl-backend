import { IsEmail, IsNotEmpty, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DATE_PATTERN, TIME_PATTERN } from '../schedule-time';

const DATE_MESSAGE = { message: 'Informe a data no formato AAAA-MM-DD.' };
const TIME_MESSAGE = { message: 'Horário no formato HH:MM, em passos de 30 minutos.' };

export class ShiftTimesDto {
  @ApiProperty({ description: 'Início (HH:MM, passos de 30 min; seg–sex 08:00–16:00, sáb e dom 13:00–16:00)' })
  @Matches(TIME_PATTERN, TIME_MESSAGE)
  startTime: string;

  @ApiProperty({ description: 'Fim (HH:MM, passos de 30 min; seg–sex 08:00–16:00, sáb e dom 13:00–16:00)' })
  @Matches(TIME_PATTERN, TIME_MESSAGE)
  endTime: string;

  @ApiPropertyOptional({ description: 'Observação (só a equipe Admin e o próprio voluntário veem)' })
  @IsOptional()
  @IsString()
  @MaxLength(300, { message: 'A observação tem no máximo 300 caracteres.' })
  notes?: string;
}

/** Marcar pela LP (sessão do código por e-mail): sempre para o próprio voluntário. */
export class PublicCreateShiftDto extends ShiftTimesDto {
  @ApiProperty({ description: 'Dia (AAAA-MM-DD)' })
  @Matches(DATE_PATTERN, DATE_MESSAGE)
  date: string;
}

export class CreateShiftDto extends PublicCreateShiftDto {
  @ApiPropertyOptional({ description: 'Marcar por outro voluntário (Agenda: Editar)' })
  @IsOptional()
  @IsUUID('4', { message: 'Voluntário inválido.' })
  userId?: string;
}

export class CreateScheduleLockDto {
  @ApiProperty({ description: 'Dia a trancar (AAAA-MM-DD)' })
  @Matches(DATE_PATTERN, DATE_MESSAGE)
  date: string;

  @ApiProperty({ description: 'Mensagem exibida na LP e no sistema' })
  @IsString()
  @IsNotEmpty({ message: 'Escreva a mensagem do dia trancado.' })
  @MaxLength(200, { message: 'A mensagem tem no máximo 200 caracteres.' })
  message: string;
}

export class RequestScheduleCodeDto {
  @ApiProperty({ description: 'E-mail do voluntário' })
  @IsEmail({}, { message: 'Informe um e-mail válido.' })
  email: string;

  @ApiProperty({ description: 'Organização' })
  @IsString()
  @IsNotEmpty({ message: 'A organização é obrigatória.' })
  organizationId: string;
}

export class VerifyScheduleCodeDto extends RequestScheduleCodeDto {
  @ApiProperty({ description: 'Código de 6 dígitos recebido por e-mail' })
  @Matches(/^\d{6}$/, { message: 'O código tem 6 números.' })
  code: string;
}

export class CancelShiftByTokenDto {
  @ApiProperty({ description: 'Token do link "Desmarcar" do e-mail' })
  @IsUUID('4', { message: 'Link de desmarcar inválido.' })
  token: string;
}
