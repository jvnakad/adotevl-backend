import { AdoptionForm } from '../adoption-form/adoption-form.entity';
import { Pet } from '../pet/pet.entity';
import { ContractData } from './adoption-contract.entity';
import { DEFAULT_SIGNATURE_CITY } from './contract-template';

type Section = keyof ContractData;
type FieldKind = 'text' | 'date' | 'boolean' | 'species' | 'sex';

const MAX_FIELD_LENGTH = 500;
const DATE_FORMAT = /^\d{4}-\d{2}-\d{2}$/;

// Campos conhecidos do contrato (o resto do payload é descartado) com rótulo para histórico/erros
export const CONTRACT_DATA_FIELDS: Record<Section, Record<string, { label: string; kind: FieldKind }>> = {
  adopter: {
    name: { label: 'Nome do adotante', kind: 'text' },
    age: { label: 'Idade do adotante', kind: 'text' },
    birthDate: { label: 'Data de nascimento do adotante', kind: 'date' },
    rg: { label: 'RG do adotante', kind: 'text' },
    cpf: { label: 'CPF do adotante', kind: 'text' },
    email: { label: 'E-mail do adotante', kind: 'text' },
    phone: { label: 'Telefone do adotante', kind: 'text' },
    profession: { label: 'Profissão do adotante', kind: 'text' },
    address: { label: 'Endereço do adotante', kind: 'text' },
  },
  animal: {
    name: { label: 'Nome do animal', kind: 'text' },
    species: { label: 'Espécie do animal', kind: 'species' },
    sex: { label: 'Sexo do animal', kind: 'sex' },
    breed: { label: 'Raça do animal', kind: 'text' },
    coat: { label: 'Pelagem do animal', kind: 'text' },
    distinctiveMarks: { label: 'Sinais característicos', kind: 'text' },
    age: { label: 'Idade do animal', kind: 'text' },
    castrated: { label: 'Castrado', kind: 'boolean' },
    vaccinated: { label: 'Vacinado', kind: 'boolean' },
    temperament: { label: 'Temperamento', kind: 'text' },
    usesMedication: { label: 'Utiliza medicação', kind: 'boolean' },
    medicationDetails: { label: 'Detalhes da medicação', kind: 'text' },
  },
  signature: {
    city: { label: 'Local da assinatura', kind: 'text' },
    date: { label: 'Data da assinatura', kind: 'date' },
  },
};

export function emptyContractData(): ContractData {
  return {
    adopter: { name: '', age: '', birthDate: '', rg: '', cpf: '', email: '', phone: '', profession: '', address: '' },
    animal: {
      name: '',
      species: '',
      sex: '',
      breed: '',
      coat: '',
      distinctiveMarks: '',
      age: '',
      castrated: null,
      vaccinated: null,
      temperament: '',
      usesMedication: null,
      medicationDetails: '',
    },
    signature: { city: DEFAULT_SIGNATURE_CITY, date: null },
  };
}

const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'}`;

const pad = (n: number) => String(n).padStart(2, '0');

// Coluna "date" -> "YYYY-MM-DD". O driver pg devolve Date à meia-noite LOCAL (toISOString voltaria um dia em UTC-3);
// já new Date('YYYY-MM-DD') fica à meia-noite UTC. Trata os dois casos.
export const dateOnly = (value: Date | string) => {
  if (!value) return '';
  if (!(value instanceof Date)) return String(value).slice(0, 10);
  if (Number.isNaN(value.getTime())) return '';
  if (value.getUTCHours() === 0 && value.getUTCMinutes() === 0) return value.toISOString().slice(0, 10);
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
};

export function ageFromBirthDate(birthDate: string, today = new Date()) {
  const match = DATE_FORMAT.exec(birthDate ?? '') ? birthDate.split('-').map(Number) : null;
  if (!match) return '';
  const [year, month, day] = match;
  let age = today.getFullYear() - year;
  if (today.getMonth() + 1 < month || (today.getMonth() + 1 === month && today.getDate() < day)) age--;
  return age >= 0 ? plural(age, 'ano') : '';
}

const formatZip = (zip: string) => {
  const digits = (zip ?? '').replace(/\D/g, '');
  return digits.length === 8 ? `${digits.slice(0, 5)}-${digits.slice(5)}` : zip;
};

// "street, nº number - complement - neighborhood - city/state - CEP zip"
export function formatAdopterAddress(form: AdoptionForm) {
  return [
    `${form.street}, nº ${form.number}`,
    form.complement,
    form.neighborhood,
    `${form.city}/${form.state}`,
    form.zipCode ? `CEP ${formatZip(form.zipCode)}` : null,
  ]
    .filter((part) => part && String(part).trim())
    .join(' - ');
}

