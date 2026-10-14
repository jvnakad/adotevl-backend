import { BadRequestException } from '@nestjs/common';
import { TeamMembershipService } from './team-membership.service';
import { createMockRepository, MockRepository } from '../testing/mock-repository';

describe('TeamMembershipService', () => {
  let teamRepo: MockRepository;
  let volunteerRepo: MockRepository;
  let service: TeamMembershipService;

  const user = { id: 'u1', fullName: 'Ana Souza', cpf: '52998224725', birthDate: new Date('1990-05-10'), organizationId: 'org-1' };
  const resgate = { id: 't1', name: 'Resgate', organizationId: 'org-1', isActive: true, isAdmin: false };
  const admin = { id: 't0', name: 'Admin', organizationId: 'org-1', isActive: true, isAdmin: true };

  beforeEach(() => {
    teamRepo = createMockRepository();
    volunteerRepo = createMockRepository();
    service = new TeamMembershipService(teamRepo as any, volunteerRepo as any);
    teamRepo.findOne.mockImplementation(async ({ where }) => [resgate, admin].find((team) => team.id === where.id && team.organizationId === where.organizationId) ?? null);
  });

  describe('assign', () => {
    it('cria o registro de voluntário na equipe quando o usuário ainda não tem', async () => {
      volunteerRepo.findOne.mockResolvedValue(null);

      await service.assign(user as any, 't1', 'admin-1');

      expect(volunteerRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'u1', name: 'Ana Souza', cpf: '52998224725', teamId: 't1', isActive: true, createdBy: 'admin-1', updatedBy: 'admin-1' }),
      );
    });

    it('move o voluntário existente para a nova equipe', async () => {
      volunteerRepo.findOne.mockResolvedValue({ id: 'v1', userId: 'u1', teamId: 't1', team: resgate });

      await service.assign(user as any, 't0', 'admin-1');

      expect(volunteerRepo.update).toHaveBeenCalledWith('v1', { teamId: 't0', isActive: true, updatedBy: 'admin-1' });
    });

    it.each([
      ['inexistente', 'tx'],
      ['de outra organização', 't1-outra'],
    ])('recusa equipe %s', async (_label, teamId) => {
      await expect(service.assign(user as any, teamId, 'admin-1')).rejects.toThrow(new BadRequestException('Equipe não encontrada nesta organização.'));
    });

    it('recusa equipe desativada', async () => {
      teamRepo.findOne.mockResolvedValue({ ...resgate, isActive: false });

      await expect(service.assign(user as any, 't1', 'admin-1')).rejects.toThrow(new BadRequestException('Equipe não encontrada nesta organização.'));
    });

    it('não deixa o último membro sair da equipe Admin', async () => {
      volunteerRepo.findOne.mockResolvedValue({ id: 'v1', userId: 'u1', teamId: 't0', team: admin });
      volunteerRepo.count.mockResolvedValue(1);

      await expect(service.assign(user as any, 't1', 'admin-1')).rejects.toThrow(new BadRequestException('A equipe Admin precisa de ao menos um membro ativo.'));
      expect(volunteerRepo.update).not.toHaveBeenCalled();
    });

    it('com outro admin ativo, pode sair da equipe Admin', async () => {
      volunteerRepo.findOne.mockResolvedValue({ id: 'v1', userId: 'u1', teamId: 't0', team: admin });
      volunteerRepo.count.mockResolvedValue(2);

      await service.assign(user as any, 't1', 'admin-1');

      expect(volunteerRepo.count).toHaveBeenCalledWith({ where: { teamId: 't0', isActive: true, user: { isActive: true, isApproved: true } }, relations: { user: true } });
      expect(volunteerRepo.update).toHaveBeenCalledWith('v1', { teamId: 't1', isActive: true, updatedBy: 'admin-1' });
    });
  });

  describe('ensureNotLastAdmin', () => {
    it('bloqueia desativar o último admin', async () => {
      volunteerRepo.findOne.mockResolvedValue({ id: 'v1', userId: 'u1', team: admin });
      volunteerRepo.count.mockResolvedValue(1);

      await expect(service.ensureNotLastAdmin('u1')).rejects.toThrow(new BadRequestException('A equipe Admin precisa de ao menos um membro ativo.'));
    });

    it('libera quem não é da equipe Admin', async () => {
      volunteerRepo.findOne.mockResolvedValue({ id: 'v1', userId: 'u1', team: resgate });

      await expect(service.ensureNotLastAdmin('u1')).resolves.toBeUndefined();
      expect(volunteerRepo.count).not.toHaveBeenCalled();
    });
  });
});
