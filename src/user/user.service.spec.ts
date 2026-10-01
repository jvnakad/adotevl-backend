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
    service = new UserService(userRepo as any, profileRepo as any, orgRepo as any, mailService as any, jwtService as any);
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

    it('lança BadRequestException quando o perfil ADMIN não existe para o primeiro usuário', async () => {
      mockUserLookups(null, null, null);
      orgRepo.findOne.mockResolvedValue({ id: 'org-1' });
      profileRepo.findOne.mockResolvedValue(null);

      await expect(service.create(dto)).rejects.toThrow(BadRequestException);
    });

    it('demais usuários mantêm o perfil informado', async () => {
      mockUserLookups(null, null, { id: 'existing' });
      orgRepo.findOne.mockResolvedValue({ id: 'org-1' });
      profileRepo.findOne.mockResolvedValue({ id: 'p-volunteer' });

      const result = await service.create(dto);

      expect(profileRepo.findOne).toHaveBeenCalledWith({ where: { id: 'p-volunteer' } });
      expect(result.profileId).toBe('p-volunteer');
    });

    it('lança NotFoundException quando o perfil informado não existe', async () => {
      mockUserLookups(null, null, { id: 'existing' });
      orgRepo.findOne.mockResolvedValue({ id: 'org-1' });
      profileRepo.findOne.mockResolvedValue(null);

      await expect(service.create(dto)).rejects.toThrow('Perfil não encontrado.');
      expect(mailService.sendConfirmationEmail).not.toHaveBeenCalled();
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
    await service.findAll(pagination, false);
    await service.findAll(pagination);

    expect(userRepo.findAndCount).toHaveBeenNthCalledWith(1, expect.objectContaining({ where: { isApproved: false } }));
    expect(userRepo.findAndCount).toHaveBeenNthCalledWith(2, expect.objectContaining({ where: {} }));
  });

  describe('update', () => {
    it('lança NotFoundException quando o usuário não existe', async () => {
      userRepo.findOne.mockResolvedValue(null);

      await expect(service.update('u1', {}, 'u1')).rejects.toThrow(NotFoundException);
    });

    it('não-admin não pode editar outro usuário', async () => {
      userRepo.findOne.mockResolvedValue({ id: 'u1' });

      await expect(service.update('u1', {}, 'u2', 'VOLUNTEER')).rejects.toThrow(ForbiddenException);
    });

    it('não-admin editando o próprio perfil só altera campos pessoais', async () => {
      userRepo.findOne.mockResolvedValue({ id: 'u1' });

      await service.update('u1', { fullName: 'Nova', email: 'x@x.com', profileId: 'p-admin' } as any, 'u1', 'VOLUNTEER');

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

      await service.update('u1', { email: 'x@x.com', profileId: 'p-admin' } as any, 'admin', 'ADMIN');

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

      await expect(service.approve('x')).rejects.toThrow(NotFoundException);
    });

    it('aprova, gera token com o perfil e envia email de acesso', async () => {
      const updated = { id: 'u1', email: 'ana@teste.com', fullName: 'Ana', profileId: 'p1', profile: { name: 'VOLUNTEER' }, organizationId: 'org-1' };
      userRepo.findOne.mockResolvedValueOnce({ id: 'u1' }).mockResolvedValueOnce(updated);

      const result = await service.approve('u1', 'admin');

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
