import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { AccessLevel, ADMIN_PERMISSIONS, Screen, SCREENS } from '../access/access';
import { TeamService } from './team.service';
import { createMockRepository, MockRepository, pagination } from '../testing/mock-repository';

describe('TeamService', () => {
  let repo: MockRepository;
  let permissionRepo: MockRepository;
  let service: TeamService;

  beforeEach(() => {
    repo = createMockRepository();
    permissionRepo = createMockRepository();
    permissionRepo.find.mockResolvedValue([]);
    service = new TeamService(repo as any, permissionRepo as any);
  });

  const allNone = () => Object.fromEntries(SCREENS.map((screen) => [screen.key, AccessLevel.NONE]));

  describe('findOne', () => {
    it('devolve a matriz completa: tela sem linha vira Sem acesso', async () => {
      repo.findOne.mockResolvedValue({ id: 't1', name: 'Resgate', isAdmin: false });
      permissionRepo.find.mockResolvedValue([{ screen: Screen.PETS, level: AccessLevel.EDIT }]);

      const team = await service.findOne('t1');

      expect(team.permissions).toEqual({ ...allNone(), [Screen.PETS]: AccessLevel.EDIT });
    });

    it('equipe Admin devolve Editar em tudo', async () => {
      repo.findOne.mockResolvedValue({ id: 't0', name: 'Admin', isAdmin: true });

      expect((await service.findOne('t0')).permissions).toEqual(ADMIN_PERMISSIONS);
    });
  });

  describe('setPermissions', () => {
    beforeEach(() => repo.findOne.mockResolvedValue({ id: 't1', name: 'Resgate', isAdmin: false }));

    it('substitui as permissões da equipe sem gravar Sem acesso', async () => {
      await service.setPermissions('t1', { [Screen.PETS]: AccessLevel.EDIT, [Screen.MEDICAL_RECORDS]: AccessLevel.VIEW, [Screen.CAMPAIGNS]: AccessLevel.NONE }, 'admin-1');

      expect(permissionRepo.delete).toHaveBeenCalledWith({ teamId: 't1' });
      expect(permissionRepo.save).toHaveBeenCalledWith([
        { teamId: 't1', screen: Screen.PETS, level: AccessLevel.EDIT, updatedBy: 'admin-1' },
        { teamId: 't1', screen: Screen.MEDICAL_RECORDS, level: AccessLevel.VIEW, updatedBy: 'admin-1' },
      ]);
      expect(repo.update).toHaveBeenCalledWith('t1', { accessConfiguredAt: expect.any(Date), updatedBy: 'admin-1' });
    });

    it('equipe Admin não pode ter permissões alteradas', async () => {
      repo.findOne.mockResolvedValue({ id: 't0', name: 'Admin', isAdmin: true });

      await expect(service.setPermissions('t0', {}, 'admin-1')).rejects.toThrow(new BadRequestException('A equipe Admin tem acesso total e não pode ser alterada.'));
      expect(permissionRepo.delete).not.toHaveBeenCalled();
    });

    it('sub-tela exige ao menos Visualizar na tela mãe', async () => {
      await expect(service.setPermissions('t1', { [Screen.MEDICAL_RECORDS]: AccessLevel.VIEW }, 'admin-1')).rejects.toThrow(
        new BadRequestException('Prontuário exige ao menos Visualizar em Pets.'),
      );
    });

    it('tela só de leitura não aceita Editar', async () => {
      const permissions = { [Screen.ADOPTERS]: AccessLevel.VIEW, [Screen.ADOPTION_HISTORY]: AccessLevel.EDIT };

      await expect(service.setPermissions('t1', permissions, 'admin-1')).rejects.toThrow(new BadRequestException('Histórico de adoção só pode ser Visualizar ou Sem acesso.'));
    });
  });

  describe('telas do Estoque', () => {
    beforeEach(() => repo.findOne.mockResolvedValue({ id: 't1', name: 'Resgate', isAdmin: false }));

    it('Tipos de produto e Histórico do estoque exigem ao menos Visualizar em Estoque', async () => {
      await expect(service.setPermissions('t1', { [Screen.STOCK_PRODUCT_TYPES]: AccessLevel.VIEW }, 'admin-1')).rejects.toThrow(
        new BadRequestException('Tipos de produto exige ao menos Visualizar em Estoque.'),
      );
      await expect(service.setPermissions('t1', { [Screen.STOCK_HISTORY]: AccessLevel.VIEW }, 'admin-1')).rejects.toThrow(
        new BadRequestException('Histórico do estoque exige ao menos Visualizar em Estoque.'),
      );
    });

    it('Histórico do estoque não aceita Editar', async () => {
      const permissions = { [Screen.STOCK]: AccessLevel.EDIT, [Screen.STOCK_HISTORY]: AccessLevel.EDIT };

      await expect(service.setPermissions('t1', permissions, 'admin-1')).rejects.toThrow(new BadRequestException('Histórico do estoque só pode ser Visualizar ou Sem acesso.'));
    });

    it('aceita a matriz válida e a equipe Admin nasce com Editar, Editar e Visualizar', async () => {
      await service.setPermissions('t1', { [Screen.STOCK]: AccessLevel.VIEW, [Screen.STOCK_PRODUCT_TYPES]: AccessLevel.EDIT, [Screen.STOCK_HISTORY]: AccessLevel.VIEW }, 'admin-1');

      expect(permissionRepo.save).toHaveBeenCalledTimes(1);
      expect(ADMIN_PERMISSIONS).toMatchObject({ [Screen.STOCK]: AccessLevel.EDIT, [Screen.STOCK_PRODUCT_TYPES]: AccessLevel.EDIT, [Screen.STOCK_HISTORY]: AccessLevel.VIEW });
    });
  });

  describe('equipes padrão', () => {
    it('ensureDefaultTeams cria as que faltam, sem acesso, marcadas como padrão', async () => {
      // Admin já existe; demais não
      repo.findOne.mockImplementation(async ({ where }) => (where.isAdmin ? { id: 't0', isAdmin: true, systemKey: 'ADMIN' } : null));

      await service.ensureDefaultTeams('org-1');

      const created = repo.save.mock.calls.map(([team]) => [team.name, team.systemKey]);
      expect(created).toEqual([
        ['Financeiro', 'FINANCIAL'],
        ['Voluntário Fixo', 'FIXED_VOLUNTEER'],
        ['Voluntário Volante', 'FLOATING_VOLUNTEER'],
      ]);
      expect(repo.save).toHaveBeenCalledWith(expect.objectContaining({ organizationId: 'org-1', isActive: true, accessConfiguredAt: expect.any(Date) }));
      expect(permissionRepo.save).not.toHaveBeenCalled();
    });

    it('equipe já existente com o nome padrão vira a equipe padrão (mantém membros e acesso)', async () => {
      repo.findOne.mockImplementation(async ({ where }) => {
        if (where.isAdmin) return { id: 't0', isAdmin: true, systemKey: 'ADMIN' };
        if (where.name === 'Financeiro') return { id: 't5', name: 'Financeiro', systemKey: null };
        if (where.systemKey) return null;
        return { id: `t-${where.name}`, name: where.name, systemKey: null };
      });

      await service.ensureDefaultTeams('org-1');

      expect(repo.update).toHaveBeenCalledWith('t5', { systemKey: 'FINANCIAL', isActive: true });
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('equipe padrão não pode ser renomeada', async () => {
      repo.findOne.mockResolvedValue({ id: 't5', name: 'Financeiro', isAdmin: false, systemKey: 'FINANCIAL' });

      await expect(service.update('t5', { name: 'Grana' }, 'admin-1')).rejects.toThrow(new BadRequestException('Equipe padrão do sistema não pode ser renomeada.'));
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('equipe padrão continua com a matriz editável', async () => {
      repo.findOne.mockResolvedValue({ id: 't5', name: 'Financeiro', isAdmin: false, systemKey: 'FINANCIAL' });

      await service.setPermissions('t5', { [Screen.FINANCIAL]: AccessLevel.EDIT }, 'admin-1');

      expect(permissionRepo.save).toHaveBeenCalledWith([{ teamId: 't5', screen: Screen.FINANCIAL, level: AccessLevel.EDIT, updatedBy: 'admin-1' }]);
    });
  });

  describe('equipe Admin', () => {
    it('não pode ser renomeada', async () => {
      repo.findOne.mockResolvedValue({ id: 't0', name: 'Admin', isAdmin: true });

      await expect(service.update('t0', { name: 'Outra' }, 'admin-1')).rejects.toThrow(new BadRequestException('A equipe Admin tem acesso total e não pode ser alterada.'));
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('ensureAdminTeam cria a equipe Admin da organização quando falta', async () => {
      repo.findOne.mockResolvedValue(null);

      await service.ensureAdminTeam('org-1');

      expect(repo.save).toHaveBeenCalledWith(expect.objectContaining({ name: 'Admin', organizationId: 'org-1', isAdmin: true, isActive: true, systemKey: 'ADMIN' }));
    });

    it('ensureAdminTeam promove uma equipe já chamada Admin', async () => {
      repo.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 't9', name: 'Admin', isAdmin: false });

      await service.ensureAdminTeam('org-1');

      expect(repo.update).toHaveBeenCalledWith('t9', { isAdmin: true, isActive: true, systemKey: 'ADMIN' });
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('ensureAdminTeam não faz nada quando já existe', async () => {
      repo.findOne.mockResolvedValue({ id: 't0', isAdmin: true, systemKey: 'ADMIN' });

      const team = await service.ensureAdminTeam('org-1');

      expect(team.id).toBe('t0');
      expect(repo.save).not.toHaveBeenCalled();
      expect(repo.update).not.toHaveBeenCalled();
    });
  });

  describe('create', () => {
    it('cria equipe quando o nome é único na organização', async () => {
      repo.findOne.mockResolvedValue(null);

      const result = await service.create({ name: 'Resgate', organizationId: 'org-1' } as any, 'user-1');

      expect(repo.findOne).toHaveBeenCalledWith({ where: { name: 'Resgate', organizationId: 'org-1' } });
      expect(result).toEqual(expect.objectContaining({ name: 'Resgate', createdBy: 'user-1', accessConfiguredAt: expect.any(Date) }));
    });

    it('lança ConflictException com nome repetido na organização', async () => {
      repo.findOne.mockResolvedValue({ id: 't1' });

      await expect(service.create({ name: 'Resgate', organizationId: 'org-1' } as any)).rejects.toThrow(ConflictException);
      expect(repo.save).not.toHaveBeenCalled();
    });
  });

  it('findAll filtra equipes ativas', async () => {
    await service.findAll(pagination, 'org-1');
    await service.findAll(pagination);

    expect(repo.findAndCount).toHaveBeenNthCalledWith(1, expect.objectContaining({ where: { organizationId: 'org-1', isActive: true } }));
    expect(repo.findAndCount).toHaveBeenNthCalledWith(2, expect.objectContaining({ where: { isActive: true } }));
  });

  it('findOne lança NotFoundException quando não existe', async () => {
    repo.findOne.mockResolvedValue(null);

    await expect(service.findOne('x')).rejects.toThrow(NotFoundException);
  });

  it('update grava updatedBy', async () => {
    repo.findOne.mockResolvedValue({ id: 't1', name: 'Eventos', isAdmin: false });

    await service.update('t1', { name: 'Eventos' }, 'user-2');

    expect(repo.update).toHaveBeenCalledWith('t1', { name: 'Eventos', updatedBy: 'user-2' });
  });
});
