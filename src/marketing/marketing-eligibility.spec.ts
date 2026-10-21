import { MarketingEligibilityService } from './marketing-eligibility.service';

describe('MarketingEligibilityService', () => {
  const makeService = (rows: { id: string; name: string }[]) => {
    const query = jest.fn(async () => rows);
    return { service: new MarketingEligibilityService({ query } as any), query };
  };

  it('pede Editar em MARKETING (ou equipe Admin) dentro da organização e ordena A→Z sem acento', async () => {
    const { service, query } = makeService([
      { id: 'u2', name: 'Zélia' },
      { id: 'u1', name: 'Ágata' },
      { id: 'u3', name: 'Bruno' },
    ]);

    const result = await service.findEligible('org-1');

    expect(result.map((user) => user.name)).toEqual(['Ágata', 'Bruno', 'Zélia']);
    const [sql, params] = query.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toContain('t.is_admin = true OR p.id IS NOT NULL');
    expect(params).toEqual(['org-1', 'MARKETING', 'EDIT']);
  });

  it('filterEligible restringe aos ids informados', async () => {
    const { service, query } = makeService([{ id: 'u1', name: 'Ana' }]);

    await service.filterEligible('org-1', ['u1', 'u9']);

    const [sql, params] = query.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toContain('u.id = ANY($4::uuid[])');
    expect(params[3]).toEqual(['u1', 'u9']);
  });

  it('filterEligible sem ids não consulta o banco', async () => {
    const { service, query } = makeService([]);

    expect(await service.filterEligible('org-1', [])).toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });

  it('usa o manager da transação quando informado', async () => {
    const { service, query } = makeService([]);
    const manager = { query: jest.fn(async () => []) };

    await service.findEligible('org-1', manager as any);

    expect(manager.query).toHaveBeenCalledTimes(1);
    expect(query).not.toHaveBeenCalled();
  });
});
