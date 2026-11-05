import { ApiProperty } from '@nestjs/swagger';
import { IsObject, registerDecorator } from 'class-validator';
import { AccessLevel, Screen } from '../../access/access';

const SCREEN_KEYS = Object.values(Screen) as string[];
const LEVELS = Object.values(AccessLevel) as string[];

// Só telas conhecidas e níveis válidos; tela ausente = Sem acesso
function ValidPermissions() {
  return (object: object, propertyName: string) =>
    registerDecorator({
      name: 'validPermissions',
      target: object.constructor,
      propertyName,
      validator: {
        validate: (value: Record<string, unknown>) =>
          !!value && Object.entries(value).every(([screen, level]) => SCREEN_KEYS.includes(screen) && LEVELS.includes(level as string)),
        defaultMessage: () => `Permissões inválidas. Telas: ${SCREEN_KEYS.join(', ')}. Níveis: ${LEVELS.join(', ')}.`,
      },
    });
}

export class SetTeamPermissionsDto {
  @ApiProperty({ description: 'Nível por tela (NONE, VIEW, EDIT). Tela ausente = Sem acesso.', example: { PETS: 'EDIT', MEDICAL_RECORDS: 'VIEW' } })
  @IsObject({ message: 'Envie as permissões como objeto { TELA: NIVEL }.' })
  @ValidPermissions()
  permissions: Partial<Record<Screen, AccessLevel>>;
}
