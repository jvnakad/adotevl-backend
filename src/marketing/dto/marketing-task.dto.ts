import { IsBoolean, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIsoDate } from '../../stock/stock-date';
import { IsMarketingName, IsUuidOrNull } from './marketing-text';

export class CreateMarketingTaskDto {
  @ApiProperty({ example: 'Aprovar arte', description: 'Texto da subtarefa (até 250 caracteres)' })
  @IsMarketingName(250, 'Informe o texto da subtarefa.')
  title: string;

  @ApiPropertyOptional({ nullable: true, description: 'Responsável (usuário com Editar em Marketing)' })
  @IsOptional()
  @IsUuidOrNull('Responsável inválido.')
  assigneeId?: string | null;

  @ApiPropertyOptional({ nullable: true, example: '2026-11-05', description: 'Prazo (YYYY-MM-DD)' })
  @IsOptional()
  @IsIsoDate({ message: 'Informe um prazo válido.' })
  dueDate?: string | null;
}

/** Edição parcial: campo ausente não muda; assigneeId e dueDate aceitam null para limpar. */
export class UpdateMarketingTaskDto {
  @ApiPropertyOptional({ description: 'Texto da subtarefa' })
  @IsOptional()
  @IsMarketingName(250, 'Informe o texto da subtarefa.')
  title?: string;

  @ApiPropertyOptional({ description: 'Concluída. Marcar registra SUBTAREFA_CONCLUIDA; desmarcar não gera evento' })
  @IsOptional()
  @IsBoolean({ message: 'isDone deve ser verdadeiro ou falso.' })
  isDone?: boolean;

  @ApiPropertyOptional({ nullable: true, description: 'Responsável (usuário com Editar em Marketing)' })
  @IsOptional()
  @IsUuidOrNull('Responsável inválido.')
  assigneeId?: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Prazo (YYYY-MM-DD)' })
  @IsOptional()
  @IsIsoDate({ message: 'Informe um prazo válido.' })
  dueDate?: string | null;
}
