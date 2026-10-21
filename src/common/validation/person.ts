import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsOptional, ValidateBy } from 'class-validator';

/**
 * Regras compartilhadas de cadastro de pessoa (nome completo, e-mail e CPF).
 * As mensagens são o contrato com o front e a LP: não alterar o texto sem combinar com eles.
 * Funções `validate*` devolvem a mensagem de erro (ou null se válido) e esperam o valor já normalizado.
 */

export const NAME_MAX_LENGTH = 120;
export const EMAIL_MAX_LENGTH = 254;

export const PERSON_MESSAGES = {
  nameRequired: 'Informe seu nome completo.',
  guardianNameRequired: 'Informe o nome do responsável.',
  nameLetters: 'Use apenas letras no nome.',
  nameSurname: 'Informe nome e sobrenome.',
  nameMax: `O nome pode ter no máximo ${NAME_MAX_LENGTH} caracteres.`,
  emailRequired: 'Informe seu e-mail.',
  emailInvalid: 'E-mail inválido. Confira se está no formato nome@exemplo.com.',
  cpfRequired: 'Informe seu CPF.',
  cpfLength: 'O CPF precisa ter 11 números.',
  cpfInvalid: 'CPF inválido. Confira os números.',
} as const;

// ---------------------------------------------------------------- normalização

/** Nome: Unicode NFC, sem espaços nas pontas e com espaços internos colapsados. Não-string passa direto. */
export function normalizePersonName(value: unknown): unknown {
  return typeof value === 'string' ? value.normalize('NFC').trim().replace(/\s+/g, ' ') : value;
}

/** E-mail: sem espaços nas pontas e em minúsculas. Não-string passa direto. */
export function normalizeEmail(value: unknown): unknown {
  return typeof value === 'string' ? value.trim().toLowerCase() : value;
}

/** CPF: só os dígitos (aceita com ou sem máscara). Não-string passa direto. */
export function normalizeCpf(value: unknown): unknown {
  return typeof value === 'string' ? value.replace(/\D/g, '') : value;
}

// ------------------------------------------------------------------ validação

const isEmpty = (value: unknown) => typeof value !== 'string' || value === '';

// Letras (com acento), apóstrofo (reto ou tipográfico) e hífen; espaço simples entre as palavras
const NAME_CHARS = /^[\p{L}\p{M}'’-]+( [\p{L}\p{M}'’-]+)*$/u;
const letterCount = (word: string) => (word.match(/\p{L}/gu) ?? []).length;

export function validateFullName(value: unknown): string | null {
  if (isEmpty(value)) return PERSON_MESSAGES.nameRequired;
  const name = value as string;
  if (!NAME_CHARS.test(name)) return PERSON_MESSAGES.nameLetters;
  const words = name.split(' ');
  if (words.some((word) => letterCount(word) === 0)) return PERSON_MESSAGES.nameLetters;
  // Partículas (da, de, dos, e) só valem no meio: primeira e última palavra têm pelo menos 2 letras
  if (words.length < 2 || letterCount(words[0]) < 2 || letterCount(words[words.length - 1]) < 2) {
    return PERSON_MESSAGES.nameSurname;
  }
  if (name.length > NAME_MAX_LENGTH) return PERSON_MESSAGES.nameMax;
  return null;
}

const EMAIL_LOCAL = /^[a-z0-9!#$%&'*+/=?^_`{|}~.-]+$/;
const EMAIL_DOMAIN_LABEL = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

export function validateEmail(value: unknown): string | null {
  if (isEmpty(value)) return PERSON_MESSAGES.emailRequired;
  const email = value as string;
  if (email.length > EMAIL_MAX_LENGTH || email.includes('..')) return PERSON_MESSAGES.emailInvalid;
  const parts = email.split('@');
  if (parts.length !== 2) return PERSON_MESSAGES.emailInvalid;
  const [local, domain] = parts;
  if (!EMAIL_LOCAL.test(local)) return PERSON_MESSAGES.emailInvalid;
  const labels = domain.split('.');
  const tld = labels[labels.length - 1];
  if (labels.length < 2 || !/^[a-z]{2,}$/.test(tld) || !labels.every((label) => EMAIL_DOMAIN_LABEL.test(label))) {
    return PERSON_MESSAGES.emailInvalid;
  }
  return null;
}

function cpfCheckDigit(digits: string, length: number): number {
  let sum = 0;
  for (let i = 0; i < length; i++) sum += Number(digits[i]) * (length + 1 - i);
  const rest = (sum * 10) % 11;
  return rest === 10 ? 0 : rest;
}

/** CPF com 11 dígitos, não repetidos, e dígitos verificadores corretos. */
export function isValidCpf(digits: string): boolean {
  if (!/^\d{11}$/.test(digits) || /^(\d)\1{10}$/.test(digits)) return false;
  return cpfCheckDigit(digits, 9) === Number(digits[9]) && cpfCheckDigit(digits, 10) === Number(digits[10]);
}

export function validateCpf(value: unknown): string | null {
  if (isEmpty(value)) return PERSON_MESSAGES.cpfRequired;
  const cpf = value as string;
  if (!/^\d{11}$/.test(cpf)) return PERSON_MESSAGES.cpfLength;
  return isValidCpf(cpf) ? null : PERSON_MESSAGES.cpfInvalid;
}

// ----------------------------------------------------------------- decorators

export interface PersonFieldOptions {
  /** Campo opcional: ausente ou "" vira undefined e não é validado. */
  optional?: boolean;
  /** Mensagem usada quando o valor enviado é vazio (no lugar da padrão). Com ela, "" deixa de valer como ausente. */
  requiredMessage?: string;
}

function personField(
  name: string,
  normalize: (value: unknown) => unknown,
  validate: (value: unknown) => string | null,
  { optional, requiredMessage }: PersonFieldOptions = {},
) {
  return applyDecorators(
    Transform(({ value }) => {
      const normalized = normalize(value);
      return optional && !requiredMessage && normalized === '' ? undefined : normalized;
    }),
    ...(optional ? [IsOptional()] : []),
    ValidateBy({
      name,
      validator: {
        validate: (value) => validate(value) === null,
        defaultMessage: (args) => {
          const message = validate(args?.value) ?? '';
          return requiredMessage && isEmpty(args?.value) ? requiredMessage : message;
        },
      },
    }),
  );
}

/** Nome completo: normaliza (trim + espaços) e valida nome e sobrenome. */
export const IsFullName = (options?: PersonFieldOptions) => personField('isFullName', normalizePersonName, validateFullName, options);

/** E-mail: normaliza (trim + minúsculas) e valida o formato. */
export const IsPersonEmail = (options?: PersonFieldOptions) => personField('isPersonEmail', normalizeEmail, validateEmail, options);

/** CPF: aceita com ou sem máscara, normaliza para só dígitos e valida os dígitos verificadores. */
export const IsCpf = (options?: PersonFieldOptions) => personField('isCpf', normalizeCpf, validateCpf, options);
