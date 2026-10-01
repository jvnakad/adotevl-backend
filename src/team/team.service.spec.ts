import { ConflictException, NotFoundException } from '@nestjs/common';
import { TeamService } from './team.service';
import { createMockRepository, MockRepository, pagination } from '../testing/mock-repository';

describe('TeamService', () => {
  let repo: MockRepository;
  let service: TeamService;

  beforeEach(() => {
    repo = createMockRepository();
    service = new TeamService(repo as any);
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
    repo.findOne.mockResolvedValue({ id: 't1', name: 'Eventos' });

    await service.update('t1', { name: 'Eventos' }, 'user-2');

    expect(repo.update).toHaveBeenCalledWith('t1', { name: 'Eventos', updatedBy: 'user-2' });
  });
});
