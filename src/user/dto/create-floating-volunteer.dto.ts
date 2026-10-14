import { IsString, IsNotEmpty, IsEmail, IsOptional, IsDateString, Matches, Equals, IsBoolean } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Cadastro público de voluntário volante (sem senha: a API gera uma aleatória). */
export class CreateFloatingVolunteerDto {
  @ApiProperty({ description: 'Nome completo' })
  @IsString()
  @IsNotEmpty({ message: 'O nome completo é obrigatório.' })
  fullName: string;

  @ApiProperty({ description: 'CPF (somente números)' })
  @IsString()
  @Matches(/^\d{11}$/, { message: 'O CPF deve conter exatamente 11 dígitos numéricos (sem formatação).' })
  cpf: string;

  @ApiProperty({ description: 'E-mail' })
  @IsEmail({}, { message: 'Informe um endereço de e-mail válido.' })
  email: string;

  @ApiProperty({ description: 'Celular/WhatsApp (somente números, com DDD)' })
  @IsString()
  @Matches(/^\d{10,11}$/, { message: 'O celular deve conter 10 ou 11 dígitos numéricos (com DDD, sem formatação).' })
  phone: string;

  @ApiProperty({ description: 'Data de nascimento (YYYY-MM-DD). Mínimo 16 anos; menor de 18 exige responsável.' })
  @IsDateString({}, { message: 'Informe uma data de nascimento válida no formato YYYY-MM-DD.' })
  birthDate: string;

  @ApiPropertyOptional({ description: 'Nome do responsável (obrigatório para menor de 18)' })
  @IsOptional()
  @IsString()
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
