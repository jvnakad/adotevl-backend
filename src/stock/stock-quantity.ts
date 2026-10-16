import { BadRequestException } from '@nestjs/common';
import { ProductUnit } from './product.entity';

const MAX_INTEGER_DIGITS = 9; // numeric(12,3)
const FORMAT = /^-?\d+(\.\d+)?$/;

/**
 * Valida a quantidade recebida (string ou número com ponto) e devolve a string canônica com 3 casas ("2.500").
 * Nunca arredonda: o que não cabe é recusado (RN-26, D-18).
 */
export function parseQuantity(raw: unknown, unit: ProductUnit): string {
  if (raw === undefined || raw === null || (typeof raw === 'string' && raw.trim() === '')) {
    throw new BadRequestException('Informe a quantidade.');
  }
  if (typeof raw !== 'string' && typeof raw !== 'number') {
    throw new BadRequestException('Quantidade inválida. Use apenas números, com ponto como separador decimal.');
  }
  // Número JSON vira texto antes (1e21 e 1e-7 saem em notação científica e caem no formato inválido)
  const text = String(raw).trim();
  if (!FORMAT.test(text)) {
    throw new BadRequestException('Quantidade inválida. Use apenas números, com ponto como separador decimal.');
  }

  const negative = text.startsWith('-');
  const [integerRaw, fractionRaw = ''] = text.replace('-', '').split('.');
  const integer = integerRaw.replace(/^0+(?=\d)/, '');
  const isZero = /^0*$/.test(integerRaw) && /^0*$/.test(fractionRaw);

  if (negative && !isZero) throw new BadRequestException('A quantidade não pode ser negativa.');
  // Mais de 3 casas é recusado mesmo com zeros à direita ("2.5000"): o formato aceito tem no máximo 3
  if (fractionRaw.length > 3) throw new BadRequestException('A quantidade pode ter no máximo 3 casas decimais.');
  if (unit === ProductUnit.UNIT && /[1-9]/.test(fractionRaw)) {
    throw new BadRequestException('Quantidade em unidade deve ser um número inteiro.');
  }
  if (integer.length > MAX_INTEGER_DIGITS) throw new BadRequestException('A quantidade máxima é 999999999,999.');

  return `${isZero ? '0' : integer}.${fractionRaw.padEnd(3, '0')}`;
}

/** Quantidade para texto de histórico (RN-34): "10 un", "2,500 kg", "1,000 L"; vírgula decimal e sem milhar. */
export function formatQuantity(quantity: string, unit: ProductUnit): string {
  const [integer, fraction = '000'] = String(quantity).split('.');
  if (unit === ProductUnit.UNIT) return `${integer} un`;
  return `${integer},${fraction.padEnd(3, '0').slice(0, 3)} ${unit === ProductUnit.KG ? 'kg' : 'L'}`;
}
