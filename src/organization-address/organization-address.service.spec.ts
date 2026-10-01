import { OrganizationAddressService } from './organization-address.service';
import { createMockRepository, MockRepository } from '../testing/mock-repository';

describe('OrganizationAddressService', () => {
  let repo: MockRepository;
  let service: OrganizationAddressService;

  beforeEach(() => {
    repo = createMockRepository();
    service = new OrganizationAddressService(repo as any);
  });

  it('create salva o endereço', async () => {
    const dto = { name: 'Sede', zipCode: '01310100', street: 'Av', city: 'SP', neighborhood: 'Centro', state: 'SP', organizationId: 'org-1' };

    const result = await service.create(dto);

    expect(repo.create).toHaveBeenCalledWith(dto);
    expect(result).toEqual(dto);
  });

  it('findByOrganization filtra pela organização', async () => {
    repo.find.mockResolvedValue([{ id: 'a1' }]);

    expect(await service.findByOrganization('org-1')).toEqual([{ id: 'a1' }]);
    expect(repo.find).toHaveBeenCalledWith({ where: { organizationId: 'org-1' } });
  });

  it('findOne consulta pelo id', async () => {
    await service.findOne('a1');

    expect(repo.findOne).toHaveBeenCalledWith({ where: { id: 'a1' } });
  });

  it('update grava e devolve o endereço', async () => {
    repo.findOne.mockResolvedValue({ id: 'a1', name: 'Filial' });

    const result = await service.update('a1', { name: 'Filial' });

    expect(repo.update).toHaveBeenCalledWith('a1', { name: 'Filial' });
    expect(result.name).toBe('Filial');
  });

  it('remove faz soft delete', async () => {
    await service.remove('a1');

    expect(repo.update).toHaveBeenCalledWith('a1', { isActive: false });
  });
});
