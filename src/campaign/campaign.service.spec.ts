import { NotFoundException } from '@nestjs/common';
import { CampaignService } from './campaign.service';
import { createMockRepository, MockRepository, pagination } from '../testing/mock-repository';

describe('CampaignService', () => {
  let repo: MockRepository;
  let service: CampaignService;

  beforeEach(() => {
    repo = createMockRepository();
    service = new CampaignService(repo as any);
  });

  it('create registra createdBy/updatedBy', async () => {
    // organizationId vindo do corpo é sobrescrito pela organização do usuário
    const result = await service.create({ name: 'Castração', fundraisingGoal: 1000, organizationId: 'org-B' } as any, 'org-1', 'user-1');

    expect(result).toEqual(expect.objectContaining({ name: 'Castração', organizationId: 'org-1', createdBy: 'user-1', updatedBy: 'user-1' }));
  });

  it('findAll filtra ativas pela organização quando informada', async () => {
    await service.findAll(pagination, 'org-1');
    await service.findAll(pagination);

    expect(repo.findAndCount).toHaveBeenNthCalledWith(1, expect.objectContaining({ where: { organizationId: 'org-1', isActive: true } }));
    expect(repo.findAndCount).toHaveBeenNthCalledWith(2, expect.objectContaining({ where: { isActive: true } }));
  });

  it('findOne lança NotFoundException quando não existe', async () => {
    repo.findOne.mockResolvedValue(null);

    await expect(service.findOne('x', 'org-1')).rejects.toThrow(NotFoundException);
    expect(repo.findOne).toHaveBeenCalledWith({ where: { id: 'x', organizationId: 'org-1' } });
  });

  it('update de campanha de outra organização responde 404 sem gravar', async () => {
    repo.findOne.mockResolvedValue(null);

    await expect(service.update('c1', { name: 'X' }, 'org-A', 'user-2')).rejects.toThrow(NotFoundException);
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('update grava updatedBy e devolve a campanha', async () => {
    repo.findOne.mockResolvedValue({ id: 'c1', name: 'Nova' });

    const result = await service.update('c1', { name: 'Nova' }, 'org-1', 'user-2');

    expect(repo.update).toHaveBeenCalledWith({ id: 'c1', organizationId: 'org-1' }, { name: 'Nova', updatedBy: 'user-2' });
    expect(result.name).toBe('Nova');
  });
});
