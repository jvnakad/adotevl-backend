import { ArrayMaxSize, ArrayUnique, IsArray, IsOptional, IsUUID } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { cleanFreeText, IsRequiredText } from './marketing-text';

export const MAX_COMMENT = 2000;

export class CreateMarketingCommentDto {
  @ApiProperty({ example: 'Pode subir hoje @Maria Silva?', description: `Texto do comentário (até ${MAX_COMMENT} caracteres). Menção escrita como @Nome` })
  @Transform(cleanFreeText)
  @IsRequiredText(MAX_COMMENT, 'Escreva o comentário.', `O comentário pode ter até ${MAX_COMMENT.toLocaleString('pt-BR')} caracteres.`)
  body: string;

  @ApiPropertyOptional({ type: [String], description: 'Ids dos usuários escolhidos no autocomplete. O servidor mantém só quem tem Editar em Marketing e cujo @Nome aparece no texto' })
  @IsOptional()
  @IsArray({ message: 'Menções inválidas.' })
  @ArrayMaxSize(50, { message: 'No máximo 50 menções.' })
  @ArrayUnique({ message: 'Menção repetida.' })
  @IsUUID('all', { each: true, message: 'Menção inválida.' })
  mentionUserIds?: string[];
}

/** Editar o comentário: mesmo formato do envio. */
export class UpdateMarketingCommentDto extends CreateMarketingCommentDto {}
