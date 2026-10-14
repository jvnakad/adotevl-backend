import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsString,
  MaxLength,
  ValidateIf,
  registerDecorator,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  DayPeriod,
  DebtAction,
  InterestArea,
  Loyalty,
  PressureHandling,
  ReferralSource,
  RoadkillAction,
  ShelterVisit,
  StrayAnimalsFeeling,
  StressReaction,
  Tool,
} from '../volunteer-application.options';

const TEXT_MAX = 2000;
const SHORT_MAX = 120;
const required = (label: string) => ({ message: `Responda: ${label}.` });

/** Opção que não pode ser marcada junto com outras (ex.: "Nenhum"). */
function ExclusiveOption(option: string, label: string) {
  return (object: object, propertyName: string) =>
    registerDecorator({
      name: 'exclusiveOption',
      target: object.constructor,
      propertyName,
      options: { message: `"${label}" não pode ser marcada junto com outras opções.` },
      validator: {
        validate: (value: unknown) => !Array.isArray(value) || !value.includes(option) || value.length === 1,
      },
    });
}

/** Texto de "Outros" obrigatório quando a opção OUTROS foi marcada na lista `listField`. */
const otherSelected = (listField: string) => (object: Record<string, unknown>) =>
  Array.isArray(object[listField]) && (object[listField] as string[]).includes('OUTROS');

export class VolunteerApplicationDto {
  @ApiProperty({ description: 'Cidade onde mora' })
  @IsString()
  @IsNotEmpty({ message: 'Informe a cidade.' })
  @MaxLength(SHORT_MAX)
  city: string;

  @ApiProperty({ description: 'Bairro onde mora' })
  @IsString()
  @IsNotEmpty({ message: 'Informe o bairro.' })
  @MaxLength(SHORT_MAX)
  neighborhood: string;

  @ApiProperty({ enum: ReferralSource, isArray: true, description: 'Como conheceu a Adote' })
  @IsArray()
  @ArrayNotEmpty(required('como conheceu a Adote'))
  @IsEnum(ReferralSource, { each: true, message: 'Opção inválida em "Como conheceu a Adote".' })
  referralSources: ReferralSource[];

  @ApiPropertyOptional({ description: 'Texto de "Outros" em como conheceu' })
  @ValidateIf(otherSelected('referralSources'))
  @IsString()
  @IsNotEmpty({ message: 'Conte como conheceu a Adote (Outros).' })
  @MaxLength(SHORT_MAX)
  referralOther?: string;

  @ApiProperty({ enum: InterestArea, isArray: true, description: 'Setores de interesse' })
  @IsArray()
  @ArrayNotEmpty(required('setores de interesse'))
  @IsEnum(InterestArea, { each: true, message: 'Opção inválida em "Setores de interesse".' })
  interestAreas: InterestArea[];

  @ApiPropertyOptional({ description: 'Texto de "Outros" nos setores' })
  @ValidateIf(otherSelected('interestAreas'))
  @IsString()
  @IsNotEmpty({ message: 'Informe qual outro setor interessa a você.' })
  @MaxLength(SHORT_MAX)
  interestOther?: string;

  @ApiProperty({ description: 'Sobre você' })
  @IsString()
  @IsNotEmpty(required('conte um pouco sobre você'))
  @MaxLength(TEXT_MAX)
  aboutYou: string;

  @ApiProperty({ description: 'Maior defeito e maior qualidade' })
  @IsString()
  @IsNotEmpty(required('maior defeito e maior qualidade'))
  @MaxLength(TEXT_MAX)
  strengthWeakness: string;

  @ApiProperty({ description: 'Como se sente com trabalho voluntário sem remuneração' })
  @IsString()
  @IsNotEmpty(required('trabalho voluntário sem remuneração'))
  @MaxLength(TEXT_MAX)
  unpaidWorkFeeling: string;

  @ApiProperty({ enum: StrayAnimalsFeeling })
  @IsEnum(StrayAnimalsFeeling, required('situação dos animais de rua'))
  strayAnimalsFeeling: StrayAnimalsFeeling;

  @ApiProperty({ enum: Loyalty })
  @IsEnum(Loyalty, required('lealdade em momentos difíceis'))
  loyalty: Loyalty;

  @ApiProperty({ description: 'Já presenciou maus-tratos' })
  @IsBoolean(required('já presenciou maus-tratos'))
  witnessedAbuse: boolean;

  @ApiProperty({ enum: PressureHandling })
  @IsEnum(PressureHandling, required('situações sob pressão'))
  pressureHandling: PressureHandling;

  @ApiProperty({ enum: StressReaction })
  @IsEnum(StressReaction, required('reação em momentos de estresse'))
  stressReaction: StressReaction;

  @ApiProperty({ enum: RoadkillAction, isArray: true, description: 'Animal atropelado às 23h' })
  @IsArray()
  @ArrayNotEmpty(required('animal atropelado às 23h'))
  @IsEnum(RoadkillAction, { each: true, message: 'Opção inválida em "Animal atropelado às 23h".' })
  @ExclusiveOption(RoadkillAction.PREFERE_NAO_VER, 'Prefiro não ver esse tipo de situação')
  roadkillActions: RoadkillAction[];

  @ApiProperty({ description: 'Como ajudar no resgate da cadela com 10 filhotes' })
  @IsString()
  @IsNotEmpty(required('resgate da cadela com 10 filhotes'))
  @MaxLength(TEXT_MAX)
  emergencyRescueHelp: string;

  @ApiProperty({ enum: DebtAction, isArray: true, description: 'Conta do veterinário com caixa zerado' })
  @IsArray()
  @ArrayNotEmpty(required('conta do veterinário com caixa zerado'))
  @IsEnum(DebtAction, { each: true, message: 'Opção inválida em "Conta do veterinário".' })
  @ExclusiveOption(DebtAction.PREFERE_NAO_PARTICIPAR, 'Prefiro não fazer parte dessa área')
  debtActions: DebtAction[];

  @ApiProperty({ enum: DayPeriod, isArray: true, description: 'Horários mais livres' })
  @IsArray()
  @ArrayNotEmpty(required('horários mais livres'))
  @IsEnum(DayPeriod, { each: true, message: 'Opção inválida em "Horários".' })
  availablePeriods: DayPeriod[];

  @ApiProperty({ enum: Tool, isArray: true, description: 'Conhecimento em ferramentas e redes' })
  @IsArray()
  @ArrayNotEmpty(required('ferramentas e redes sociais'))
  @IsEnum(Tool, { each: true, message: 'Opção inválida em "Ferramentas".' })
  @ExclusiveOption(Tool.NENHUM, 'Nenhum')
  tools: Tool[];

  @ApiProperty({ enum: ShelterVisit })
  @IsEnum(ShelterVisit, required('ir ao abrigo uma vez por mês'))
  shelterVisit: ShelterVisit;

  @ApiProperty({ description: 'Aceita entrevista online' })
  @IsBoolean(required('entrevista online'))
  acceptsInterview: boolean;
}
