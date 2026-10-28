import { ConflictException, NotFoundException } from '@nestjs/common';
import { PartnerService } from './partner.service';
import { createMockRepository, MockRepository, pagination } from '../testing/mock-repository';

describe('PartnerService', () => {
  let repo: MockRepository;
  let service: PartnerService;

  beforeEach(() => {
    repo = createMockRepository();
    service = new PartnerService(repo as any);
  });

  describe('create', () => {
    it('cria parceiro sem documento nem email sem consultar duplicidade', async () => {
      const result = await service.create({ name: 'Pet Shop' } as any, 'org-1');

      expect(repo.findOne).not.toHaveBeenCalled();
      expect(result).toEqual(expect.objectContaining({ name: 'Pet Shop', organizationId: 'org-1' }));
    });

    it('lança ConflictException com documento repetido', async () => {
      repo.findOne.mockResolvedValueOnce({ id: 'p1' });

      await expect(service.create({ name: 'X', document: '123' } as any, 'org-1')).rejects.toThrow('CPF/CNPJ');
    });

    it('lança ConflictException com email repetido', async () => {
      repo.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'p1' });

      await expect(service.create({ name: 'X', document: '123', email: 'a@a.com' } as any, 'org-1')).rejects.toThrow(ConflictException);
      expect(repo.findOne).toHaveBeenLastCalledWith({ where: { email: 'a@a.com', organizationId: 'org-1' } });
    });
  });

  it('findAll pagina só os parceiros da organização', async () => {
    await service.findAll(pagination, 'org-1');

    expect(repo.findAndCount).toHaveBeenCalledWith(expect.objectContaining({ where: { organizationId: 'org-1' }, skip: 0, take: 10 }));
  });

  it('findOne consulta pelo id dentro da organização', async () => {
    repo.findOne.mockResolvedValue({ id: 'p1' });
    await service.findOne('p1', 'org-1');

    expect(repo.findOne).toHaveBeenCalledWith({ where: { id: 'p1', organizationId: 'org-1' } });
  });

  it('findOne/update/remove de parceiro de outra organização respondem 404 sem gravar', async () => {
    repo.findOne.mockResolvedValue(null);

    await expect(service.findOne('p1', 'org-A')).rejects.toThrow(NotFoundException);
    await expect(service.update('p1', { name: 'X' }, 'org-A')).rejects.toThrow(NotFoundException);
    await expect(service.remove('p1', 'org-A')).rejects.toThrow(NotFoundException);
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('update grava e devolve o parceiro', async () => {
    repo.findOne.mockResolvedValue({ id: 'p1', name: 'Novo' });

    expect((await service.update('p1', { name: 'Novo' }, 'org-1')).name).toBe('Novo');
    expect(repo.update).toHaveBeenCalledWith({ id: 'p1', organizationId: 'org-1' }, { name: 'Novo' });
  });

  it('remove faz soft delete', async () => {
    repo.findOne.mockResolvedValue({ id: 'p1' });
    await service.remove('p1', 'org-1');

    expect(repo.update).toHaveBeenCalledWith({ id: 'p1', organizationId: 'org-1' }, { isActive: false });
  });
});
