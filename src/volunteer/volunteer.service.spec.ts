import { ConflictException, NotFoundException } from '@nestjs/common';
import { VolunteerService } from './volunteer.service';
import { createMockRepository, MockRepository, pagination } from '../testing/mock-repository';

describe('VolunteerService', () => {
  let repo: MockRepository;
  let service: VolunteerService;

  beforeEach(() => {
    repo = createMockRepository();
    service = new VolunteerService(repo as any);
  });

  describe('create', () => {
    const dto = { name: 'Vera', cpf: '12345678901', userId: 'u1' };

    it('cria voluntário para usuário ainda não vinculado', async () => {
      repo.findOne.mockResolvedValue(null);

      const result = await service.create(dto, 'admin-1');

      expect(repo.findOne).toHaveBeenCalledWith({ where: { userId: 'u1' } });
      expect(result).toEqual(expect.objectContaining({ ...dto, createdBy: 'admin-1' }));
    });

    it('lança ConflictException quando o usuário já é voluntário', async () => {
      repo.findOne.mockResolvedValue({ id: 'v1' });

      await expect(service.create(dto)).rejects.toThrow(ConflictException);
    });
  });

  it('findAll aplica filtro de equipe só quando informado', async () => {
    await service.findAll(pagination, { teamId: 't1' });
    await service.findAll(pagination);

    expect(repo.findAndCount).toHaveBeenNthCalledWith(1, expect.objectContaining({ where: { isActive: true, teamId: 't1' } }));
    expect(repo.findAndCount).toHaveBeenNthCalledWith(2, expect.objectContaining({ where: { isActive: true } }));
  });

  it('findOne lança NotFoundException quando não existe', async () => {
    repo.findOne.mockResolvedValue(null);

    await expect(service.findOne('x')).rejects.toThrow(NotFoundException);
  });

  it('update grava updatedBy e devolve o voluntário', async () => {
    repo.findOne.mockResolvedValue({ id: 'v1', teamId: 't2' });

    const result = await service.update('v1', { teamId: 't2' }, 'admin-1');

    expect(repo.update).toHaveBeenCalledWith('v1', { teamId: 't2', updatedBy: 'admin-1' });
    expect(result.teamId).toBe('t2');
  });
});
