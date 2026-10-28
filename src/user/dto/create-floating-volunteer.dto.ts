import { IsCalendarDate } from '../../common/validation/calendar-date';
import { IsString, IsNotEmpty, IsOptional, IsDateString, Matches, Equals, IsBoolean } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsCpf, IsFullName, IsPersonEmail, PERSON_MESSAGES } from '../../common/validation/person';

/** Cadastro público de voluntário volante (sem senha: a API gera uma aleatória). */
export class CreateFloatingVolunteerDto {
  @ApiProperty({ description: 'Nome completo' })
  @IsFullName()
  fullName: string;

  @ApiProperty({ description: 'CPF (somente números)' })
  @IsCpf()
  cpf: string;

  @ApiProperty({ description: 'E-mail' })
  @IsPersonEmail()
  email: string;

  @ApiProperty({ description: 'Celular/WhatsApp (somente números, com DDD)' })
  @IsString()
  @Matches(/^\d{10,11}$/, { message: 'O celular deve conter 10 ou 11 dígitos numéricos (com DDD, sem formatação).' })
  phone: string;

  @ApiProperty({ description: 'Data de nascimento (YYYY-MM-DD). Mínimo 16 anos; menor de 18 exige responsável.' })
  @IsDateString({}, { message: 'Informe uma data de nascimento válida no formato YYYY-MM-DD.' })
  @IsCalendarDate()
  birthDate: string;

  @ApiPropertyOptional({ description: 'Nome do responsável (obrigatório para menor de 18)' })
  @IsFullName({ optional: true, requiredMessage: PERSON_MESSAGES.guardianNameRequired })
  guardianName?: string;

  @ApiPropertyOptional({ description: 'Celular do responsável (obrigatório para menor de 18)' })
  @IsOptional()
  @Matches(/^\d{10,11}$/, { message: 'O celular do responsável deve conter 10 ou 11 dígitos numéricos (com DDD).' })
  guardianPhone?: string;

  @ApiPropertyOptional({ description: 'Responsável ciente e de acordo (obrigatório para menor de 18)' })
  @IsOptional()
  @IsBoolean()
  guardianConsent?: boolean;

  @ApiProperty({ description: 'Aceite LGPD' })
  @Equals(true, { message: 'É preciso autorizar o uso dos dados para contato sobre voluntariado.' })
  consent: boolean;

  @ApiProperty({ description: 'Organização' })
  @IsString()
  @IsNotEmpty({ message: 'A organização é obrigatória.' })
  organizationId: string;

  /** Honeypot: campo invisível no formulário; preenchido = robô */
  @IsOptional()
  @IsString()
  website?: string;
}
