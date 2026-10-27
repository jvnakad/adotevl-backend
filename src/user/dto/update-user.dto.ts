import { IsString, IsOptional, IsDateString, Matches } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsCpf, IsFullName, IsPersonEmail } from '../../common/validation/person';

export class UpdateUserDto {
  @ApiPropertyOptional({ description: 'Nome completo' })
  @IsFullName({ optional: true })
  fullName?: string;

  @ApiPropertyOptional({ description: 'E-mail de login (só o admin altera o de outro usuário)' })
  @IsPersonEmail({ optional: true })
  email?: string;

  @ApiPropertyOptional({ description: 'CPF (somente números, 11 dígitos)' })
  @IsCpf({ optional: true })
  cpf?: string;

  @ApiPropertyOptional({ description: 'Celular (somente números, com DDD)' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{10,11}$/, { message: 'O celular deve conter 10 ou 11 dígitos numéricos (com DDD, sem formatação).' })
  phone?: string;

  @ApiPropertyOptional({ description: 'Data de nascimento (formato: YYYY-MM-DD)' })
  @IsOptional()
  @IsDateString({}, { message: 'Informe uma data válida no formato YYYY-MM-DD.' })
  birthDate?: string;

  @ApiPropertyOptional({ description: 'Ativo/inativo' })
  @IsOptional()
  isActive?: boolean;
}
