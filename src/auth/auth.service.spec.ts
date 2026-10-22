import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { AuthService } from './auth.service';

jest.mock('bcryptjs', () => ({ compare: jest.fn() }));

describe('AuthService', () => {
  let userService: { findByEmail: jest.Mock; findOne: jest.Mock };
  let accessService: { forUser: jest.Mock; isFloatingVolunteer: jest.Mock };
  let jwtService: { sign: jest.Mock };
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
    userService = { findByEmail: jest.fn(), findOne: jest.fn() };
    jwtService = { sign: jest.fn(() => 'jwt-token') };
    accessService = { forUser: jest.fn(async () => null), isFloatingVolunteer: jest.fn(async () => false) };
    service = new AuthService(userService as any, jwtService as any, accessService as any);
  });

  describe('login', () => {
    const credentials = { email: 'ana@teste.com', password: 'senha123' };

    it.each([
      ['usuário inexistente', null, 'Credenciais inválidas.'],
      ['usuário inativo', { ...activeUser, isActive: false }, 'Usuário inativo.'],
      ['conta não confirmada', { ...activeUser, isConfirmed: false }, 'Conta não confirmada. Verifique seu e-mail.'],
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
      expect(jwtService.sign).not.toHaveBeenCalled();
    });

    it('volante com a senha certa recebe a mesma mensagem de senha errada e nenhum token (CA-39, CA-41)', async () => {
      userService.findByEmail.mockResolvedValue(activeUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      accessService.isFloatingVolunteer.mockResolvedValue(true);

      await expect(service.login(credentials)).rejects.toThrow(new UnauthorizedException('Credenciais inválidas.'));
      expect(accessService.isFloatingVolunteer).toHaveBeenCalledWith('u1');
      expect(jwtService.sign).not.toHaveBeenCalled();
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
      expect(jwtService.sign).toHaveBeenCalledWith({
        sub: 'u1',
        email: 'ana@teste.com',
        profileId: 'p1',
        profileName: 'ADMIN',
        organizationId: 'org-1',
      });
      expect(result).toEqual({
        access_token: 'jwt-token',
        user: { id: 'u1', fullName: 'Ana', email: 'ana@teste.com', profileId: 'p1', organizationId: 'org-1' },
      });
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
