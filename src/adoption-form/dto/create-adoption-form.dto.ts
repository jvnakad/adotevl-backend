import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsIn,
  IsInt,
  IsBoolean,
  IsEmail,
  IsDateString,
  IsUUID,
  Matches,
  Min,
  Max,
  MaxLength,
  Equals,
  ValidateIf,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// Valores aceitos em cada pergunta de múltipla escolha (espelham src/constants/adoptionFormOptions.ts do front)
export const YES_NO = ['yes', 'no'];
export const YES_NO_MAYBE = ['yes', 'no', 'maybe'];
export const YES_NO_UNKNOWN = ['yes', 'no', 'unknown'];
export const NEUTERING_IMPORTANCE = ['yes', 'no', 'not_important'];
export const VACCINE_STATUS = ['all_up_to_date', 'not_all', 'no_pets'];
export const FIV_FELV = ['yes', 'no', 'no_cat'];
export const SAW_AD_ON = ['facebook', 'instagram', 'tiktok', 'whatsapp', 'other'];
export const RESIDENCE_TYPE = ['apartment', 'house', 'farm', 'ranch'];
export const WINDOWS_SCREENED = ['all_screened', 'will_screen', 'wont_screen', 'not_adopting_cat'];
export const HOUSING_OWNERSHIP = ['owned', 'rented', 'other'];
export const EVERYONE_AGREES = ['yes', 'no', 'not_all'];
export const AGREEMENT = ['agree', 'disagree'];

// Multipart envia tudo como string: remove espaços e trata "" como não informado
const Trim = () =>
  Transform(({ value }) => {
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    return trimmed === '' ? undefined : trimmed;
  });

const ToInt = () =>
  Transform(({ value }) => {
    if (value === undefined || value === null || value === '') return undefined;
    const parsed = Number(value);
    return Number.isNaN(parsed) ? value : parsed;
  });

const ToBoolean = () =>
  Transform(({ value }) => {
    if (value === 'true' || value === true) return true;
    if (value === 'false' || value === false) return false;
    return value;
  });

const required = (label: string) => IsNotEmpty({ message: `${label} é obrigatório.` });
const choice = (values: string[], label: string) =>
  IsIn(values, { message: `${label}: opção inválida. Use: ${values.join(', ')}.` });
const text = (label: string, max = 2000) =>
  MaxLength(max, { message: `${label} deve ter no máximo ${max} caracteres.` });

export class CreateAdoptionFormDto {
  // ------------------------------------------------------------
  // Etapa 1 — Sobre você
  // ------------------------------------------------------------
  @ApiProperty({ description: 'Nome completo' })
  @Trim() @required('Nome completo') @IsString() @text('Nome completo', 150)
  fullName: string;

  @ApiProperty({ description: 'Email' })
  @Trim() @required('Email') @IsEmail({}, { message: 'Informe um email válido.' })
  email: string;

  @ApiProperty({ description: 'Data de nascimento (YYYY-MM-DD)' })
  @Trim() @required('Data de nascimento') @IsDateString({}, { message: 'Informe uma data de nascimento válida no formato YYYY-MM-DD.' })
  birthDate: string;

  @ApiProperty({ description: 'CPF (somente dígitos)' })
  @Trim() @required('CPF') @Matches(/^\d{11}$/, { message: 'CPF deve conter 11 dígitos numéricos.' })
  cpf: string;

  @ApiProperty({ description: 'Telefone com DDD (somente dígitos)' })
  @Trim() @required('Telefone') @Matches(/^\d{10,11}$/, { message: 'Telefone deve conter 10 ou 11 dígitos numéricos.' })
  phone: string;

  @ApiProperty({ description: 'O telefone é WhatsApp? (true/false)' })
  @ToBoolean() @IsBoolean({ message: 'Informe se o telefone é WhatsApp (true ou false).' })
  phoneIsWhatsapp: boolean;

  @ApiProperty({ description: 'Profissão' })
  @Trim() @required('Profissão') @IsString() @text('Profissão', 150)
  occupation: string;

  @ApiProperty({ description: 'CEP (somente dígitos)' })
  @Trim() @required('CEP') @Matches(/^\d{8}$/, { message: 'CEP deve conter 8 dígitos numéricos.' })
  zipCode: string;

  @ApiProperty({ description: 'Rua' })
  @Trim() @required('Rua') @IsString() @text('Rua', 200)
  street: string;

  @ApiProperty({ description: 'Número' })
  @Trim() @required('Número') @IsString() @text('Número', 20)
  number: string;

  @ApiPropertyOptional({ description: 'Complemento' })
  @Trim() @IsOptional() @IsString() @text('Complemento', 150)
  complement?: string;

