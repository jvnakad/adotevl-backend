import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RequestEmailChangeDto } from './request-email-change.dto';
import { ConfirmEmailChangeDto } from './confirm-email-change.dto';

const messages = async (cls: any, body: object) => (await validate(plainToInstance(cls, body))).flatMap((error) => Object.values(error.constraints ?? {}));

describe('DTOs da troca de e-mail', () => {
  it('pedido válido', async () => {
    expect(await messages(RequestEmailChangeDto, { newEmail: ' Novo@Teste.com ', currentPassword: 'x' })).toEqual([]);
  });

  it('e-mail inválido, senha ausente ou longa demais, sem repetir o valor', async () => {
    const result = await messages(RequestEmailChangeDto, { newEmail: 'sem-arroba', currentPassword: 'a'.repeat(129) });
    expect(result).toEqual(['E-mail inválido. Confira se está no formato nome@exemplo.com.', 'A senha deve ter no máximo 128 caracteres.']);
    expect(result.join()).not.toContain('sem-arroba');
    expect(await messages(RequestEmailChangeDto, { newEmail: 'a@b.com' })).toEqual(['Informe sua senha atual.']);
  });

  it('body vazio: uma mensagem correta por campo, sem duplicar', async () => {
    const errors = await validate(plainToInstance(RequestEmailChangeDto, {}));
    const byField = Object.fromEntries(errors.map((error) => [error.property, Object.values(error.constraints ?? {})]));

    expect(byField).toEqual({ newEmail: ['Informe o novo e-mail.'], currentPassword: ['Informe sua senha atual.'] });
  });

  it.each([['', ''], [5, 5], [null, null]])('valores vazios ou de tipo errado (%p) dão uma mensagem por campo', async (newEmail, currentPassword) => {
    const errors = await validate(plainToInstance(RequestEmailChangeDto, { newEmail, currentPassword }));

    for (const error of errors) expect(Object.values(error.constraints ?? {})).toHaveLength(1);
    expect(errors.find((error) => error.property === 'currentPassword').constraints).toEqual({ isCurrentPassword: 'Informe sua senha atual.' });
  });

  it.each(['12345a', '1234567', '12345', '', 123456])('código %p é recusado', async (code) => {
    expect(await messages(ConfirmEmailChangeDto, { code })).toEqual(['O código deve ter 6 dígitos.']);
  });

  it('código de 6 dígitos passa', async () => {
    expect(await messages(ConfirmEmailChangeDto, { code: '012345' })).toEqual([]);
  });
});
