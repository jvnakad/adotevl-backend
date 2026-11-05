import { NotFoundException } from '@nestjs/common';
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
    const dto = { bankName: 'BB', accountNumber: '123', ownerName: 'ONG' } as any;
    // organizationId vindo do corpo é sobrescrito pela organização do usuário
    const result = await service.create({ ...dto, organizationId: 'org-B' }, 'org-1');

    expect(result).toEqual({ ...dto, organizationId: 'org-1' });
    expect(repo.save).toHaveBeenCalledWith({ ...dto, organizationId: 'org-1' });
  });

  it('findAll filtra pela organização só quando informada', async () => {
    await service.findAll(pagination, 'org-1');
    await service.findAll(pagination);

    expect(repo.findAndCount).toHaveBeenNthCalledWith(1, expect.objectContaining({ where: { organizationId: 'org-1' } }));
    expect(repo.findAndCount).toHaveBeenNthCalledWith(2, expect.objectContaining({ where: undefined }));
  });

  it('findOne consulta pelo id dentro da organização', async () => {
    repo.findOne.mockResolvedValue({ id: 'b1' });
    await service.findOne('b1', 'org-1');

    expect(repo.findOne).toHaveBeenCalledWith({ where: { id: 'b1', organizationId: 'org-1' } });
  });

  it('findOne/update/remove de conta de outra organização respondem 404 sem gravar', async () => {
    repo.findOne.mockResolvedValue(null);

    await expect(service.findOne('b1', 'org-A')).rejects.toThrow(NotFoundException);
    await expect(service.update('b1', { bankName: 'X' }, 'org-A')).rejects.toThrow(NotFoundException);
    await expect(service.remove('b1', 'org-A')).rejects.toThrow(NotFoundException);
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('update grava e devolve a conta', async () => {
    repo.findOne.mockResolvedValue({ id: 'b1', bankName: 'Nubank' });

    const result = await service.update('b1', { bankName: 'Nubank' }, 'org-1');

    expect(repo.update).toHaveBeenCalledWith({ id: 'b1', organizationId: 'org-1' }, { bankName: 'Nubank' });
    expect(result.bankName).toBe('Nubank');
  });

  it('remove faz soft delete', async () => {
    repo.findOne.mockResolvedValue({ id: 'b1' });
    await service.remove('b1', 'org-1');

    expect(repo.update).toHaveBeenCalledWith({ id: 'b1', organizationId: 'org-1' }, { isActive: false });
  });
});
