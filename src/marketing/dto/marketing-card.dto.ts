import { ArrayMaxSize, ArrayUnique, IsArray, IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIsoDate } from '../../stock/stock-date';
import { PaginationDto } from '../../common/pagination.dto';
import { IsSearchText } from '../../stock/dto/is-search-text';
import { cleanFreeText, IsMarketingName, IsUuidOrNull } from './marketing-text';

export const MAX_DESCRIPTION = 5000;
const MAX_LINKS = 50;

export class CreateMarketingCardDto {
  @ApiProperty({ description: 'Fila onde o card entra (no fim). Fila ativa da organização' })
  @IsUUID('all', { message: 'Escolha a fila.' })
  listId: string;

  @ApiProperty({ example: 'Post de adoção do mês', description: 'Título (até 250 caracteres)' })
  @IsMarketingName(250, 'Informe o título do card.')
  title: string;

  @ApiPropertyOptional({ nullable: true, description: `Descrição (até ${MAX_DESCRIPTION} caracteres)` })
  @IsOptional()
  @Transform(cleanFreeText)
  @IsString({ message: 'A descrição deve ser um texto.' })
  @MaxLength(MAX_DESCRIPTION, { message: `A descrição pode ter até ${MAX_DESCRIPTION} caracteres.` })
  description?: string | null;

  @ApiPropertyOptional({ nullable: true, example: '2026-11-05', description: 'Prazo de entrega (YYYY-MM-DD)' })
  @IsOptional()
  @IsIsoDate({ message: 'Informe um prazo de entrega válido.' })
  dueDate?: string | null;

  @ApiPropertyOptional({ nullable: true, example: '2026-11-10', description: 'Data de publicação (YYYY-MM-DD, sem horário)' })
  @IsOptional()
  @IsIsoDate({ message: 'Informe uma data de publicação válida.' })
  publishDate?: string | null;
}

/** Edição parcial: campo ausente não muda; description e as datas aceitam null para limpar; listId move para o fim da fila. */
export class UpdateMarketingCardDto {
  @ApiPropertyOptional({ description: 'Título' })
  @IsOptional()
  @IsMarketingName(250, 'Informe o título do card.')
  title?: string;

  @ApiPropertyOptional({ nullable: true, description: 'Descrição' })
  @IsOptional()
  @Transform(cleanFreeText)
  @IsString({ message: 'A descrição deve ser um texto.' })
  @MaxLength(MAX_DESCRIPTION, { message: `A descrição pode ter até ${MAX_DESCRIPTION} caracteres.` })
  description?: string | null;

  @ApiPropertyOptional({ description: 'Nova fila: o card vai para o fim dela e gera CARD_MOVIDO' })
  @IsOptional()
  @IsUUID('all', { message: 'Escolha a fila.' })
  listId?: string;

  @ApiPropertyOptional({ nullable: true, description: 'Prazo de entrega (YYYY-MM-DD)' })
  @IsOptional()
  @IsIsoDate({ message: 'Informe um prazo de entrega válido.' })
  dueDate?: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Data de publicação (YYYY-MM-DD)' })
  @IsOptional()
  @IsIsoDate({ message: 'Informe uma data de publicação válida.' })
  publishDate?: string | null;

  @ApiPropertyOptional({ type: [String], description: 'Conjunto completo de membros (ids de usuário). Quem entra precisa ter Editar em Marketing; quem já era membro pode ficar' })
  @IsOptional()
  @IsArray({ message: 'Membros inválidos.' })
  @ArrayMaxSize(MAX_LINKS, { message: `No máximo ${MAX_LINKS} membros.` })
  @ArrayUnique({ message: 'Membro repetido.' })
  @IsUUID('all', { each: true, message: 'Membro inválido.' })
  memberIds?: string[];

  @ApiPropertyOptional({ type: [String], description: 'Conjunto completo de etiquetas (ids). Só etiquetas ativas da organização' })
  @IsOptional()
  @IsArray({ message: 'Etiquetas inválidas.' })
  @ArrayMaxSize(MAX_LINKS, { message: `No máximo ${MAX_LINKS} etiquetas.` })
  @ArrayUnique({ message: 'Etiqueta repetida.' })
  @IsUUID('all', { each: true, message: 'Etiqueta inválida.' })
  labelIds?: string[];
}

export class MoveMarketingCardDto {
  @ApiProperty({ description: 'Fila de destino (pode ser a mesma)' })
  @IsUUID('all', { message: 'Escolha a fila.' })
  listId: string;

  @ApiPropertyOptional({ enum: ['last'], description: 'last = fim da fila de destino (menu "Mover para", card rápido). Não combina com afterCardId/beforeCardId' })
  @IsOptional()
  @IsIn(['last'], { message: 'position só aceita "last".' })
  position?: 'last';

  @ApiPropertyOptional({ nullable: true, description: 'Card visível que fica ANTES do movido (o movido entra logo depois dele). Deve estar na fila de destino' })
  @IsOptional()
  @IsUuidOrNull('Card vizinho inválido.')
  afterCardId?: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Card visível que fica DEPOIS do movido (o movido entra logo antes dele). Deve estar na fila de destino. Com os dois, afterCardId deve vir antes de beforeCardId' })
  @IsOptional()
  @IsUuidOrNull('Card vizinho inválido.')
  beforeCardId?: string | null;
}

export class SetCoverDto {
  @ApiProperty({ nullable: true, description: 'Anexo (imagem ativa do card) que vira capa; null remove a capa' })
  @IsUuidOrNull('Anexo inválido.')
  attachmentId: string | null;
}

export class FindArchivedCardsDto extends PaginationDto {
  @ApiPropertyOptional({ description: 'Busca parcial pelo título (sem acento nem maiúscula)' })
  @IsOptional()
  @IsSearchText()
  search?: string;
}