const normalize = (text: string) => (text ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function speciesFromPet(pet: Pet) {
  const text = `${normalize(pet.species)} ${normalize(pet.animal)}`;
  if (/cao|cachorr|canin|dog/.test(text)) return 'CANINA';
  if (/gat|felin|cat/.test(text)) return 'FELINA';
  return '';
}

export function sexFromPet(pet: Pet) {
  const sex = normalize(pet.sex);
  if (sex.startsWith('m')) return 'MACHO';
  if (sex.startsWith('f')) return 'FEMEA';
  return '';
}

export function buildInitialData(form: AdoptionForm, pet?: Pet | null): ContractData {
  const data = emptyContractData();
  const birthDate = dateOnly(form.birthDate);
  data.adopter = {
    ...data.adopter,
    name: form.fullName ?? '',
    age: ageFromBirthDate(birthDate),
    birthDate,
    cpf: form.cpf ?? '',
    email: form.email ?? '',
    phone: form.phone ?? '',
    profession: form.occupation ?? '',
    address: formatAdopterAddress(form),
  };
  return pet ? prefillAnimalFromPet(data, pet) : data;
}

// Preenche só os campos do animal ainda vazios (não sobrescreve o que a equipe digitou)
export function prefillAnimalFromPet(data: ContractData, pet: Pet): ContractData {
  const fromPet: Partial<ContractData['animal']> = {
    name: pet.name ?? '',
    species: speciesFromPet(pet),
    sex: sexFromPet(pet),
    breed: pet.animal ?? '',
    age: pet.age !== null && pet.age !== undefined ? plural(pet.age, 'ano') : '',
    castrated: typeof pet.castration === 'boolean' ? pet.castration : null,
  };
  const animal = { ...data.animal };
  for (const [field, value] of Object.entries(fromPet)) {
    const current = animal[field];
    if ((current === '' || current === null || current === undefined) && value !== '' && value !== null) animal[field] = value;
  }
  return { ...data, animal };
}

function sanitizeField(value: unknown, kind: FieldKind, label: string, errors: string[]) {
  if (kind === 'boolean') {
    if (value === null || typeof value === 'boolean') return value;
    errors.push(`${label}: informe true, false ou null.`);
    return undefined;
  }
  if (value === null && kind === 'date') return '';
  if (typeof value !== 'string') {
    errors.push(`${label} deve ser um texto.`);
    return undefined;
  }
  const text = value.trim();
  if (text.length > MAX_FIELD_LENGTH) errors.push(`${label} deve ter no máximo ${MAX_FIELD_LENGTH} caracteres.`);
  if (kind === 'date' && text && (!DATE_FORMAT.test(text) || Number.isNaN(new Date(text).getTime()))) {
    errors.push(`${label} deve estar no formato YYYY-MM-DD.`);
  }
  if (kind === 'species' && !['', 'CANINA', 'FELINA'].includes(text)) errors.push(`${label} deve ser CANINA ou FELINA.`);
  if (kind === 'sex' && !['', 'MACHO', 'FEMEA'].includes(text)) errors.push(`${label} deve ser MACHO ou FEMEA.`);
  return text;
}

// Mescla o payload sobre os dados atuais aceitando só as chaves conhecidas; devolve os erros em PT-BR
export function sanitizeContractData(input: Record<string, any>, current: ContractData): { data: ContractData; errors: string[] } {
  const errors: string[] = [];
  const base = emptyContractData();
  const data = {} as ContractData;

  for (const section of Object.keys(CONTRACT_DATA_FIELDS) as Section[]) {
    const incoming = input?.[section];
    if (incoming !== undefined && (incoming === null || typeof incoming !== 'object' || Array.isArray(incoming))) {
      errors.push(`Dados do termo de adoção inválidos em "${section}".`);
    }
    const target: Record<string, any> = { ...base[section], ...(current?.[section] ?? {}) };
    for (const [field, { label, kind }] of Object.entries(CONTRACT_DATA_FIELDS[section])) {
      const value = incoming && typeof incoming === 'object' ? incoming[field] : undefined;
      if (value === undefined) continue;
      const clean = sanitizeField(value, kind, label, errors);
      if (clean !== undefined) target[field] = clean;
    }
    // Mantém só as chaves conhecidas mesmo nos dados antigos
    data[section] = Object.fromEntries(Object.keys(CONTRACT_DATA_FIELDS[section]).map((field) => [field, target[field]])) as any;
  }

  if (!data.signature.city) data.signature.city = DEFAULT_SIGNATURE_CITY;
  if (!data.signature.date) data.signature.date = null;
  return { data, errors };
}

const same = (a: unknown, b: unknown) => (a ?? '') === (b ?? '');

export function diffContractData(before: ContractData, after: ContractData) {
  const fields: { field: string; label: string; before: unknown; after: unknown }[] = [];
  for (const section of Object.keys(CONTRACT_DATA_FIELDS) as Section[]) {
    for (const [field, { label }] of Object.entries(CONTRACT_DATA_FIELDS[section])) {
      const previous = before?.[section]?.[field] ?? null;
      const next = after?.[section]?.[field] ?? null;
      if (!same(previous, next)) fields.push({ field: `${section}.${field}`, label, before: previous, after: next });
    }
  }
  return fields;
}
