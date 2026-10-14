import { IsString, IsOptional, IsBoolean, IsInt, IsNumber, IsDateString, IsUUID, IsEnum, IsIn, registerDecorator, ValidationArguments } from 'class-validator';
import { PetStatus } from '../pet.entity';
import { isBreedOfSpecies, PET_SPECIES } from '../pet-catalog';

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

export class CreatePetDto {
  @IsString()
  name: string;

  @PetSpecies()
  species: string;

  @BreedOfSpecies()
  @IsOptional()
  animal?: string;

  @IsInt({ message: 'A idade deve ser um número inteiro.' })
  @IsOptional()
  age?: number;

  @IsString()
  sex: string;

  @IsString()
  @IsOptional()
  size?: string;

  @IsNumber()
  @IsOptional()
  weight?: number;

  @IsBoolean()
  @IsOptional()
  castration?: boolean;

  @IsDateString()
  @IsOptional()
  rescueDate?: string;

  @IsDateString()
  @IsOptional()
  adoptionDate?: string;

  @IsString()
  @IsOptional()
  about?: string;

  @IsEnum(PetStatus, { message: 'Status inválido. Use: DISPONIVEL, EM_PROCESSO ou ADOTADO.' })
  @IsOptional()
  status?: PetStatus;

  @IsUUID()
  organizationId: string;
}
