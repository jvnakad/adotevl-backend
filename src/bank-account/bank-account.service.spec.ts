import { BankAccountService } from './bank-account.service';
import { createMockRepository, MockRepository, pagination } from '../testing/mock-repository';

describe('BankAccountService', () => {
  let repo: MockRepository;
  let service: BankAccountService;

  beforeEach(() => {
    repo = createMockRepository();
    service = new BankAccountService(repo as any);
  });

  it('create salva a conta', async () => {
    const dto = { bankName: 'BB', accountNumber: '123', ownerName: 'ONG', organizationId: 'org-1' } as any;

    expect(await service.create(dto)).toEqual(dto);
    expect(repo.save).toHaveBeenCalledWith(dto);
  });

  it('findAll filtra pela organização só quando informada', async () => {
    await service.findAll(pagination, 'org-1');
    await service.findAll(pagination);

    expect(repo.findAndCount).toHaveBeenNthCalledWith(1, expect.objectContaining({ where: { organizationId: 'org-1' } }));
    expect(repo.findAndCount).toHaveBeenNthCalledWith(2, expect.objectContaining({ where: undefined }));
  });

  it('findOne consulta pelo id', async () => {
    await service.findOne('b1');

    expect(repo.findOne).toHaveBeenCalledWith({ where: { id: 'b1' } });
  });

  it('update grava e devolve a conta', async () => {
    repo.findOne.mockResolvedValue({ id: 'b1', bankName: 'Nubank' });

    const result = await service.update('b1', { bankName: 'Nubank' });

    expect(repo.update).toHaveBeenCalledWith('b1', { bankName: 'Nubank' });
    expect(result.bankName).toBe('Nubank');
  });

  it('remove faz soft delete', async () => {
    await service.remove('b1');

    expect(repo.update).toHaveBeenCalledWith('b1', { isActive: false });
  });
});
