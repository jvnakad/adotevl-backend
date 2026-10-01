import { paginate } from './paginate.helper';
import { createMockRepository } from '../testing/mock-repository';

describe('paginate', () => {
  it('calcula skip/take a partir da página e devolve metadados', async () => {
    const repo = createMockRepository();
    repo.findAndCount.mockResolvedValue([[{ id: 1 }, { id: 2 }], 25]);

    const result = await paginate(repo as any, { page: 3, limit: 10 });

    expect(repo.findAndCount).toHaveBeenCalledWith({ where: undefined, relations: undefined, order: undefined, skip: 20, take: 10 });
    expect(result).toEqual({ data: [{ id: 1 }, { id: 2 }], total: 25, page: 3, limit: 10, totalPages: 3 });
  });

  it('usa página 1 e limite 10 por padrão', async () => {
    const repo = createMockRepository();

    const result = await paginate(repo as any, {});

    expect(repo.findAndCount).toHaveBeenCalledWith(expect.objectContaining({ skip: 0, take: 10 }));
    expect(result.totalPages).toBe(0);
  });

  it('repassa where, relations e order para o repositório', async () => {
    const repo = createMockRepository();
    const where = [{ name: 'a' }, { name: 'b' }];

    await paginate(repo as any, { page: 1, limit: 5 }, where, { fotos: true } as any, { createdAt: 'DESC' } as any);

    expect(repo.findAndCount).toHaveBeenCalledWith({ where, relations: { fotos: true }, order: { createdAt: 'DESC' }, skip: 0, take: 5 });
  });
});
