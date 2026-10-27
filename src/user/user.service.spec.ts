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
  let mailService: { sendConfirmationEmail: jest.Mock; sendApprovalEmail: jest.Mock; sendPasswordResetEmail: jest.Mock; sendFloatingWelcomeEmail: jest.Mock; sendPasswordChangedEmail: jest.Mock };
  let jwtService: { sign: jest.Mock };
  let refreshTokens: { issue: jest.Mock };
  let access: { isFloatingVolunteer: jest.Mock };
  let realtime: { disconnectUser: jest.Mock };
  let managerQuery: jest.Mock;
  // Consulta que traz o hash da senha (coluna select:false): só login e troca de senha
  let passwordQuery: { leftJoinAndSelect: jest.Mock; addSelect: jest.Mock; where: jest.Mock; andWhere: jest.Mock; getOne: jest.Mock };
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
    mailService = { sendConfirmationEmail: jest.fn(), sendApprovalEmail: jest.fn(), sendPasswordResetEmail: jest.fn(), sendFloatingWelcomeEmail: jest.fn(), sendPasswordChangedEmail: jest.fn() };
    jwtService = { sign: jest.fn(() => 'jwt-token') };
    refreshTokens = { issue: jest.fn(async () => ({ access_token: 'access-novo', refresh_token: 'refresh-novo' })) };
    access = { isFloatingVolunteer: jest.fn(async () => false) };
    realtime = { disconnectUser: jest.fn(async () => undefined) };
    passwordQuery = { leftJoinAndSelect: jest.fn().mockReturnThis(), addSelect: jest.fn().mockReturnThis(), where: jest.fn().mockReturnThis(), andWhere: jest.fn().mockReturnThis(), getOne: jest.fn() };
    managerQuery = jest.fn(async () => undefined);
    (userRepo as any).manager = { query: managerQuery };
    (userRepo as any).createQueryBuilder = jest.fn(() => passwordQuery);
    membership = { assign: jest.fn(), ensureNotLastAdmin: jest.fn(), teamsOf: jest.fn(async () => new Map()), userIdsOfTeam: jest.fn(async () => []) };
    teams = { ensureDefaultTeams: jest.fn(async () => ({ id: 't-admin' })), systemTeam: jest.fn(async () => ({ id: 't-floating' })) };
    service = new UserService(userRepo as any, profileRepo as any, orgRepo as any, mailService as any, jwtService as any, membership as any, teams as any, applicationRepo as any, access as any, realtime as any, refreshTokens as any);
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

      expect(userRepo.save).toHaveBeenCalledWith(expect.objectContaining({ isConfirmed: true, confirmationCode: null }));
      expect(result).toEqual(expect.objectContaining({ id: 'u1', isConfirmed: true }));
    });

    it('não devolve hash, código de confirmação nem carimbos na resposta (CA-64)', async () => {
      userRepo.findOne.mockResolvedValue({ id: 'u1', isConfirmed: false, confirmationCode: 'code' });
      userRepo.save.mockImplementation(async (data) => ({ ...data, password: 'hash', passwordChangedAt: null, passwordResetLockedUntil: null }));

      const result = await service.confirmAccount('code');

      for (const field of ['password', 'confirmationCode', 'passwordChangedAt', 'passwordResetLockedUntil']) expect(result).not.toHaveProperty(field);
    });
  });

  it('findAll filtra pela organização de quem chama e por aprovação só quando informada (CA-65)', async () => {
    await service.findAll(pagination, 'org-1', { isApproved: false });
    await service.findAll(pagination, 'org-1');

    expect(userRepo.findAndCount).toHaveBeenNthCalledWith(1, expect.objectContaining({ where: { organizationId: 'org-1', isApproved: false } }));
    expect(userRepo.findAndCount).toHaveBeenNthCalledWith(2, expect.objectContaining({ where: { organizationId: 'org-1' } }));
  });

  it('findAll devolve a equipe de cada usuário e se respondeu o questionário', async () => {
    userRepo.findAndCount.mockResolvedValue([[{ id: 'u1' }, { id: 'u2' }], 2]);
    membership.teamsOf.mockResolvedValue(new Map([['u1', { id: 't1', name: 'Resgate', isAdmin: false, systemKey: null }]]));
    applicationRepo.find.mockResolvedValue([{ userId: 'u2' }]);

    const result = await service.findAll(pagination, 'org-1');

    expect(membership.teamsOf).toHaveBeenCalledWith(['u1', 'u2']);
    expect(result.data).toEqual([
      { id: 'u1', team: { id: 't1', name: 'Resgate', isAdmin: false, systemKey: null }, hasApplication: false },
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

    await service.findAll(pagination, 'org-1', { teamId: 't1' });

    expect(userRepo.findAndCount).toHaveBeenCalledWith(expect.objectContaining({ where: { organizationId: 'org-1', id: In(['u1', 'u3']) } }));
  });

  describe('findInOrganization (RN-36)', () => {
    it('devolve o usuário da própria organização', async () => {
      userRepo.findOne.mockResolvedValue({ id: 'u1', organizationId: 'org-1' });

      expect(await service.findInOrganization('u1', 'org-1')).toEqual({ id: 'u1', organizationId: 'org-1' });
    });

    it('usuário de outra organização, inexistente ou organização ausente respondem o mesmo 404', async () => {
      userRepo.findOne.mockResolvedValueOnce({ id: 'u1', organizationId: 'org-2' });
      await expect(service.findInOrganization('u1', 'org-1')).rejects.toThrow(new NotFoundException('Usuário não encontrado.'));

      userRepo.findOne.mockResolvedValueOnce(null);
      await expect(service.findInOrganization('x', 'org-1')).rejects.toThrow(new NotFoundException('Usuário não encontrado.'));

      // Sem organização no token, undefined nunca vira "sem filtro"
      userRepo.findOne.mockResolvedValueOnce({ id: 'u1', organizationId: 'org-1' });
      await expect(service.findInOrganization('u1', undefined)).rejects.toThrow(NotFoundException);
    });
  });

  describe('findByEmail', () => {
    it('pede o hash da senha explicitamente (a coluna é select:false), só para o login', async () => {
      passwordQuery.getOne.mockResolvedValue({ id: 'u1', password: 'hash' });

      expect(await service.findByEmail('ana@teste.com')).toEqual({ id: 'u1', password: 'hash' });
      expect(passwordQuery.addSelect).toHaveBeenCalledWith('user.password');
      expect(passwordQuery.where).toHaveBeenCalledWith('user.email = :email', { email: 'ana@teste.com' });
    });
  });

  describe('update', () => {
    it('lança NotFoundException quando o usuário não existe', async () => {
      userRepo.findOne.mockResolvedValue(null);

      await expect(service.update('u1', {}, 'u1', false, 'org-1')).rejects.toThrow(NotFoundException);
    });

    it('usuário de outra organização dá 404, mesmo para quem gerencia (CA-65)', async () => {
      userRepo.findOne.mockResolvedValue({ id: 'u1', organizationId: 'org-2' });

      await expect(service.update('u1', {}, 'admin', true, 'org-1')).rejects.toThrow(NotFoundException);
      expect(userRepo.update).not.toHaveBeenCalled();
    });

    it('não-admin não pode editar outro usuário', async () => {
      userRepo.findOne.mockResolvedValue({ id: 'u1', organizationId: 'org-1' });

      await expect(service.update('u1', {}, 'u2', false, 'org-1')).rejects.toThrow(ForbiddenException);
    });

    it('não-admin editando o próprio perfil só altera campos pessoais', async () => {
      userRepo.findOne.mockResolvedValue({ id: 'u1', organizationId: 'org-1' });

      await service.update('u1', { fullName: 'Nova', email: 'x@x.com', profileId: 'p-admin' } as any, 'u1', false, 'org-1');
      expect(managerQuery).not.toHaveBeenCalled();

      expect(userRepo.update).toHaveBeenCalledWith('u1', {
        fullName: 'Nova',
        cpf: undefined,
        phone: undefined,
        birthDate: undefined,
        updatedBy: 'u1',
      });
    });

    it('admin pode alterar qualquer campo de qualquer usuário da organização', async () => {
      userRepo.findOne.mockResolvedValue({ id: 'u1', organizationId: 'org-1' });

      await service.update('u1', { profileId: 'p-admin' } as any, 'admin', true, 'org-1');

      expect(userRepo.update).toHaveBeenCalledWith('u1', { profileId: 'p-admin', updatedBy: 'admin' });
    });

    describe('troca de e-mail pelo admin', () => {
      const target = { id: 'u1', email: 'antigo@teste.com', organizationId: 'org-1' };
      beforeEach(() => {
        userRepo.findOne.mockResolvedValue(target);
        passwordQuery.getOne.mockResolvedValue(null);
      });

      it('grava o e-mail normalizado, revoga as sessões, fecha códigos abertos e derruba o websocket', async () => {
        await service.update('u1', { email: ' Novo@Teste.COM ' }, 'admin', true, 'org-1', true);

        expect(userRepo.update).toHaveBeenCalledWith('u1', { email: 'novo@teste.com', passwordChangedAt: expect.any(Date), updatedBy: 'admin' });
        expect(managerQuery).toHaveBeenCalledWith(expect.stringContaining('UPDATE password_reset_codes'), ['u1']);
        expect(managerQuery).toHaveBeenCalledWith(expect.stringContaining('UPDATE email_change_requests SET closed_at'), ['u1']);
        expect(realtime.disconnectUser).toHaveBeenCalledWith('u1');
      });

      it('e-mail já usado por outro usuário (sem diferenciar maiúsculas) dá 409 e não grava', async () => {
        passwordQuery.getOne.mockResolvedValue({ id: 'u2' });

        const call = service.update('u1', { email: 'Outro@Teste.com' }, 'admin', true, 'org-1', true);

        await expect(call).rejects.toThrow(new ConflictException('Este e-mail já está em uso.'));
        expect(passwordQuery.where).toHaveBeenCalledWith('lower(user.email) = :email', { email: 'outro@teste.com' });
        expect(userRepo.update).not.toHaveBeenCalled();
        expect(realtime.disconnectUser).not.toHaveBeenCalled();
      });

      it('violação de unique do banco (corrida) também dá 409', async () => {
        userRepo.update.mockRejectedValue(Object.assign(new Error('duplicate key'), { code: '23505' }));

        await expect(service.update('u1', { email: 'novo@teste.com' }, 'admin', true, 'org-1', true)).rejects.toThrow(new ConflictException('Este e-mail já está em uso.'));
        expect(managerQuery).not.toHaveBeenCalled();
      });

      it('quem só gerencia Voluntários (fora da equipe Admin) não troca o e-mail de outro: 403, e os outros campos continuam editáveis', async () => {
        await expect(service.update('u1', { email: 'novo@teste.com' }, 'gestor', true, 'org-1', false)).rejects.toThrow(new ForbiddenException('Só o Admin pode alterar o e-mail.'));
        expect(userRepo.update).not.toHaveBeenCalled();
        expect(realtime.disconnectUser).not.toHaveBeenCalled();

        await service.update('u1', { fullName: 'Ana', email: ' ANTIGO@teste.com' }, 'gestor', true, 'org-1', false);
        expect(userRepo.update).toHaveBeenCalledWith('u1', { fullName: 'Ana', updatedBy: 'gestor' });
      });

      it('o mesmo e-mail (após normalizar) é no-op: nada é revogado', async () => {
        await service.update('u1', { email: ' ANTIGO@teste.com', fullName: 'Ana' }, 'admin', true, 'org-1', true);

        expect(userRepo.update).toHaveBeenCalledWith('u1', { fullName: 'Ana', updatedBy: 'admin' });
        expect(managerQuery).not.toHaveBeenCalled();
        expect(realtime.disconnectUser).not.toHaveBeenCalled();
      });

      it('admin trocando o PRÓPRIO e-mail por esta rota dá 400', async () => {
        const call = service.update('u1', { email: 'novo@teste.com' }, 'u1', true, 'org-1');

        await expect(call).rejects.toThrow(new BadRequestException('Altere seu e-mail em Editar perfil.'));
        expect(userRepo.update).not.toHaveBeenCalled();
      });

      it('admin reenviando o próprio e-mail sem mudar não dá erro', async () => {
        await service.update('u1', { email: 'antigo@teste.com', fullName: 'Ana' }, 'u1', true, 'org-1');

        expect(userRepo.update).toHaveBeenCalledWith('u1', { fullName: 'Ana', updatedBy: 'u1' });
      });
    });
  });

  describe('activate / reject', () => {
    it('lançam NotFoundException quando o usuário não existe', async () => {
      userRepo.findOne.mockResolvedValue(null);

      await expect(service.activate('x', 'admin', 'org-1')).rejects.toThrow(NotFoundException);
      await expect(service.reject('x', 'admin', 'org-1')).rejects.toThrow(NotFoundException);
    });

    it('usuário de outra organização dá 404 (CA-65)', async () => {
      userRepo.findOne.mockResolvedValue({ id: 'u1', organizationId: 'org-2' });

      await expect(service.activate('u1', 'admin', 'org-1')).rejects.toThrow(NotFoundException);
      await expect(service.reject('u1', 'admin', 'org-1')).rejects.toThrow(NotFoundException);
      expect(userRepo.update).not.toHaveBeenCalled();
    });

    it('ativam e desativam o usuário', async () => {
      userRepo.findOne.mockResolvedValue({ id: 'u1', organizationId: 'org-1' });

      await service.activate('u1', 'admin', 'org-1');
      await service.reject('u1', 'admin', 'org-1');

      expect(userRepo.update).toHaveBeenNthCalledWith(1, 'u1', { isActive: true, updatedBy: 'admin' });
      expect(userRepo.update).toHaveBeenNthCalledWith(2, 'u1', { isActive: false, updatedBy: 'admin' });
    });
  });

  describe('approve', () => {
    it('lança NotFoundException quando o usuário não existe', async () => {
      userRepo.findOne.mockResolvedValue(null);

      await expect(service.approve('x', 't1', 'admin', 'org-1')).rejects.toThrow(NotFoundException);
    });

    it('usuário de outra organização dá 404 e não aprova nem envia e-mail', async () => {
      userRepo.findOne.mockResolvedValue({ id: 'u1', organizationId: 'org-2' });

      await expect(service.approve('u1', 't1', 'admin', 'org-1')).rejects.toThrow(NotFoundException);
      expect(membership.assign).not.toHaveBeenCalled();
      expect(mailService.sendApprovalEmail).not.toHaveBeenCalled();
    });

    it('coloca na equipe antes de aprovar', async () => {
      const user = { id: 'u1', fullName: 'Ana', organizationId: 'org-1' };
      userRepo.findOne.mockResolvedValue(user);

      await service.approve('u1', 't1', 'admin', 'org-1');

      expect(membership.assign).toHaveBeenCalledWith(user, 't1', 'admin');
      expect(membership.assign.mock.invocationCallOrder[0]).toBeLessThan(userRepo.update.mock.invocationCallOrder[0]);
    });

    it('não aprova quando a equipe é inválida', async () => {
      userRepo.findOne.mockResolvedValue({ id: 'u1', organizationId: 'org-1' });
      membership.assign.mockRejectedValue(new BadRequestException('Equipe não encontrada nesta organização.'));

      await expect(service.approve('u1', 'tx', 'admin', 'org-1')).rejects.toThrow('Equipe não encontrada nesta organização.');
      expect(userRepo.update).not.toHaveBeenCalled();
      expect(mailService.sendApprovalEmail).not.toHaveBeenCalled();
    });

    it('aprova, gera token com o perfil e envia email de acesso', async () => {
      const updated = { id: 'u1', email: 'ana@teste.com', fullName: 'Ana', profileId: 'p1', profile: { name: 'VOLUNTEER' }, organizationId: 'org-1' };
      userRepo.findOne.mockResolvedValueOnce({ id: 'u1', organizationId: 'org-1' }).mockResolvedValueOnce(updated);

      const result = await service.approve('u1', 't1', 'admin', 'org-1');

      expect(userRepo.update).toHaveBeenCalledWith('u1', { isApproved: true, updatedBy: 'admin' });
      expect(jwtService.sign).toHaveBeenCalledWith(
        { sub: 'u1', email: 'ana@teste.com', profileId: 'p1', profileName: 'VOLUNTEER', organizationId: 'org-1' },
        { expiresIn: '8h' },
      );
      expect(refreshTokens.issue).not.toHaveBeenCalled();
      expect(mailService.sendApprovalEmail).toHaveBeenCalledWith('ana@teste.com', 'Ana', 'jwt-token');
      expect(result).toBe(updated);
    });
  });

  describe('reject', () => {
    it('não desativa o último membro da equipe Admin', async () => {
      userRepo.findOne.mockResolvedValue({ id: 'u1', organizationId: 'org-1' });
      membership.ensureNotLastAdmin.mockRejectedValue(new BadRequestException('A equipe Admin precisa de ao menos um membro ativo.'));

      await expect(service.reject('u1', 'admin', 'org-1')).rejects.toThrow('A equipe Admin precisa de ao menos um membro ativo.');
      expect(userRepo.update).not.toHaveBeenCalled();
    });
  });

  describe('changeTeam', () => {
    it('troca a equipe do usuário', async () => {
      const user = { id: 'u1', organizationId: 'org-1' };
      userRepo.findOne.mockResolvedValue(user);

      await service.changeTeam('u1', 't2', 'admin', 'org-1');

      expect(membership.assign).toHaveBeenCalledWith(user, 't2', 'admin');
    });

    it('usuário de outra organização dá 404', async () => {
      userRepo.findOne.mockResolvedValue({ id: 'u1', organizationId: 'org-2' });

      await expect(service.changeTeam('u1', 't2', 'admin', 'org-1')).rejects.toThrow(NotFoundException);
      expect(membership.assign).not.toHaveBeenCalled();
    });

    it('lança NotFoundException quando o usuário não existe', async () => {
      userRepo.findOne.mockResolvedValue(null);

      await expect(service.changeTeam('x', 't2', 'admin', 'org-1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('changePassword', () => {
    const profileUser = { id: 'u1', email: 'ana@teste.com', fullName: 'Ana', password: 'hash', profileId: 'p1', profile: { name: 'VOLUNTEER' }, organizationId: 'org-1' };

    it('lança NotFoundException quando o usuário não existe', async () => {
      passwordQuery.getOne.mockResolvedValue(null);

      await expect(service.changePassword('x', { currentPassword: 'a', newPassword: 'b' })).rejects.toThrow(NotFoundException);
    });

    it('lança BadRequestException com senha atual incorreta, sem gravar nem derrubar sessões', async () => {
      passwordQuery.getOne.mockResolvedValue(profileUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(service.changePassword('u1', { currentPassword: 'errada', newPassword: 'nova' })).rejects.toThrow(BadRequestException);
      expect(userRepo.update).not.toHaveBeenCalled();
      expect(refreshTokens.issue).not.toHaveBeenCalled();
    });

    it('pede o hash da senha atual explicitamente (select:false)', async () => {
      passwordQuery.getOne.mockResolvedValue(profileUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      await service.changePassword('u1', { currentPassword: 'atual', newPassword: 'nova' });

      expect(passwordQuery.addSelect).toHaveBeenCalledWith('user.password');
      expect(bcrypt.compare).toHaveBeenCalledWith('atual', 'hash');
    });

    it('grava a nova senha com hash e password_changed_at, e devolve um token novo (CA-45)', async () => {
      passwordQuery.getOne.mockResolvedValue(profileUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      const result = await service.changePassword('u1', { currentPassword: 'atual', newPassword: 'nova' });

      expect(userRepo.update).toHaveBeenCalledWith('u1', { password: 'hashed:nova', passwordChangedAt: expect.any(Date) });
      expect(refreshTokens.issue).toHaveBeenCalledWith({ id: 'u1', email: 'ana@teste.com', profileId: 'p1', profileName: 'VOLUNTEER', organizationId: 'org-1' }, undefined);
      expect(result).toEqual({ message: 'Senha alterada com sucesso.', access_token: 'access-novo', refresh_token: 'refresh-novo' });
    });

    it('emite o par só depois de gravar a troca, de fechar o pedido de e-mail e de derrubar os sockets (RN-06, RN-30) e avisa por e-mail', async () => {
      passwordQuery.getOne.mockResolvedValue(profileUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      await service.changePassword('u1', { currentPassword: 'atual', newPassword: 'nova' }, 'Mozilla/5.0');

      const issueOrder = refreshTokens.issue.mock.invocationCallOrder[0];
      expect(userRepo.update.mock.invocationCallOrder[0]).toBeLessThan(issueOrder);
      expect(managerQuery.mock.invocationCallOrder[0]).toBeLessThan(issueOrder);
      expect(realtime.disconnectUser.mock.invocationCallOrder[0]).toBeLessThan(issueOrder);
      expect(refreshTokens.issue.mock.calls[0][1]).toBe('Mozilla/5.0');
      expect(mailService.sendPasswordChangedEmail).toHaveBeenCalledWith('ana@teste.com', 'Ana');
    });
  });

  describe('websockets abertos caem junto com a sessão (SEC-BUG-01)', () => {
    const user = { id: 'u1', email: 'ana@teste.com', fullName: 'Ana', profileId: 'p1', profile: { name: 'VOLUNTEER' }, organizationId: 'org-1' };

    it('troca de senha pelo perfil', async () => {
      passwordQuery.getOne.mockResolvedValue({ ...user, password: 'hash' });
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      await service.changePassword('u1', { currentPassword: 'a', newPassword: 'nova' });

      expect(realtime.disconnectUser).toHaveBeenCalledWith('u1');
    });

    it('reset pela tela Voluntários', async () => {
      userRepo.findOne.mockResolvedValue(user);

      await service.resetPassword('u1', 'org-1');

      expect(realtime.disconnectUser).toHaveBeenCalledWith('u1');
    });

    it('desativação (reject e edição com isActive=false) e troca de equipe', async () => {
      userRepo.findOne.mockResolvedValue(user);

      await service.reject('u1', 'admin', 'org-1');
      await service.update('u1', { isActive: false }, 'admin', true, 'org-1');
      await service.changeTeam('u1', 't2', 'admin', 'org-1');

      expect(realtime.disconnectUser).toHaveBeenCalledTimes(3);
    });

    it('edição que não desativa não derruba o websocket', async () => {
      userRepo.findOne.mockResolvedValue(user);

      await service.update('u1', { fullName: 'Ana Maria' }, 'admin', true, 'org-1');

      expect(realtime.disconnectUser).not.toHaveBeenCalled();
    });

    it('troca de senha recusada não derruba nada', async () => {
      passwordQuery.getOne.mockResolvedValue({ ...user, password: 'hash' });
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await service.changePassword('u1', { currentPassword: 'x', newPassword: 'nova' }).catch(() => undefined);

      expect(realtime.disconnectUser).not.toHaveBeenCalled();
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
    const target = { id: 'u1', email: 'ana@teste.com', fullName: 'Ana', organizationId: 'org-1' };

    it('lança NotFoundException quando o usuário não existe', async () => {
      userRepo.findOne.mockResolvedValue(null);

      await expect(service.resetPassword('x', 'org-1')).rejects.toThrow(NotFoundException);
    });

    it('usuário de outra organização dá 404, sem trocar a senha nem mandar e-mail (CA-63)', async () => {
      userRepo.findOne.mockResolvedValue({ ...target, organizationId: 'org-2' });

      await expect(service.resetPassword('u1', 'org-1')).rejects.toThrow(new NotFoundException('Usuário não encontrado.'));
      expect(userRepo.update).not.toHaveBeenCalled();
      expect(mailService.sendPasswordResetEmail).not.toHaveBeenCalled();
    });

    it('volante dá 400, sem trocar a senha nem mandar e-mail (CA-42)', async () => {
      userRepo.findOne.mockResolvedValue(target);
      access.isFloatingVolunteer.mockResolvedValue(true);

      await expect(service.resetPassword('u1', 'org-1')).rejects.toThrow(
        new BadRequestException('Voluntários volantes não usam o painel. Troque a equipe antes de redefinir a senha.'),
      );
      expect(access.isFloatingVolunteer).toHaveBeenCalledWith('u1');
      expect(userRepo.update).not.toHaveBeenCalled();
      expect(mailService.sendPasswordResetEmail).not.toHaveBeenCalled();
    });

    it('gera senha temporária de 8 caracteres, grava password_changed_at e envia por email (CA-44)', async () => {
      userRepo.findOne.mockResolvedValue(target);

      await service.resetPassword('u1', 'org-1');

      const [, , tempPassword] = mailService.sendPasswordResetEmail.mock.calls[0];
      expect(tempPassword).toHaveLength(8);
      expect(userRepo.update).toHaveBeenCalledWith('u1', { password: `hashed:${tempPassword}`, passwordChangedAt: expect.any(Date) });
    });
  });
});

describe('token do e-mail de aprovação (CA-25, SEC-17)', () => {
  it('vale 8 h (28.800 s) com e sem ACCESS_TOKEN_TTL e não tem fid nem scope', async () => {
    const { JwtService } = await import('@nestjs/jwt');
    const { accessTokenTtl, APPROVAL_LINK_TTL, panelTokenPayload } = await import('../auth/panel-token');
    const jwt = new JwtService({ secret: 'unit-test-secret', signOptions: { expiresIn: accessTokenTtl() } });
    const env = process.env.ACCESS_TOKEN_TTL;
    try {
      for (const ttl of [undefined, '1m']) {
        if (ttl) process.env.ACCESS_TOKEN_TTL = ttl;
        else delete process.env.ACCESS_TOKEN_TTL;
        const signer = new JwtService({ secret: 'unit-test-secret', signOptions: { expiresIn: accessTokenTtl() } });
        const token = signer.sign(panelTokenPayload({ id: 'u1', email: 'a@b.c', profileId: 'p1', organizationId: 'o1' }), { expiresIn: APPROVAL_LINK_TTL });
        const claims: any = jwt.decode(token);

        expect(claims.exp - claims.iat).toBe(28_800);
        expect(claims).not.toHaveProperty('fid');
        expect(claims).not.toHaveProperty('scope');
      }
    } finally {
      if (env === undefined) delete process.env.ACCESS_TOKEN_TTL;
      else process.env.ACCESS_TOKEN_TTL = env;
    }
  });
});
