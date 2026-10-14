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

  describe('equipe Admin', () => {
    it('não pode ser renomeada', async () => {
      repo.findOne.mockResolvedValue({ id: 't0', name: 'Admin', isAdmin: true });

      await expect(service.update('t0', { name: 'Outra' }, 'admin-1')).rejects.toThrow(new BadRequestException('A equipe Admin tem acesso total e não pode ser alterada.'));
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('ensureAdminTeam cria a equipe Admin da organização quando falta', async () => {
      repo.findOne.mockResolvedValue(null);

      await service.ensureAdminTeam('org-1');

      expect(repo.save).toHaveBeenCalledWith(expect.objectContaining({ name: 'Admin', organizationId: 'org-1', isAdmin: true, isActive: true }));
    });

    it('ensureAdminTeam promove uma equipe já chamada Admin', async () => {
      repo.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 't9', name: 'Admin', isAdmin: false });

      await service.ensureAdminTeam('org-1');

      expect(repo.update).toHaveBeenCalledWith('t9', { isAdmin: true, isActive: true });
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('ensureAdminTeam não faz nada quando já existe', async () => {
      repo.findOne.mockResolvedValue({ id: 't0', isAdmin: true });

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
      expect(result).toEqual(expect.objectContaining({ name: 'Resgate', createdBy: 'user-1' }));
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
