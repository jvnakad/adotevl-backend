import { AccessService } from './access.service';
import { AccessLevel, ADMIN_PERMISSIONS, Screen } from './access';
import { createMockRepository, MockRepository } from '../testing/mock-repository';

describe('AccessService.forUser', () => {
  let volunteerRepo: MockRepository;
  let permissionRepo: MockRepository;
  let service: AccessService;

  const team = (overrides = {}) => ({ id: 't1', name: 'Resgate', isActive: true, isAdmin: false, ...overrides });

  beforeEach(() => {
    volunteerRepo = createMockRepository();
    permissionRepo = createMockRepository();
    service = new AccessService(volunteerRepo as any, permissionRepo as any);
  });

  it('monta as permissões da equipe do voluntário ativo', async () => {
    volunteerRepo.findOne.mockResolvedValue({ userId: 'u1', team: team() });
    permissionRepo.find.mockResolvedValue([
      { screen: Screen.PETS, level: AccessLevel.EDIT },
      { screen: Screen.ADOPTERS, level: AccessLevel.VIEW },
    ]);

    const access = await service.forUser('u1');

    expect(volunteerRepo.findOne).toHaveBeenCalledWith({ where: { userId: 'u1', isActive: true }, relations: { team: true } });
    expect(permissionRepo.find).toHaveBeenCalledWith({ where: { teamId: 't1' } });
    expect(access).toEqual({
      teamId: 't1',
      teamName: 'Resgate',
      isAdmin: false,
      permissions: { [Screen.PETS]: AccessLevel.EDIT, [Screen.ADOPTERS]: AccessLevel.VIEW },
    });
  });

  it('equipe Admin recebe Editar em todas as telas sem consultar a tabela', async () => {
    volunteerRepo.findOne.mockResolvedValue({ userId: 'u1', team: team({ name: 'Admin', isAdmin: true }) });

    const access = await service.forUser('u1');

    expect(access).toEqual({ teamId: 't1', teamName: 'Admin', isAdmin: true, permissions: ADMIN_PERMISSIONS });
    expect(permissionRepo.find).not.toHaveBeenCalled();
  });

  it.each([
    ['sem registro de voluntário', null],
    ['voluntário sem equipe', { userId: 'u1', team: null }],
    ['equipe desativada', { userId: 'u1', team: team({ isActive: false }) }],
  ])('%s não tem acesso', async (_label, volunteer) => {
    volunteerRepo.findOne.mockResolvedValue(volunteer);

    await expect(service.forUser('u1')).resolves.toBeNull();
  });

  it('sem usuário não consulta nada', async () => {
    await expect(service.forUser(undefined)).resolves.toBeNull();
    expect(volunteerRepo.findOne).not.toHaveBeenCalled();
  });
});

describe('AccessService.isFloatingVolunteer', () => {
  let volunteerRepo: MockRepository;
  let service: AccessService;

  beforeEach(() => {
    volunteerRepo = createMockRepository();
    service = new AccessService(volunteerRepo as any, createMockRepository() as any);
  });

  it('equipe ativa Voluntário Volante = volante, seja qual for a matriz de permissões dela', async () => {
    volunteerRepo.findOne.mockResolvedValue({ userId: 'u1', team: { id: 't9', isActive: true, systemKey: 'FLOATING_VOLUNTEER' } });

    expect(await service.isFloatingVolunteer('u1')).toBe(true);
    expect(volunteerRepo.findOne).toHaveBeenCalledWith({ where: { userId: 'u1', isActive: true }, relations: { team: true } });
  });

  it.each([
    ['outra equipe padrão', { team: { systemKey: 'FIXED_VOLUNTEER' } }],
    ['equipe sem chave de sistema', { team: { systemKey: null } }],
    ['vínculo sem equipe', { team: null }],
    ['sem vínculo ativo', null],
  ])('%s não é volante', async (_label, volunteer) => {
    volunteerRepo.findOne.mockResolvedValue(volunteer);

    expect(await service.isFloatingVolunteer('u1')).toBe(false);
  });

  it('sem id não consulta o banco', async () => {
    expect(await service.isFloatingVolunteer(undefined)).toBe(false);
    expect(volunteerRepo.findOne).not.toHaveBeenCalled();
  });
});
