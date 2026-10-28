import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { AuthService } from './auth.service';

jest.mock('bcryptjs', () => ({ compare: jest.fn() }));

describe('AuthService', () => {
  let userService: { findByEmail: jest.Mock; findOne: jest.Mock; resendConfirmation: jest.Mock };
  let accessService: { forUser: jest.Mock; isFloatingVolunteer: jest.Mock };
  let refreshTokens: { issue: jest.Mock };
  let service: AuthService;

  const activeUser = {
    id: 'u1',
    fullName: 'Ana',
    email: 'ana@teste.com',
    password: 'hash',
    confirmationCode: null,
    profileId: 'p1',
    profile: { name: 'ADMIN' },
    organizationId: 'org-1',
    isActive: true,
    isConfirmed: true,
    isApproved: true,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    userService = { findByEmail: jest.fn(), findOne: jest.fn(), resendConfirmation: jest.fn(async () => true) };
    refreshTokens = { issue: jest.fn(async () => ({ access_token: 'jwt-token', refresh_token: 'refresh-value' })) };
    accessService = { forUser: jest.fn(async () => null), isFloatingVolunteer: jest.fn(async () => false) };
    service = new AuthService(userService as any, accessService as any, refreshTokens as any);
  });

  describe('login', () => {
    const credentials = { email: 'ana@teste.com', password: 'senha123' };

    it('5 falhas na mesma conta bloqueiam com 429 PT-BR, mesmo com a senha certa', async () => {
      userService.findByEmail.mockResolvedValue(activeUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);
      for (let i = 0; i < 5; i++) await expect(service.login(credentials)).rejects.toThrow(UnauthorizedException);

      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      await expect(service.login(credentials)).rejects.toMatchObject({ status: 429, response: { message: expect.stringContaining('Muitas tentativas') } });
      expect(refreshTokens.issue).not.toHaveBeenCalled();
    });

    it('e-mail inexistente também conta falha (sem revelar se a conta existe)', async () => {
      userService.findByEmail.mockResolvedValue(null);
      for (let i = 0; i < 5; i++) await expect(service.login(credentials)).rejects.toThrow(UnauthorizedException);

      await expect(service.login(credentials)).rejects.toMatchObject({ status: 429 });
    });

    it('conta não confirmada com a senha certa reenvia o e-mail de confirmação', async () => {
      userService.findByEmail.mockResolvedValue({ ...activeUser, isConfirmed: false });
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      await expect(service.login(credentials)).rejects.toThrow(new UnauthorizedException('Conta não confirmada. Enviamos um novo e-mail de confirmação.'));
      expect(userService.resendConfirmation).toHaveBeenCalledWith('u1');
    });

    it('conta não confirmada com a senha errada não reenvia nada', async () => {
      userService.findByEmail.mockResolvedValue({ ...activeUser, isConfirmed: false });
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(service.login(credentials)).rejects.toThrow(new UnauthorizedException('Conta não confirmada. Verifique seu e-mail.'));
      expect(userService.resendConfirmation).not.toHaveBeenCalled();
    });

    it('conta não confirmada em cooldown devolve a mensagem sem novo envio', async () => {
      userService.findByEmail.mockResolvedValue({ ...activeUser, isConfirmed: false });
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      userService.resendConfirmation.mockResolvedValue(false);

      await expect(service.login(credentials)).rejects.toThrow(new UnauthorizedException('Conta não confirmada. Verifique seu e-mail.'));
    });

    it.each([
      ['usuário inexistente', null, 'Credenciais inválidas.'],
      ['usuário inativo', { ...activeUser, isActive: false }, 'Usuário inativo.'],
      ['conta não aprovada', { ...activeUser, isApproved: false }, 'Conta aguardando aprovação do administrador.'],
    ])('rejeita %s', async (_label, user, message) => {
      userService.findByEmail.mockResolvedValue(user);

      await expect(service.login(credentials)).rejects.toThrow(new UnauthorizedException(message));
      expect(bcrypt.compare).not.toHaveBeenCalled();
    });

    it('rejeita senha incorreta', async () => {
      userService.findByEmail.mockResolvedValue(activeUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(service.login(credentials)).rejects.toThrow('Credenciais inválidas.');
      expect(refreshTokens.issue).not.toHaveBeenCalled();
    });

    it('volante com a senha certa recebe orientação amigável e nenhum token (CA-39, CA-41)', async () => {
      userService.findByEmail.mockResolvedValue(activeUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      accessService.isFloatingVolunteer.mockResolvedValue(true);

      await expect(service.login(credentials)).rejects.toThrow(new UnauthorizedException('Voluntários volantes não usam o painel. Marque seus horários pela página de voluntariado no site da Adote.'));
      expect(accessService.isFloatingVolunteer).toHaveBeenCalledWith('u1');
      expect(refreshTokens.issue).not.toHaveBeenCalled();
    });

    it('a checagem de volante só roda depois da senha certa (CA-62)', async () => {
      userService.findByEmail.mockResolvedValue(activeUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);
      accessService.isFloatingVolunteer.mockResolvedValue(true);

      await expect(service.login(credentials)).rejects.toThrow('Credenciais inválidas.');
      expect(accessService.isFloatingVolunteer).not.toHaveBeenCalled();
    });

    it('volante promovido a outra equipe entra normalmente (CA-40)', async () => {
      userService.findByEmail.mockResolvedValue(activeUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      accessService.isFloatingVolunteer.mockResolvedValue(false);

      expect((await service.login(credentials)).access_token).toBe('jwt-token');
    });

    it('devolve token com dados do perfil e da organização', async () => {
      userService.findByEmail.mockResolvedValue(activeUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      const result = await service.login(credentials);

      expect(bcrypt.compare).toHaveBeenCalledWith('senha123', 'hash');
      expect(refreshTokens.issue).toHaveBeenCalledWith({ id: 'u1', email: 'ana@teste.com', profileId: 'p1', profileName: 'ADMIN', organizationId: 'org-1' }, undefined);
      expect(result).toEqual({
        access_token: 'jwt-token',
        refresh_token: 'refresh-value',
        user: { id: 'u1', fullName: 'Ana', email: 'ana@teste.com', profileId: 'p1', organizationId: 'org-1' },
      });
    });

    it('repassa o User-Agent para a emissão', async () => {
      userService.findByEmail.mockResolvedValue(activeUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      await service.login(credentials, 'Mozilla/5.0');

      expect(refreshTokens.issue.mock.calls[0][1]).toBe('Mozilla/5.0');
    });

    it.each([
      ['usuário inexistente', null],
      ['usuário inativo', { ...activeUser, isActive: false }],
      ['conta não confirmada', { ...activeUser, isConfirmed: false }],
      ['conta não aprovada', { ...activeUser, isApproved: false }],
    ])('%s não emite refresh (CA-05)', async (_label, user) => {
      userService.findByEmail.mockResolvedValue(user);

      await expect(service.login(credentials)).rejects.toThrow(UnauthorizedException);
      expect(refreshTokens.issue).not.toHaveBeenCalled();
    });

    it('falha ao emitir o refresh derruba o login (nenhum access sai sem família)', async () => {
      userService.findByEmail.mockResolvedValue(activeUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      refreshTokens.issue.mockRejectedValue(new Error('db'));

      await expect(service.login(credentials)).rejects.toThrow('db');
    });
  });

  describe('me', () => {
    it('lança NotFoundException quando o usuário não existe', async () => {
      userService.findOne.mockResolvedValue(null);

      await expect(service.me('x')).rejects.toThrow(NotFoundException);
    });

    it('não expõe senha nem código de confirmação', async () => {
      userService.findOne.mockResolvedValue(activeUser);

      const result = await service.me('u1');

      expect(result).not.toHaveProperty('password');
      expect(result).not.toHaveProperty('confirmationCode');
      expect(result).toEqual(expect.objectContaining({ id: 'u1', email: 'ana@teste.com' }));
    });

    it('devolve a equipe e as permissões do usuário (o front monta menu e botões com elas)', async () => {
      userService.findOne.mockResolvedValue(activeUser);
      const access = { teamId: 't1', teamName: 'Resgate', isAdmin: false, permissions: { PETS: 'EDIT' } };
      accessService.forUser.mockResolvedValue(access);

      const result = await service.me('u1');

      expect(accessService.forUser).toHaveBeenCalledWith('u1');
      expect(result).toEqual(expect.objectContaining({ access }));
    });

    it('sem equipe devolve access null', async () => {
      userService.findOne.mockResolvedValue(activeUser);

      expect((await service.me('u1')).access).toBeNull();
    });
  });
});
