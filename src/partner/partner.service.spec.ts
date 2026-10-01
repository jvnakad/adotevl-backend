import { ConflictException } from '@nestjs/common';
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
      const result = await service.create({ name: 'Pet Shop' } as any);

      expect(repo.findOne).not.toHaveBeenCalled();
      expect(result.name).toBe('Pet Shop');
    });

    it('lança ConflictException com documento repetido', async () => {
      repo.findOne.mockResolvedValueOnce({ id: 'p1' });

      await expect(service.create({ name: 'X', document: '123' } as any)).rejects.toThrow('CPF/CNPJ');
    });

    it('lança ConflictException com email repetido', async () => {
      repo.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'p1' });

      await expect(service.create({ name: 'X', document: '123', email: 'a@a.com' } as any)).rejects.toThrow(ConflictException);
      expect(repo.findOne).toHaveBeenLastCalledWith({ where: { email: 'a@a.com' } });
    });
  });

  it('findAll pagina todos os parceiros', async () => {
    await service.findAll(pagination);

    expect(repo.findAndCount).toHaveBeenCalledWith(expect.objectContaining({ where: undefined, skip: 0, take: 10 }));
  });

  it('findOne consulta pelo id', async () => {
    await service.findOne('p1');

    expect(repo.findOne).toHaveBeenCalledWith({ where: { id: 'p1' } });
  });

  it('update grava e devolve o parceiro', async () => {
    repo.findOne.mockResolvedValue({ id: 'p1', name: 'Novo' });

    expect((await service.update('p1', { name: 'Novo' })).name).toBe('Novo');
    expect(repo.update).toHaveBeenCalledWith('p1', { name: 'Novo' });
  });

  it('remove faz soft delete', async () => {
    await service.remove('p1');

    expect(repo.update).toHaveBeenCalledWith('p1', { isActive: false });
  });
});
