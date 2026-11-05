import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ForgotPasswordDto } from './forgot-password.dto';
import { VerifyResetCodeDto } from './verify-reset-code.dto';
import { ResetPasswordDto } from './reset-password.dto';

const messagesOf = async (type: new () => object, body: object) =>
  (await validate(plainToInstance(type, body))).flatMap((error) => Object.values(error.constraints ?? {}));

describe('DTOs do "Esqueci minha senha"', () => {
  describe('ForgotPasswordDto', () => {
    it('aceita e-mail com formato válido', async () => {
      expect(await messagesOf(ForgotPasswordDto, { email: 'maria@exemplo.com' })).toEqual([]);
    });

    it.each([
      ['sem arroba', 'maria.exemplo.com'],
      ['vazio', ''],
      ['com mais de 254 caracteres', `${'a'.repeat(250)}@exemplo.com`],
    ])('recusa e-mail %s com mensagem PT-BR (CA-11)', async (_label, email) => {
      const messages = await messagesOf(ForgotPasswordDto, { email });

      expect(messages.length).toBeGreaterThan(0);
      for (const message of messages) expect(message).toMatch(/e-mail/i);
    });

    it('não repete o valor recebido na mensagem', async () => {
      const messages = await messagesOf(ForgotPasswordDto, { email: 'valor-secreto' });

      expect(messages.join(' ')).not.toContain('valor-secreto');
    });
  });

  describe('VerifyResetCodeDto', () => {
    it('aceita 6 dígitos, inclusive com zeros à esquerda', async () => {
      expect(await messagesOf(VerifyResetCodeDto, { email: 'maria@exemplo.com', code: '000123' })).toEqual([]);
    });

    it.each(['12345a', '1234567', '12345', '123 456', ''])('recusa o código "%s" sem repetir o valor (CA-54)', async (code) => {
      const messages = await messagesOf(VerifyResetCodeDto, { email: 'maria@exemplo.com', code });

      expect(messages).toEqual(['O código deve ter 6 dígitos numéricos.']);
    });

    it('recusa código que não é texto', async () => {
      expect(await messagesOf(VerifyResetCodeDto, { email: 'maria@exemplo.com', code: 123456 })).toContain('O código deve ter 6 dígitos numéricos.');
    });
  });

  describe('ResetPasswordDto', () => {
    const token = 'eyJhbGciOiJIUzI1NiJ9.e30.assinatura';

    it('aceita senha de 8 a 128 caracteres', async () => {
      expect(await messagesOf(ResetPasswordDto, { resetToken: token, password: '12345678' })).toEqual([]);
      expect(await messagesOf(ResetPasswordDto, { resetToken: token, password: 'a'.repeat(128) })).toEqual([]);
    });

    it('7 caracteres: mínimo de 8 (CA-20)', async () => {
      expect(await messagesOf(ResetPasswordDto, { resetToken: token, password: '1234567' })).toEqual(['A senha deve ter no mínimo 8 caracteres.']);
    });

    it('129 caracteres e corpo de 10 KB: máximo de 128 (CA-20)', async () => {
      expect(await messagesOf(ResetPasswordDto, { resetToken: token, password: 'a'.repeat(129) })).toEqual(['A senha deve ter no máximo 128 caracteres.']);
      expect(await messagesOf(ResetPasswordDto, { resetToken: token, password: 'a'.repeat(10 * 1024) })).toEqual(['A senha deve ter no máximo 128 caracteres.']);
    });

    it('token ausente, vazio ou gigante é recusado, sem repetir o valor', async () => {
      expect(await messagesOf(ResetPasswordDto, { password: '12345678' })).toContain('Token de redefinição inválido.');
      expect(await messagesOf(ResetPasswordDto, { resetToken: '', password: '12345678' })).toContain('Token de redefinição inválido.');
      expect(await messagesOf(ResetPasswordDto, { resetToken: 'x'.repeat(2049), password: '12345678' })).toEqual(['Token de redefinição inválido.']);
    });
  });
});
