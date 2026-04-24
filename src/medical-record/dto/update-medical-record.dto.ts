import { IsString, IsOptional, IsEnum, IsDateString, IsUrl } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { MedicalRecordType } from '../medical-record.entity';

export class UpdateMedicalRecordDto {
  @ApiPropertyOptional({ description: 'Data da consulta (formato: YYYY-MM-DD)' })
  @IsOptional()
  @IsDateString({}, { message: 'Informe uma data válida no formato YYYY-MM-DD.' })
  date?: string;

  @ApiPropertyOptional({ enum: MedicalRecordType, description: 'Tipo: CONSULTA, VACINA, MEDICACAO, EXAME, PROCEDIMENTO' })
  @IsOptional()
  @IsEnum(MedicalRecordType, { message: 'Tipo inválido. Use: CONSULTA, VACINA, MEDICACAO, EXAME ou PROCEDIMENTO.' })
  type?: MedicalRecordType;

  @ApiPropertyOptional({ description: 'Descrição' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: 'Nome do veterinário' })
  @IsOptional()
  @IsString()
  veterinarianName?: string;

  @ApiPropertyOptional({ description: 'Data da próxima consulta (formato: YYYY-MM-DD)' })
  @IsOptional()
  @IsDateString({}, { message: 'Informe uma data válida no formato YYYY-MM-DD.' })
  nextDate?: string;

  @ApiPropertyOptional({ description: 'URL do anexo (receita, exame, etc.)' })
  @IsOptional()
  @IsUrl({}, { message: 'Informe uma URL válida.' })
  attachmentUrl?: string;
}
