import { ConflictException } from '@nestjs/common';

const UNIQUE_NAME_INDEXES: Record<string, string> = {
  UQ_marketing_lists_org_name_active: 'Já existe uma fila com esse nome.',
  UQ_marketing_labels_org_name_active: 'Já existe uma etiqueta com esse nome.',
};

/** Violação do índice único de nome (cadastro simultâneo) vira 409 com a mesma mensagem da checagem prévia. */
export function toDuplicateNameError(error: unknown): ConflictException | null {
  const driverError = (error as { driverError?: { code?: string; constraint?: string } })?.driverError;
  if (driverError?.code !== '23505') return null;
  const message = UNIQUE_NAME_INDEXES[driverError.constraint];
  return message ? new ConflictException(message) : null;
}