  @ApiProperty({ description: 'Bairro' })
  @Trim() @required('Bairro') @IsString() @text('Bairro', 150)
  neighborhood: string;

  @ApiProperty({ description: 'Cidade' })
  @Trim() @required('Cidade') @IsString() @text('Cidade', 150)
  city: string;

  @ApiProperty({ description: 'UF (2 letras)' })
  @Trim() @required('UF') @Matches(/^[A-Za-z]{2}$/, { message: 'UF deve conter 2 letras.' })
  state: string;

  // ------------------------------------------------------------
  // Etapa 2 — Animais em casa
  // ------------------------------------------------------------
  @ApiProperty({ enum: YES_NO, description: 'Tem outros animais?' })
  @Trim() @choice(YES_NO, 'Tem outros animais')
  hasPets: string;

  @ApiPropertyOptional({ description: 'Quantidade de animais (obrigatório se hasPets = yes)' })
  @ToInt() @ValidateIf((o) => o.hasPets === 'yes' || o.petsCount !== undefined)
  @IsInt({ message: 'Quantidade de animais deve ser um número inteiro.' })
  @Min(0, { message: 'Quantidade de animais inválida.' })
  petsCount?: number;

  @ApiPropertyOptional({ description: 'Quais animais tem (obrigatório se hasPets = yes)' })
  @Trim() @ValidateIf((o) => o.hasPets === 'yes' || o.petsDescription !== undefined)
  @required('Descrição dos animais') @IsString() @text('Descrição dos animais')
  petsDescription?: string;

  @ApiPropertyOptional({ enum: YES_NO, description: 'São castrados? (obrigatório se hasPets = yes)' })
  @Trim() @ValidateIf((o) => o.hasPets === 'yes' || o.petsNeutered !== undefined)
  @choice(YES_NO, 'Animais castrados')
  petsNeutered?: string;

  @ApiPropertyOptional({ description: 'Por que não são castrados (obrigatório se petsNeutered = no)' })
  @Trim() @ValidateIf((o) => o.petsNeutered === 'no' || o.petsNotNeuteredReason !== undefined)
  @required('Motivo de não castrar') @IsString() @text('Motivo de não castrar')
  petsNotNeuteredReason?: string;

  @ApiProperty({ enum: NEUTERING_IMPORTANCE, description: 'Conhece a importância da castração?' })
  @Trim() @choice(NEUTERING_IMPORTANCE, 'Importância da castração')
  knowsNeuteringImportance: string;

  @ApiProperty({ enum: VACCINE_STATUS, description: 'Vacinas em dia (no_pets quando não tem animais)' })
  @Trim() @choice(VACCINE_STATUS, 'Vacinas em dia')
  petsVaccinesUpToDate: string;

  @ApiProperty({ enum: FIV_FELV, description: 'Gatos testados para FIV/FeLV (no_cat quando não tem gato)' })
  @Trim() @choice(FIV_FELV, 'Teste FIV/FeLV')
  catFivFelvTested: string;

  // ------------------------------------------------------------
  // Etapa 3 — O animal que você quer
  // ------------------------------------------------------------
  @ApiProperty({ enum: YES_NO, description: 'Ciente do período de adaptação?' })
  @Trim() @choice(YES_NO, 'Período de adaptação')
  awareOfAdaptationPeriod: string;

  @ApiPropertyOptional({ description: 'Pet disponível escolhido no select (sem ele, desiredAnimal descreve o animal procurado)' })
  @Trim() @IsOptional() @IsUUID('all', { message: 'Animal escolhido inválido.' })
  desiredPetId?: string;

  @ApiProperty({ description: 'Animal que procura (nome do pet escolhido ou descrição livre)' })
  @Trim() @required('Animal desejado') @IsString() @text('Animal desejado')
  desiredAnimal: string;

  @ApiProperty({ enum: SAW_AD_ON, description: 'Onde viu a divulgação' })
  @Trim() @choice(SAW_AD_ON, 'Onde viu a divulgação')
  sawAdOn: string;

  @ApiPropertyOptional({ description: 'Outro local da divulgação (obrigatório se sawAdOn = other)' })
  @Trim() @ValidateIf((o) => o.sawAdOn === 'other' || o.sawAdOnOther !== undefined)
  @required('Outro local da divulgação') @IsString() @text('Outro local da divulgação', 200)
  sawAdOnOther?: string;

  @ApiProperty({ enum: YES_NO, description: 'Pode arcar com os custos?' })
  @Trim() @choice(YES_NO, 'Arcar com os custos')
  canAffordCare: string;

  @ApiProperty({ description: 'Ração pretendida' })
  @Trim() @required('Ração pretendida') @IsString() @text('Ração pretendida')
  intendedFood: string;

