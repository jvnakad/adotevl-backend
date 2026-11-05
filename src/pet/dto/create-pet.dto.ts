import { IsString, IsOptional, IsBoolean, IsNumber, IsDateString, IsEnum, IsIn, IsPositive, Max, MaxLength, MinLength, registerDecorator, ValidationArguments } from 'class-validator';
import { IsCalendarDate, IsNotFutureDate } from '../../common/validation/calendar-date';
import { PetStatus } from '../pet.entity';
import { isBreedOfSpecies, PET_SPECIES } from '../pet-catalog';
import { BIRTH_MONTH_PATTERN, currentMonthInBrazil } from '../pet-age';

const birthMonthError = (value: unknown) => {
  if (value === undefined || value === null || value === '') return 'Informe o mês/ano de nascimento.';
  if (typeof value !== 'string' || !BIRTH_MONTH_PATTERN.test(value)) return 'Nascimento deve estar no formato AAAA-MM.';
  // 'YYYY-MM' compara certo como texto
  if (value > currentMonthInBrazil()) return 'Nascimento não pode ser no futuro.';
  return null;
};

// Mês/ano de nascimento obrigatório, sem futuro. Um validador só, para devolver uma mensagem por vez
export function BirthMonth() {
  return (object: object, propertyName: string) =>
    registerDecorator({
      name: 'birthMonth',
      target: object.constructor,
      propertyName,
      options: { always: true },
      validator: {
        validate: (value: unknown) => birthMonthError(value) === null,
        defaultMessage: (args: ValidationArguments) => birthMonthError(args.value),
      },
    });
}

export const PetSpecies = () => IsIn(PET_SPECIES, { message: 'Espécie inválida.' });

// Raça precisa pertencer à espécie enviada no mesmo payload (no update parcial, quem troca a raça manda a espécie junto)
export function BreedOfSpecies() {
  return (object: object, propertyName: string) =>
    registerDecorator({
      name: 'breedOfSpecies',
      target: object.constructor,
      propertyName,
      validator: {
        validate: (value: unknown, args: ValidationArguments) => {
          const { species } = args.object as { species?: string };
          return typeof value === 'string' && !!species && isBreedOfSpecies(species, value);
        },
        defaultMessage: (args: ValidationArguments) => {
          const { species } = args.object as { species?: string };
          return species ? `Raça inválida para a espécie ${species}.` : 'Informe a espécie junto com a raça.';
        },
      },
    });
}

/**
 * Limites do cadastro de pet (o front espelha estes valores):
 * - nome: 2 a 80 caracteres
 * - descrição (about): até 2000 caracteres
 * - peso: maior que 0 e até 200 kg
 * - data de resgate: data real do calendário (AAAA-MM-DD) e não futura
 */
export const PET_NAME_MIN = 2;
export const PET_NAME_MAX = 80;
export const PET_ABOUT_MAX = 2000;
export const PET_WEIGHT_MAX = 200;

export class CreatePetDto {
  @IsString({ message: 'Informe o nome do pet.' })
  @MinLength(PET_NAME_MIN, { message: `O nome deve ter no mínimo ${PET_NAME_MIN} caracteres.` })
  @MaxLength(PET_NAME_MAX, { message: `O nome deve ter no máximo ${PET_NAME_MAX} caracteres.` })
  name: string;

  @PetSpecies()
  species: string;

  @BreedOfSpecies()
  @IsOptional()
  animal?: string;

  @BirthMonth()
  birthDate: string;

  @IsString()
  sex: string;

  @IsString()
  @IsOptional()
  size?: string;

  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'O peso deve ser um número com no máximo 2 casas decimais.' })
  @IsPositive({ message: 'O peso deve ser maior que zero.' })
  @Max(PET_WEIGHT_MAX, { message: `O peso deve ser de no máximo ${PET_WEIGHT_MAX} kg.` })
  @IsOptional()
  weight?: number;

  @IsBoolean()
  @IsOptional()
  castration?: boolean;

  @IsDateString({}, { message: 'Data de resgate deve estar no formato AAAA-MM-DD.' })
  @IsCalendarDate({ message: 'Data de resgate inexistente no calendário.' })
  @IsNotFutureDate({ message: 'Data de resgate não pode ser no futuro.' })
  @IsOptional()
  rescueDate?: string;

  @IsDateString()
  @IsOptional()
  adoptionDate?: string;

  @IsString({ message: 'A descrição deve ser um texto.' })
  @MaxLength(PET_ABOUT_MAX, { message: `A descrição deve ter no máximo ${PET_ABOUT_MAX} caracteres.` })
  @IsOptional()
  about?: string;

  @IsEnum(PetStatus, { message: 'Status inválido. Use: DISPONIVEL, EM_PROCESSO ou ADOTADO.' })
  @IsOptional()
  status?: PetStatus;

}
