import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateUserDto } from './create-user.dto';
import { UpdateUserDto } from './update-user.dto';

// O ValidationPipe global usa whitelist: true. O profileId legado deixou os DTOs: quem ainda o envia recebe a mesma resposta de quem não envia (RN-31)
describe('profileId legado nos DTOs de usuário', () => {
  it('UpdateUserDto descarta profileId e não acusa erro por causa dele', async () => {
    const dto = plainToInstance(UpdateUserDto, { phone: '11999990000', profileId: 'outro-perfil' });

    const errors = await validate(dto, { whitelist: true });

    expect(errors).toEqual([]);
    expect(dto).not.toHaveProperty('profileId');
    expect(dto).toHaveProperty('phone', '11999990000');
  });

  it('CreateUserDto descarta profileId', async () => {
    const dto = plainToInstance(CreateUserDto, { fullName: 'Ana Souza', profileId: 'outro-perfil' });

    await validate(dto, { whitelist: true });

    expect(dto).not.toHaveProperty('profileId');
  });

  it('com forbidNonWhitelisted desligado (o global) nenhum erro de propriedade desconhecida', async () => {
    const errors = await validate(plainToInstance(UpdateUserDto, { profileId: 'x' }), { whitelist: true });

    expect(errors.some((e) => e.property === 'profileId')).toBe(false);
  });
});
