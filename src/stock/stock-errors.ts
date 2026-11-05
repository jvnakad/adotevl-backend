import { ConflictException } from '@nestjs/common';

const UNIQUE_NAME_INDEXES: Record<string, string> = {
  UQ_product_types_org_name_active: 'Já existe um tipo de produto com esse nome.',
  UQ_products_org_name_active: 'Já existe um produto com esse nome.',
};

/** Violação do índice único de nome (cadastro simultâneo, B-05) vira 409 com a mesma mensagem da checagem prévia. */
export function toDuplicateNameError(error: unknown): ConflictException | null {
  const driverError = (error as { driverError?: { code?: string; constraint?: string } })?.driverError;
  if (driverError?.code !== '23505') return null;
  const message = UNIQUE_NAME_INDEXES[driverError.constraint];
  return message ? new ConflictException(message) : null;
}
