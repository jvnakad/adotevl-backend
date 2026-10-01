import { ConflictException } from '@nestjs/common';
import { OrganizationService } from './organization.service';
import { createMockRepository, MockRepository, pagination } from '../testing/mock-repository';

describe('OrganizationService', () => {
  let repo: MockRepository;
  let service: OrganizationService;

  beforeEach(() => {
    repo = createMockRepository();
    service = new OrganizationService(repo as any);
  });

  describe('create', () => {
    it('cria organização ativa com auditoria', async () => {
      repo.findOne.mockResolvedValue(null);

      const result = await service.create({ legalName: 'ONG', cnpj: '12345678000190' } as any, 'user-1');

      expect(repo.findOne).toHaveBeenCalledWith({ where: { cnpj: '12345678000190' } });
      expect(result).toEqual(expect.objectContaining({ isActive: true, createdBy: 'user-1', updatedBy: 'user-1' }));
      expect(repo.save).toHaveBeenCalled();
    });

    it('lança ConflictException com CNPJ já cadastrado', async () => {
      repo.findOne.mockResolvedValue({ id: 'org-1' });

      await expect(service.create({ legalName: 'ONG', cnpj: '123' } as any)).rejects.toThrow(ConflictException);
      expect(repo.save).not.toHaveBeenCalled();
    });
  });

  it('findAll pagina sem filtro', async () => {
    repo.findAndCount.mockResolvedValue([[{ id: 'org-1' }], 1]);

    const result = await service.findAll(pagination);

    expect(result.total).toBe(1);
    expect(repo.findAndCount).toHaveBeenCalledWith(expect.objectContaining({ where: undefined }));
  });

  it('findOne e findByCnpj consultam pelo campo certo', async () => {
    await service.findOne('org-1');
    await service.findByCnpj('123');

    expect(repo.findOne).toHaveBeenNthCalledWith(1, { where: { id: 'org-1' } });
    expect(repo.findOne).toHaveBeenNthCalledWith(2, { where: { cnpj: '123' } });
  });

  it('update grava e devolve a organização atualizada', async () => {
    repo.findOne.mockResolvedValue({ id: 'org-1', legalName: 'Nova' });

    const result = await service.update('org-1', { legalName: 'Nova' });

    expect(repo.update).toHaveBeenCalledWith('org-1', { legalName: 'Nova' });
    expect(result.legalName).toBe('Nova');
  });
});
