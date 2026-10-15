import { In } from 'typeorm';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { UserService } from './user.service';
import { createMockRepository, MockRepository, pagination } from '../testing/mock-repository';

jest.mock('bcryptjs', () => ({
  hash: jest.fn(async (value: string) => `hashed:${value}`),
  compare: jest.fn(),
}));

// Data de nascimento (YYYY-MM-DD) de quem tem `years` anos completos (há alguns dias, longe da virada de fuso)
const yearsAgo = (years: number) => {
  const date = new Date();
  date.setFullYear(date.getFullYear() - years);
  date.setDate(date.getDate() - 3);
  return date.toISOString().slice(0, 10);
};

describe('UserService', () => {
  let userRepo: MockRepository;
  let profileRepo: MockRepository;
  let orgRepo: MockRepository;
  let applicationRepo: MockRepository;
  let teams: { ensureDefaultTeams: jest.Mock; systemTeam: jest.Mock };
  let membership: { assign: jest.Mock; ensureNotLastAdmin: jest.Mock; teamsOf: jest.Mock; userIdsOfTeam: jest.Mock };
  let mailService: { sendConfirmationEmail: jest.Mock; sendApprovalEmail: jest.Mock; sendPasswordResetEmail: jest.Mock; sendFloatingWelcomeEmail: jest.Mock };
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
    consent: true,
    organizationId: 'org-1',
  } as any;

  const application = {
    city: 'Curitiba',
    neighborhood: 'Boqueirão',
    referralSources: ['INSTAGRAM', 'OUTROS'],
    referralOther: 'Feira de adoção',
    interestAreas: ['EVENTOS'],
    aboutYou: 'Gosto de bicho.',
    strengthWeakness: 'Teimosa e dedicada.',
    unpaidWorkFeeling: 'Tranquila.',
    strayAnimalsFeeling: 'QUERO_MUDAR',
    loyalty: 'SIM',
    witnessedAbuse: false,
    pressureHandling: 'CONSIGO',
    stressReaction: 'PACIFICA',
    roadkillActions: ['VAI_AO_LOCAL'],
    emergencyRescueHelp: 'Divulgo e busco lar temporário.',
    debtActions: ['RIFA', 'IDEIAS'],
    availablePeriods: ['NOITE'],
    tools: ['CANVA'],
    shelterVisit: 'SIM',
    acceptsInterview: true,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    userRepo = createMockRepository();
    profileRepo = createMockRepository();
    orgRepo = createMockRepository();
    applicationRepo = createMockRepository();
    applicationRepo.find.mockResolvedValue([]);
    mailService = { sendConfirmationEmail: jest.fn(), sendApprovalEmail: jest.fn(), sendPasswordResetEmail: jest.fn(), sendFloatingWelcomeEmail: jest.fn() };
    jwtService = { sign: jest.fn(() => 'jwt-token') };
    membership = { assign: jest.fn(), ensureNotLastAdmin: jest.fn(), teamsOf: jest.fn(async () => new Map()), userIdsOfTeam: jest.fn(async () => []) };
    teams = { ensureDefaultTeams: jest.fn(async () => ({ id: 't-admin' })), systemTeam: jest.fn(async () => ({ id: 't-floating' })) };
    service = new UserService(userRepo as any, profileRepo as any, orgRepo as any, mailService as any, jwtService as any, membership as any, teams as any, applicationRepo as any);
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

      const result = await service.create({ ...dto, profileId: 'p-admin', application });

      expect(profileRepo.findOne).toHaveBeenCalledWith({ where: { name: 'VOLUNTEER' } });
      expect(result.profileId).toBe('p-volunteer');
      expect(membership.assign).not.toHaveBeenCalled();
    });
  });

  describe('create: questionário do voluntário fixo', () => {
    beforeEach(() => {
      orgRepo.findOne.mockResolvedValue({ id: 'org-1' });
      profileRepo.findOne.mockResolvedValue({ id: 'p-volunteer', name: 'VOLUNTEER' });
      userRepo.save.mockImplementation(async (data) => ({ ...data, id: 'u-new' }));
    });
    const notFirstUser = () => userRepo.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'existing' });

    it('voluntário sem questionário é recusado', async () => {
      notFirstUser();

      await expect(service.create(dto)).rejects.toThrow(new BadRequestException('Preencha o questionário de voluntário fixo.'));
      expect(userRepo.save).not.toHaveBeenCalled();
    });

    it('grava o questionário vinculado ao usuário e o aceite LGPD', async () => {
      notFirstUser();

      await service.create({ ...dto, application });

      expect(userRepo.save.mock.calls[0][0]).toEqual(expect.objectContaining({ consentAt: expect.any(Date), isConfirmed: false }));
      expect(applicationRepo.save).toHaveBeenCalledWith(expect.objectContaining({ ...application, userId: 'u-new' }));
    });

    it('primeiro usuário da organização (admin inicial) dispensa o questionário', async () => {
      userRepo.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce(null).mockResolvedValueOnce(null);
      profileRepo.findOne.mockResolvedValue({ id: 'p-admin', name: 'ADMIN' });

      await service.create(dto);

      expect(applicationRepo.save).not.toHaveBeenCalled();
    });

    it('vale a mesma regra de idade do volante', async () => {
      notFirstUser();

      await expect(service.create({ ...dto, application, birthDate: yearsAgo(15) })).rejects.toThrow('É necessário ter pelo menos 16 anos.');
      expect(userRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('createFloating', () => {
    const floating = {
      fullName: 'Bia Volante',
      cpf: '22222222222',
      email: 'bia@teste.com',
      phone: '41999999999',
      birthDate: '1995-05-10',
      consent: true,
      organizationId: 'org-1',
    } as any;

    beforeEach(() => {
      orgRepo.findOne.mockResolvedValue({ id: 'org-1' });
      profileRepo.findOne.mockResolvedValue({ id: 'p-volunteer', name: 'VOLUNTEER' });
      userRepo.save.mockImplementation(async (data) => ({ ...data, id: 'u-new' }));
    });

    it('cria o volante já confirmado e aprovado, com senha aleatória, na equipe Voluntário Volante', async () => {
      const result = await service.createFloating(floating);

      const saved = userRepo.save.mock.calls[0][0];
      expect(saved).toEqual(
        expect.objectContaining({
          fullName: 'Bia Volante',
          email: 'bia@teste.com',
          profileId: 'p-volunteer',
          isConfirmed: true,
          isApproved: true,
          isActive: true,
          consentAt: expect.any(Date),
        }),
      );
      expect(saved.password).toMatch(/^hashed:.{20,}$/);
      expect(teams.systemTeam).toHaveBeenCalledWith('org-1', 'FLOATING_VOLUNTEER');
      expect(membership.assign).toHaveBeenCalledWith(expect.objectContaining({ email: 'bia@teste.com' }), 't-floating', null);
      expect(mailService.sendFloatingWelcomeEmail).toHaveBeenCalledWith('bia@teste.com', 'Bia Volante');
      expect(mailService.sendConfirmationEmail).not.toHaveBeenCalled();
      expect(result).toEqual({ id: 'u-new', fullName: 'Bia Volante', email: 'bia@teste.com' });
    });

    it('cada volante recebe uma senha diferente', async () => {
      await service.createFloating(floating);
      await service.createFloating({ ...floating, email: 'outra@teste.com', cpf: '33333333333' });

      const [first, second] = userRepo.save.mock.calls.map(([user]) => user.password);
      expect(first).not.toBe(second);
    });

    it('email já cadastrado dá conflito', async () => {
      userRepo.findOne.mockResolvedValueOnce({ id: 'u0' });

      await expect(service.createFloating(floating)).rejects.toThrow(ConflictException);
      expect(userRepo.save).not.toHaveBeenCalled();
    });

    it('CPF já usado na organização dá conflito', async () => {
      userRepo.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'u0' });

      await expect(service.createFloating(floating)).rejects.toThrow(ConflictException);
    });

    describe('idade', () => {
      const guardian = { guardianName: 'Carla Mãe', guardianPhone: '41988887777', guardianConsent: true };

      it('menor de 16 anos é recusado', async () => {
        await expect(service.createFloating({ ...floating, birthDate: yearsAgo(15) })).rejects.toThrow(
          new BadRequestException('É necessário ter pelo menos 16 anos.'),
        );
        expect(userRepo.save).not.toHaveBeenCalled();
      });

      it('16 ou 17 anos sem responsável completo é recusado', async () => {
        const minor = { ...floating, birthDate: yearsAgo(17) };
        const message = new BadRequestException('Menor de 18 anos: informe nome e celular do responsável e confirme que ele está ciente.');

        await expect(service.createFloating(minor)).rejects.toThrow(message);
        await expect(service.createFloating({ ...minor, ...guardian, guardianConsent: false })).rejects.toThrow(message);
        await expect(service.createFloating({ ...minor, ...guardian, guardianPhone: undefined })).rejects.toThrow(message);
      });

      it('16 anos com responsável grava o responsável e o aceite dele', async () => {
        await service.createFloating({ ...floating, birthDate: yearsAgo(16), ...guardian });

        expect(userRepo.save.mock.calls[0][0]).toEqual(
          expect.objectContaining({ guardianName: 'Carla Mãe', guardianPhone: '41988887777', guardianConsentAt: expect.any(Date) }),
        );
      });

      it('maior de idade não guarda responsável mesmo se enviado', async () => {
        await service.createFloating({ ...floating, ...guardian });

        expect(userRepo.save.mock.calls[0][0]).toEqual(expect.objectContaining({ guardianName: null, guardianPhone: null, guardianConsentAt: null }));
      });
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

  it('findAll devolve a equipe de cada usuário e se respondeu o questionário', async () => {
    userRepo.findAndCount.mockResolvedValue([[{ id: 'u1' }, { id: 'u2' }], 2]);
    membership.teamsOf.mockResolvedValue(new Map([['u1', { id: 't1', name: 'Resgate', isAdmin: false }]]));
    applicationRepo.find.mockResolvedValue([{ userId: 'u2' }]);

    const result = await service.findAll(pagination);

    expect(membership.teamsOf).toHaveBeenCalledWith(['u1', 'u2']);
    expect(result.data).toEqual([
      { id: 'u1', team: { id: 't1', name: 'Resgate', isAdmin: false }, hasApplication: false },
      { id: 'u2', team: null, hasApplication: true },
    ]);
  });

  describe('findApplication', () => {
    it('devolve o questionário do usuário da organização', async () => {
      userRepo.findOne.mockResolvedValue({ id: 'u1', organizationId: 'org-1' });
      applicationRepo.findOne.mockResolvedValue({ id: 'a1', userId: 'u1', city: 'Curitiba' });

      expect(await service.findApplication('u1', 'org-1')).toEqual({ id: 'a1', userId: 'u1', city: 'Curitiba' });
    });

    it('usuário de outra organização ou sem questionário dá 404', async () => {
      userRepo.findOne.mockResolvedValueOnce({ id: 'u1', organizationId: 'org-2' });
      await expect(service.findApplication('u1', 'org-1')).rejects.toThrow(new NotFoundException('Usuário não encontrado.'));

      userRepo.findOne.mockResolvedValueOnce({ id: 'u1', organizationId: 'org-1' });
      applicationRepo.findOne.mockResolvedValue(null);
      await expect(service.findApplication('u1', 'org-1')).rejects.toThrow(new NotFoundException('Este voluntário não respondeu o questionário.'));
    });
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

  describe('updateTutorial', () => {
    it('lança NotFoundException quando o usuário não existe', async () => {
      userRepo.findOne.mockResolvedValue(null);

      await expect(service.updateTutorial('x', { tour: 'PETS', version: 1 })).rejects.toThrow(NotFoundException);
    });

    it('marca o primeiro tour visto em usuário sem progresso', async () => {
      userRepo.findOne.mockResolvedValue({ id: 'u1', tutorialProgress: null });

      const result = await service.updateTutorial('u1', { tour: 'PETS', version: 1 });

      expect(result).toEqual({ tours: { PETS: 1 }, disabled: false });
      expect(userRepo.update).toHaveBeenCalledWith('u1', { tutorialProgress: result });
    });

    it('mantém os tours anteriores e atualiza a versão do mesmo tour', async () => {
      userRepo.findOne.mockResolvedValue({ id: 'u1', tutorialProgress: { tours: { PETS: 1, WELCOME: 1 }, disabled: false } });

      const result = await service.updateTutorial('u1', { tour: 'PETS', version: 2 });

      expect(result.tours).toEqual({ PETS: 2, WELCOME: 1 });
    });

    it('desliga os tours sem mexer nos vistos', async () => {
      userRepo.findOne.mockResolvedValue({ id: 'u1', tutorialProgress: { tours: { PETS: 1 }, disabled: false } });

      const result = await service.updateTutorial('u1', { disabled: true });

      expect(result).toEqual({ tours: { PETS: 1 }, disabled: true });
    });
  });

  describe('resetTutorial', () => {
    it('lança NotFoundException quando o usuário não existe', async () => {
      userRepo.findOne.mockResolvedValue(null);

      await expect(service.resetTutorial('x')).rejects.toThrow(NotFoundException);
    });

    it('zera os tours vistos e religa os tours', async () => {
      userRepo.findOne.mockResolvedValue({ id: 'u1', tutorialProgress: { tours: { PETS: 1 }, disabled: true } });

      const result = await service.resetTutorial('u1');

      expect(result).toEqual({ tours: {}, disabled: false });
      expect(userRepo.update).toHaveBeenCalledWith('u1', { tutorialProgress: { tours: {}, disabled: false } });
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