  @ApiProperty({ enum: YES_NO, description: 'Tem clínica veterinária de confiança?' })
  @Trim() @choice(YES_NO, 'Clínica de confiança')
  hasTrustedClinic: string;

  @ApiPropertyOptional({ description: 'Nome da clínica (obrigatório se hasTrustedClinic = yes)' })
  @Trim() @ValidateIf((o) => o.hasTrustedClinic === 'yes' || o.trustedClinicName !== undefined)
  @required('Nome da clínica') @IsString() @text('Nome da clínica', 200)
  trustedClinicName?: string;

  // ------------------------------------------------------------
  // Etapa 4 — Sua casa
  // ------------------------------------------------------------
  @ApiProperty({ enum: RESIDENCE_TYPE, description: 'Tipo de residência' })
  @Trim() @choice(RESIDENCE_TYPE, 'Tipo de residência')
  residenceType: string;

  @ApiPropertyOptional({ description: 'Posição do condomínio sobre animais (obrigatório se residenceType = apartment)' })
  @Trim() @ValidateIf((o) => o.residenceType === 'apartment' || o.condoPetPolicy !== undefined)
  @required('Posição do condomínio') @IsString() @text('Posição do condomínio')
  condoPetPolicy?: string;

  @ApiProperty({ enum: WINDOWS_SCREENED, description: 'Janelas teladas' })
  @Trim() @choice(WINDOWS_SCREENED, 'Janelas teladas')
  windowsScreened: string;

  @ApiProperty({ enum: HOUSING_OWNERSHIP, description: 'Imóvel próprio ou alugado' })
  @Trim() @choice(HOUSING_OWNERSHIP, 'Tipo de imóvel')
  housingOwnership: string;

  @ApiPropertyOptional({ description: 'Outro tipo de imóvel (obrigatório se housingOwnership = other)' })
  @Trim() @ValidateIf((o) => o.housingOwnership === 'other' || o.housingOwnershipOther !== undefined)
  @required('Outro tipo de imóvel') @IsString() @text('Outro tipo de imóvel', 200)
  housingOwnershipOther?: string;

  @ApiProperty({ description: 'Quantidade de adultos na casa' })
  @ToInt() @IsInt({ message: 'Quantidade de adultos deve ser um número inteiro.' })
  @Min(1, { message: 'Informe pelo menos 1 adulto.' })
  adultsCount: number;

  @ApiProperty({ description: 'Quantidade de crianças na casa (0 se nenhuma)' })
  @ToInt() @IsInt({ message: 'Quantidade de crianças deve ser um número inteiro.' })
  @Min(0, { message: 'Quantidade de crianças inválida.' })
  childrenCount: number;

  @ApiPropertyOptional({ description: 'Idade das crianças (obrigatório se childrenCount > 0)' })
  @Trim() @ValidateIf((o) => o.childrenCount > 0 || o.childrenAges !== undefined)
  @required('Idade das crianças') @IsString() @text('Idade das crianças', 200)
  childrenAges?: string;

  // ------------------------------------------------------------
  // Etapa 5 — Rotina e família
  // ------------------------------------------------------------
  @ApiProperty({ enum: EVERYONE_AGREES, description: 'Todos da casa concordam com a adoção?' })
  @Trim() @choice(EVERYONE_AGREES, 'Todos concordam')
  everyoneAgrees: string;

  @ApiProperty({ description: 'O que fará em caso de discordância' })
  @Trim() @required('Plano em caso de discordância') @IsString() @text('Plano em caso de discordância')
  disagreementPlan: string;

  @ApiProperty({ description: 'Horas por dia que o animal ficará sozinho (0 a 24)' })
  @ToInt() @IsInt({ message: 'Horas sozinho deve ser um número inteiro.' })
  @Min(0, { message: 'Horas sozinho deve ser entre 0 e 24.' })
  @Max(24, { message: 'Horas sozinho deve ser entre 0 e 24.' })
  hoursAlonePerDay: number;

  @ApiProperty({ description: 'Quem cuida do animal em viagens' })
  @Trim() @required('Cuidador em viagens') @IsString() @text('Cuidador em viagens')
  caretakerWhenTraveling: string;

  @ApiProperty({ description: 'Opinião sobre animais durante a gravidez' })
  @Trim() @required('Opinião sobre gravidez') @IsString() @text('Opinião sobre gravidez')
  pregnancyOpinion: string;

  @ApiProperty({ enum: YES_NO_MAYBE, description: 'Pretende se mudar?' })
  @Trim() @choice(YES_NO_MAYBE, 'Pretende se mudar')
  plansToMove: string;

