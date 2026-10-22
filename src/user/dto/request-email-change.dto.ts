import { ValidateBy } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { IsPersonEmail } from '../../common/validation/person';

const PASSWORD_MAX = 128;
const PASSWORD_REQUIRED = 'Informe sua senha atual.';
const PASSWORD_TOO_LONG = `A senha deve ter no máximo ${PASSWORD_MAX} caracteres.`;

/** Uma única mensagem por caso: ausente/vazia/não-texto pede a senha, longa demais avisa o limite. */
const IsCurrentPassword = () =>
  ValidateBy({
    name: 'isCurrentPassword',
    validator: {
      validate: (value) => typeof value === 'string' && value.length > 0 && value.length <= PASSWORD_MAX,
      defaultMessage: (args) => (typeof args?.value === 'string' && args.value.length > PASSWORD_MAX ? PASSWORD_TOO_LONG : PASSWORD_REQUIRED),
    },
  });

export class RequestEmailChangeDto {
  @ApiProperty({ description: 'E-mail novo (trim + minúsculas, até 254 caracteres)' })
  @IsPersonEmail({ requiredMessage: 'Informe o novo e-mail.' })
  newEmail: string;

  @ApiProperty({ description: 'Senha atual da conta' })
  @IsCurrentPassword()
  currentPassword: string;
}
