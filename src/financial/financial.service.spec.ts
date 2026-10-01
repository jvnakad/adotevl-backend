import { NotFoundException } from '@nestjs/common';
import { FindOperator } from 'typeorm';
import { FinancialService } from './financial.service';
import { createMockRepository, MockRepository, pagination } from '../testing/mock-repository';

describe('FinancialService', () => {
  let entryRepo: MockRepository;
  let expenseRepo: MockRepository;
  let service: FinancialService;

  beforeEach(() => {
    entryRepo = createMockRepository();
    expenseRepo = createMockRepository();
    service = new FinancialService(entryRepo as any, expenseRepo as any);
  });

  it('createEntry e createExpense registram auditoria', async () => {
    const entry = await service.createEntry({ sender: 'João', amount: 100 } as any, 'user-1');
    const expense = await service.createExpense({ recipient: 'Vet', reason: 'Consulta', amount: 50 } as any, 'user-1');

    expect(entry).toEqual(expect.objectContaining({ createdBy: 'user-1', updatedBy: 'user-1' }));
    expect(expense).toEqual(expect.objectContaining({ createdBy: 'user-1', updatedBy: 'user-1' }));
  });

  describe('updateEntry / updateExpense', () => {
    it('lançam NotFoundException quando o registro não existe', async () => {
      entryRepo.findOne.mockResolvedValue(null);
      expenseRepo.findOne.mockResolvedValue(null);

      await expect(service.updateEntry('x', { amount: 1 })).rejects.toThrow(NotFoundException);
      await expect(service.updateExpense('x', { amount: 1 })).rejects.toThrow(NotFoundException);
      expect(entryRepo.update).not.toHaveBeenCalled();
      expect(expenseRepo.update).not.toHaveBeenCalled();
    });

    it('gravam com updatedBy', async () => {
      entryRepo.findOne.mockResolvedValue({ id: 'e1' });
      expenseRepo.findOne.mockResolvedValue({ id: 's1' });

      await service.updateEntry('e1', { amount: 10 }, 'user-2');
      await service.updateExpense('s1', { amount: 20 }, 'user-2');

      expect(entryRepo.update).toHaveBeenCalledWith('e1', { amount: 10, updatedBy: 'user-2' });
      expect(expenseRepo.update).toHaveBeenCalledWith('s1', { amount: 20, updatedBy: 'user-2' });
    });
  });

  describe('findAllEntries', () => {
    it('filtra por campanha e período (Between) quando as duas datas vêm', async () => {
      await service.findAllEntries(pagination, { campaignId: 'c1', startDate: '2026-01-01', endDate: '2026-01-31' });

      const { where } = entryRepo.findAndCount.mock.calls[0][0];
      expect(where.campaignId).toBe('c1');
      expect(where.transactionDate).toBeInstanceOf(FindOperator);
      expect(where.transactionDate.type).toBe('between');
    });

    it('ignora período incompleto', async () => {
      await service.findAllEntries(pagination, { startDate: '2026-01-01' });

      expect(entryRepo.findAndCount.mock.calls[0][0].where).toEqual({});
    });
  });

  it('findAllExpenses pagina as despesas', async () => {
    await service.findAllExpenses(pagination);

    expect(expenseRepo.findAndCount).toHaveBeenCalledWith(expect.objectContaining({ skip: 0, take: 10 }));
  });

  it('getBalance soma entradas e saídas (decimais chegam como string)', async () => {
    entryRepo.find.mockResolvedValue([{ amount: '100.50' }, { amount: '49.50' }]);
    expenseRepo.find.mockResolvedValue([{ amount: '30.00' }]);

    expect(await service.getBalance()).toEqual({ totalEntries: 150, totalExpenses: 30, balance: 120 });
  });
});