  @ApiPropertyOptional({ description: 'O que fará com o animal na mudança (obrigatório se plansToMove = yes/maybe)' })
  @Trim() @ValidateIf((o) => ['yes', 'maybe'].includes(o.plansToMove) || o.moveAnimalPlan !== undefined)
  @required('Plano para o animal na mudança') @IsString() @text('Plano para o animal na mudança')
  moveAnimalPlan?: string;

  @ApiProperty({ enum: YES_NO_UNKNOWN, description: 'Alguém na casa tem alergia?' })
  @Trim() @choice(YES_NO_UNKNOWN, 'Alergia na casa')
  someoneAllergic: string;

  @ApiProperty({ description: 'O que fará em caso de alergia' })
  @Trim() @required('Plano em caso de alergia') @IsString() @text('Plano em caso de alergia')
  allergyPlan: string;

  // ------------------------------------------------------------
  // Etapa 6 — Histórico
  // ------------------------------------------------------------
  @ApiProperty({ enum: YES_NO, description: 'Já doou/devolveu algum animal?' })
  @Trim() @choice(YES_NO, 'Já doou algum animal')
  hasSurrenderedPet: string;

  @ApiPropertyOptional({ description: 'Circunstâncias da doação (obrigatório se hasSurrenderedPet = yes)' })
  @Trim() @ValidateIf((o) => o.hasSurrenderedPet === 'yes' || o.surrenderDetails !== undefined)
  @required('Circunstâncias da doação') @IsString() @text('Circunstâncias da doação')
  surrenderDetails?: string;

  @ApiProperty({ enum: YES_NO, description: 'Já perdeu algum animal na rua?' })
  @Trim() @choice(YES_NO, 'Já perdeu algum animal')
  hasLostPetOutside: string;

  @ApiPropertyOptional({ description: 'Circunstâncias da perda (obrigatório se hasLostPetOutside = yes)' })
  @Trim() @ValidateIf((o) => o.hasLostPetOutside === 'yes' || o.lostPetDetails !== undefined)
  @required('Circunstâncias da perda') @IsString() @text('Circunstâncias da perda')
  lostPetDetails?: string;

  @ApiProperty({ enum: YES_NO, description: 'Algum animal morreu recentemente?' })
  @Trim() @choice(YES_NO, 'Morte recente de animal')
  hadRecentPetDeath: string;

  @ApiPropertyOptional({ description: 'Circunstâncias da morte (obrigatório se hadRecentPetDeath = yes)' })
  @Trim() @ValidateIf((o) => o.hadRecentPetDeath === 'yes' || o.recentDeathDetails !== undefined)
  @required('Circunstâncias da morte') @IsString() @text('Circunstâncias da morte')
  recentDeathDetails?: string;

  // ------------------------------------------------------------
  // Etapa 7 — Compromisso
  // ------------------------------------------------------------
  @ApiProperty({ enum: YES_NO, description: 'Ciente da longevidade do animal?' })
  @Trim() @choice(YES_NO, 'Ciente da longevidade')
  awareOfLongevity: string;

  @ApiProperty({ enum: YES_NO, description: 'Vai informar mudanças de endereço/contato?' })
  @Trim() @choice(YES_NO, 'Informar mudanças')
  willReportChanges: string;

  @ApiProperty({ enum: YES_NO, description: 'Não repassará o animal sem avisar?' })
  @Trim() @choice(YES_NO, 'Não repassar sem avisar')
  willNotRehomeWithoutNotice: string;

  @ApiProperty({ description: 'Como é o animal ideal' })
  @Trim() @required('Animal ideal') @IsString() @text('Animal ideal')
  idealAnimal: string;

  @ApiProperty({ description: 'Desde quando pensa em adotar' })
  @Trim() @required('Desde quando pensa em adotar') @IsString() @text('Desde quando pensa em adotar', 200)
  thinkingSince: string;

  @ApiProperty({ enum: YES_NO, description: 'Ciente do processo de avaliação?' })
  @Trim() @choice(YES_NO, 'Ciente do processo de avaliação')
  awareOfEvaluationProcess: string;

  @ApiProperty({ enum: ['agree'], description: 'Concorda com os termos (precisa ser agree)' })
  @Trim() @Equals('agree', { message: 'Para enviar a ficha é preciso concordar com os termos.' })
  agreesWithTerms: string;

  @ApiProperty({ enum: ['yes'], description: 'Declara que as respostas são verdadeiras (precisa ser yes)' })
  @Trim() @Equals('yes', { message: 'Para enviar a ficha é preciso declarar que as respostas são verdadeiras.' })
  declaresTruthful: string;

  @ApiProperty({ description: 'ID da organização que receberá a ficha' })
  @Trim() @IsUUID('all', { message: 'Organização inválida.' })
  organizationId: string;
}
