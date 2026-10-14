import { In } from 'typeorm';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { UserService } from './user.service';
import { createMockRepository, MockRepository, pagination } from '../testing/mock-repository';

jest.mock('bcryptjs', () => ({
  hash: jest.fn(async (value: string) => `hashed:${value}`),
  compare: jest.fn(),
}));

describe('UserService', () => {
  let userRepo: MockRepository;
  let profileRepo: MockRepository;
  let orgRepo: MockRepository;
  let teams: { ensureDefaultTeams: jest.Mock };
  let membership: { assign: jest.Mock; ensureNotLastAdmin: jest.Mock; teamsOf: jest.Mock; userIdsOfTeam: jest.Mock };
  let mailService: { sendConfirmationEmail: jest.Mock; sendApprovalEmail: jest.Mock; sendPasswordResetEmail: jest.Mock };
  let jwtService: { sign: jest.Mock };
  let service: UserService;

  const dto = {
    fullName: 'Ana',
    cpf: '11111111111',
    email: 'ana@teste.com',
    phone: '11999999999',
    birthDate: '1990-01-01',
    password: 'senha123',
    profileId: 'p-volunteer',
    organizationId: 'org-1',
  } as any;

  beforeEach(() => {
    jest.clearAllMocks();
    userRepo = createMockRepository();
    profileRepo = createMockRepository();
    orgRepo = createMockRepository();
    mailService = { sendConfirmationEmail: jest.fn(), sendApprovalEmail: jest.fn(), sendPasswordResetEmail: jest.fn() };
    jwtService = { sign: jest.fn(() => 'jwt-token') };
    membership = { assign: jest.fn(), ensureNotLastAdmin: jest.fn(), teamsOf: jest.fn(async () => new Map()), userIdsOfTeam: jest.fn(async () => []) };
    teams = { ensureDefaultTeams: jest.fn(async () => ({ id: 't-admin' })) };
    service = new UserService(userRepo as any, profileRepo as any, orgRepo as any, mailService as any, jwtService as any, membership as any, teams as any);
  });

  describe('create', () => {
    // findOne do userRepo: 1) email, 2) cpf na org, 3) primeiro usuario da org
    const mockUserLookups = (email: unknown, cpf: unknown, anyUserInOrg: unknown) =>
      userRepo.findOne.mockResolvedValueOnce(email).mockResolvedValueOnce(cpf).mockResolvedValueOnce(anyUserInOrg);

    it('lança ConflictException com email já cadastrado', async () => {
      userRepo.findOne.mockResolvedValueOnce({ id: 'u0' });

      await expect(service.create(dto)).rejects.toThrow('e-mail');
    });

    it('lança ConflictException com CPF já usado na organização', async () => {
      userRepo.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'u0' });

      await expect(service.create(dto)).rejects.toThrow(ConflictException);
    });

    it('lança NotFoundException quando a organização não existe', async () => {
      mockUserLookups(null, null, null);
      orgRepo.findOne.mockResolvedValue(null);

      await expect(service.create(dto)).rejects.toThrow('Organização não encontrada.');
    });

    it('primeiro usuário da organização vira ADMIN', async () => {
      mockUserLookups(null, null, null);
      orgRepo.findOne.mockResolvedValue({ id: 'org-1' });
      profileRepo.findOne.mockResolvedValue({ id: 'p-admin', name: 'ADMIN' });

      const result = await service.create(dto, 'creator');

      expect(profileRepo.findOne).toHaveBeenCalledWith({ where: { name: 'ADMIN' } });
      expect(result).toEqual(
        expect.objectContaining({
          profileId: 'p-admin',
          password: 'hashed:senha123',
          isConfirmed: false,
          isActive: true,
          createdBy: 'creator',
        }),
      );
      expect(result.confirmationCode).toEqual(expect.any(String));
      expect(mailService.sendConfirmationEmail).toHaveBeenCalledWith('ana@teste.com', 'Ana', result.confirmationCode);
    });

    it('primeiro usuário da organização cria as equipes padrão e entra na Admin', async () => {
      mockUserLookups(null, null, null);
      orgRepo.findOne.mockResolvedValue({ id: 'org-1' });
      profileRepo.findOne.mockResolvedValue({ id: 'p-admin', name: 'ADMIN' });

      const result = await service.create(dto, 'creator');

      expect(teams.ensureDefaultTeams).toHaveBeenCalledWith('org-1');
      expect(membership.assign).toHaveBeenCalledWith(result, 't-admin', 'creator');
    });

    it('lança BadRequestException quando o perfil ADMIN não existe para o primeiro usuário', async () => {
      mockUserLookups(null, null, null);
      orgRepo.findOne.mockResolvedValue({ id: 'org-1' });
      profileRepo.findOne.mockResolvedValue(null);

      await expect(service.create(dto)).rejects.toThrow(BadRequestException);
    });

    it('demais usuários recebem o perfil legado VOLUNTEER, sem escolher pelo cadastro', async () => {
      mockUserLookups(null, null, { id: 'existing' });
      orgRepo.findOne.mockResolvedValue({ id: 'org-1' });
      profileRepo.findOne.mockResolvedValue({ id: 'p-volunteer', name: 'VOLUNTEER' });

      const result = await service.create({ ...dto, profileId: 'p-admin' });

      expect(profileRepo.findOne).toHaveBeenCalledWith({ where: { name: 'VOLUNTEER' } });
      expect(result.profileId).toBe('p-volunteer');
      expect(membership.assign).not.toHaveBeenCalled();
    });
  });

  describe('confirmAccount', () => {
    it('lança NotFoundException com código inválido', async () => {
      userRepo.findOne.mockResolvedValue(null);

      await expect(service.confirmAccount('x')).rejects.toThrow(NotFoundException);
    });

    it('lança BadRequestException quando já confirmada', async () => {
      userRepo.findOne.mockResolvedValue({ isConfirmed: true });

      await expect(service.confirmAccount('x')).rejects.toThrow(BadRequestException);
    });

    it('confirma e limpa o código', async () => {
      userRepo.findOne.mockResolvedValue({ id: 'u1', isConfirmed: false, confirmationCode: 'code' });

      const result = await service.confirmAccount('code');

      expect(result).toEqual(expect.objectContaining({ isConfirmed: true, confirmationCode: null }));
    });
  });

  it('findAll filtra por aprovação só quando informada', async () => {
    await service.findAll(pagination, { isApproved: false });
    await service.findAll(pagination);

    expect(userRepo.findAndCount).toHaveBeenNthCalledWith(1, expect.objectContaining({ where: { isApproved: false } }));
    expect(userRepo.findAndCount).toHaveBeenNthCalledWith(2, expect.objectContaining({ where: {} }));
  });

  it('findAll devolve a equipe de cada usuário', async () => {
    userRepo.findAndCount.mockResolvedValue([[{ id: 'u1' }, { id: 'u2' }], 2]);
    membership.teamsOf.mockResolvedValue(new Map([['u1', { id: 't1', name: 'Resgate', isAdmin: false }]]));

    const result = await service.findAll(pagination);

    expect(membership.teamsOf).toHaveBeenCalledWith(['u1', 'u2']);
    expect(result.data).toEqual([
      { id: 'u1', team: { id: 't1', name: 'Resgate', isAdmin: false } },
      { id: 'u2', team: null },
    ]);
  });

  it('findAll filtra por equipe', async () => {
    membership.userIdsOfTeam.mockResolvedValue(['u1', 'u3']);

    await service.findAll(pagination, { teamId: 't1' });

    expect(userRepo.findAndCount).toHaveBeenCalledWith(expect.objectContaining({ where: { id: In(['u1', 'u3']) } }));
  });

  describe('update', () => {
    it('lança NotFoundException quando o usuário não existe', async () => {
      userRepo.findOne.mockResolvedValue(null);

      await expect(service.update('u1', {}, 'u1')).rejects.toThrow(NotFoundException);
    });

    it('não-admin não pode editar outro usuário', async () => {
      userRepo.findOne.mockResolvedValue({ id: 'u1' });

      await expect(service.update('u1', {}, 'u2', false)).rejects.toThrow(ForbiddenException);
    });

    it('não-admin editando o próprio perfil só altera campos pessoais', async () => {
      userRepo.findOne.mockResolvedValue({ id: 'u1' });

      await service.update('u1', { fullName: 'Nova', email: 'x@x.com', profileId: 'p-admin' } as any, 'u1', false);

      expect(userRepo.update).toHaveBeenCalledWith('u1', {
        fullName: 'Nova',
        cpf: undefined,
        phone: undefined,
        birthDate: undefined,
        updatedBy: 'u1',
      });
    });

    it('admin pode alterar qualquer campo de qualquer usuário', async () => {
      userRepo.findOne.mockResolvedValue({ id: 'u1' });

      await service.update('u1', { email: 'x@x.com', profileId: 'p-admin' } as any, 'admin', true);

      expect(userRepo.update).toHaveBeenCalledWith('u1', { email: 'x@x.com', profileId: 'p-admin', updatedBy: 'admin' });
    });
  });

  describe('activate / reject', () => {
    it('lançam NotFoundException quando o usuário não existe', async () => {
      userRepo.findOne.mockResolvedValue(null);

      await expect(service.activate('x')).rejects.toThrow(NotFoundException);
      await expect(service.reject('x')).rejects.toThrow(NotFoundException);
    });

    it('ativam e desativam o usuário', async () => {
      userRepo.findOne.mockResolvedValue({ id: 'u1' });

      await service.activate('u1', 'admin');
      await service.reject('u1', 'admin');

      expect(userRepo.update).toHaveBeenNthCalledWith(1, 'u1', { isActive: true, updatedBy: 'admin' });
      expect(userRepo.update).toHaveBeenNthCalledWith(2, 'u1', { isActive: false, updatedBy: 'admin' });
    });
  });

  describe('approve', () => {
    it('lança NotFoundException quando o usuário não existe', async () => {
      userRepo.findOne.mockResolvedValue(null);

      await expect(service.approve('x', 't1', 'admin')).rejects.toThrow(NotFoundException);
    });

    it('coloca na equipe antes de aprovar', async () => {
      const user = { id: 'u1', fullName: 'Ana', organizationId: 'org-1' };
      userRepo.findOne.mockResolvedValue(user);

      await service.approve('u1', 't1', 'admin');

      expect(membership.assign).toHaveBeenCalledWith(user, 't1', 'admin');
      expect(membership.assign.mock.invocationCallOrder[0]).toBeLessThan(userRepo.update.mock.invocationCallOrder[0]);
    });

    it('não aprova quando a equipe é inválida', async () => {
      userRepo.findOne.mockResolvedValue({ id: 'u1', organizationId: 'org-1' });
      membership.assign.mockRejectedValue(new BadRequestException('Equipe não encontrada nesta organização.'));

      await expect(service.approve('u1', 'tx', 'admin')).rejects.toThrow('Equipe não encontrada nesta organização.');
      expect(userRepo.update).not.toHaveBeenCalled();
      expect(mailService.sendApprovalEmail).not.toHaveBeenCalled();
    });

    it('aprova, gera token com o perfil e envia email de acesso', async () => {
      const updated = { id: 'u1', email: 'ana@teste.com', fullName: 'Ana', profileId: 'p1', profile: { name: 'VOLUNTEER' }, organizationId: 'org-1' };
      userRepo.findOne.mockResolvedValueOnce({ id: 'u1' }).mockResolvedValueOnce(updated);

      const result = await service.approve('u1', 't1', 'admin');

      expect(userRepo.update).toHaveBeenCalledWith('u1', { isApproved: true, updatedBy: 'admin' });
      expect(jwtService.sign).toHaveBeenCalledWith({
        sub: 'u1',
        email: 'ana@teste.com',
        profileId: 'p1',
        profileName: 'VOLUNTEER',
        organizationId: 'org-1',
      });
      expect(mailService.sendApprovalEmail).toHaveBeenCalledWith('ana@teste.com', 'Ana', 'jwt-token');
      expect(result).toBe(updated);
    });
  });

  describe('reject', () => {
    it('não desativa o último membro da equipe Admin', async () => {
      userRepo.findOne.mockResolvedValue({ id: 'u1' });
      membership.ensureNotLastAdmin.mockRejectedValue(new BadRequestException('A equipe Admin precisa de ao menos um membro ativo.'));

      await expect(service.reject('u1', 'admin')).rejects.toThrow('A equipe Admin precisa de ao menos um membro ativo.');
      expect(userRepo.update).not.toHaveBeenCalled();
    });
  });

  describe('changeTeam', () => {
    it('troca a equipe do usuário', async () => {
      const user = { id: 'u1', organizationId: 'org-1' };
      userRepo.findOne.mockResolvedValue(user);

      await service.changeTeam('u1', 't2', 'admin');

      expect(membership.assign).toHaveBeenCalledWith(user, 't2', 'admin');
    });

    it('lança NotFoundException quando o usuário não existe', async () => {
      userRepo.findOne.mockResolvedValue(null);

      await expect(service.changeTeam('x', 't2', 'admin')).rejects.toThrow(NotFoundException);
    });
  });

  describe('changePassword', () => {
    it('lança NotFoundException quando o usuário não existe', async () => {
      userRepo.findOne.mockResolvedValue(null);

      await expect(service.changePassword('x', { currentPassword: 'a', newPassword: 'b' })).rejects.toThrow(NotFoundException);
    });

    it('lança BadRequestException com senha atual incorreta', async () => {
      userRepo.findOne.mockResolvedValue({ id: 'u1', password: 'hash' });
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(service.changePassword('u1', { currentPassword: 'errada', newPassword: 'nova' })).rejects.toThrow(BadRequestException);
      expect(userRepo.update).not.toHaveBeenCalled();
    });

    it('grava a nova senha com hash', async () => {
      userRepo.findOne.mockResolvedValue({ id: 'u1', password: 'hash' });
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      const result = await service.changePassword('u1', { currentPassword: 'atual', newPassword: 'nova' });

      expect(userRepo.update).toHaveBeenCalledWith('u1', { password: 'hashed:nova' });
      expect(result.message).toBe('Senha alterada com sucesso.');
    });
  });

  describe('resetPassword', () => {
    it('lança NotFoundException quando o usuário não existe', async () => {
      userRepo.findOne.mockResolvedValue(null);

      await expect(service.resetPassword('x')).rejects.toThrow(NotFoundException);
    });

    it('gera senha temporária de 8 caracteres e envia por email', async () => {
      userRepo.findOne.mockResolvedValue({ id: 'u1', email: 'ana@teste.com', fullName: 'Ana' });

      await service.resetPassword('u1');

      const [, , tempPassword] = mailService.sendPasswordResetEmail.mock.calls[0];
      expect(tempPassword).toHaveLength(8);
      expect(userRepo.update).toHaveBeenCalledWith('u1', { password: `hashed:${tempPassword}` });
    });
  });
});
