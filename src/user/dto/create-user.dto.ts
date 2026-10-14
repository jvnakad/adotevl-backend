import { IsString, IsNotEmpty, IsEmail, IsOptional, IsDateString, Matches, MinLength, Equals, IsBoolean, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { VolunteerApplicationDto } from '../../volunteer-application/dto/volunteer-application.dto';

export class CreateUserDto {
  @IsString()
  @IsNotEmpty({ message: 'O nome completo é obrigatório.' })
  fullName: string;

  @IsString()
  @IsNotEmpty({ message: 'O CPF é obrigatório.' })
  @Matches(/^\d{11}$/, {
    message: 'O CPF deve conter exatamente 11 dígitos numéricos (sem formatação).',
  })
  cpf: string;

  @IsEmail({}, { message: 'Informe um endereço de e-mail válido.' })
  @IsNotEmpty({ message: 'O e-mail é obrigatório.' })
  email: string;

  @IsString()
  @IsNotEmpty({ message: 'A senha é obrigatória.' })
  @MinLength(8, { message: 'A senha deve ter no mínimo 8 caracteres.' })
  password: string;

  @ApiPropertyOptional({ description: 'Celular (somente números, com DDD)' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{10,11}$/, { message: 'O celular deve conter 10 ou 11 dígitos numéricos (com DDD, sem formatação).' })
  phone?: string;

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

  @ApiPropertyOptional({ type: VolunteerApplicationDto, description: 'Questionário do voluntário fixo (obrigatório, exceto para o 1º usuário da organização)' })
  @IsOptional()
  @ValidateNested()
  @Type(() => VolunteerApplicationDto)
  application?: VolunteerApplicationDto;

  /** Honeypot: campo invisível no formulário; preenchido = robô */
  @IsOptional()
  @IsString()
  website?: string;

  // Legado: ignorado (o acesso vem da equipe definida na aprovação)
  @IsString()
  @IsOptional()
  profileId?: string;

  @IsString()
  @IsNotEmpty({ message: 'A organização é obrigatória.' })
  organizationId: string;
}
