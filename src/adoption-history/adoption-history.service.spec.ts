import { FindOperator } from 'typeorm';
import { AdoptionHistoryService, PUBLIC_FORM_USER_NAME } from './adoption-history.service';
import { AdoptionHistoryType } from './adoption-history.entity';
import { createMockRepository, MockRepository } from '../testing/mock-repository';

const form = { id: 'form-1', organizationId: 'org-1', fullName: 'Maria' };

describe('AdoptionHistoryService', () => {
  let historyRepo: MockRepository;
  let userRepo: MockRepository;
  let service: AdoptionHistoryService;

  beforeEach(() => {
    historyRepo = createMockRepository();
    userRepo = createMockRepository();
    service = new AdoptionHistoryService(historyRepo as any, userRepo as any);
  });

  describe('record', () => {
    it('grava o snapshot do adotante e o nome do usuário', async () => {
      userRepo.findOne.mockResolvedValue({ id: 'user-1', fullName: 'Ana Admin' });

      const event = await service.record({ form, type: AdoptionHistoryType.FICHA_EDITADA, description: 'Ficha editada', userId: 'user-1', metadata: { a: 1 } });

      expect(historyRepo.save).toHaveBeenCalledWith([
        expect.objectContaining({
          adoptionFormId: 'form-1',
          organizationId: 'org-1',
          adopterName: 'Maria',
          type: 'FICHA_EDITADA',
          userId: 'user-1',
          userName: 'Ana Admin',
          createdBy: 'user-1',
          fromStatus: null,
          toStatus: null,
          metadata: { a: 1 },
        }),
      ]);
      expect(event).toEqual(expect.objectContaining({ userName: 'Ana Admin', adopterName: 'Maria' }));
      expect(event).not.toHaveProperty('organizationId');
    });

    it('sem usuário grava "Formulário público" sem consultar o banco', async () => {
      await service.record({ form, type: AdoptionHistoryType.FICHA_CRIADA, description: 'Ficha enviada' });

      expect(userRepo.findOne).not.toHaveBeenCalled();
      expect(historyRepo.save.mock.calls[0][0][0]).toEqual(expect.objectContaining({ userId: null, userName: PUBLIC_FORM_USER_NAME }));
    });

    it('usa o repositório da transação quando recebe o EntityManager', async () => {
      const txRepo = createMockRepository();
      const manager = { getRepository: jest.fn(() => txRepo) };

      await service.record({ form, type: AdoptionHistoryType.FICHA_CRIADA, description: 'x' }, manager as any);

      expect(txRepo.save).toHaveBeenCalled();
      expect(historyRepo.save).not.toHaveBeenCalled();
    });
  });

  it('recordMany busca o usuário uma vez só', async () => {
    userRepo.findOne.mockResolvedValue({ id: 'user-1', fullName: 'Ana' });

    await service.recordMany([
      { form, type: AdoptionHistoryType.CLAUSULA_REMOVIDA, description: 'a', userId: 'user-1' },
      { form, type: AdoptionHistoryType.CLAUSULA_EDITADA, description: 'b', userId: 'user-1' },
    ]);

    expect(userRepo.findOne).toHaveBeenCalledTimes(1);
    expect(historyRepo.save.mock.calls[0][0]).toHaveLength(2);
  });

  it('resolveUserName trata usuário removido', async () => {
    userRepo.findOne.mockResolvedValue(null);

    expect(await service.resolveUserName('user-x')).toBe('Usuário removido');
  });

  it('findByForm lista os eventos da ficha, mais recentes primeiro', async () => {
    historyRepo.find.mockResolvedValue([{ id: 'e1', type: 'FICHA_CRIADA', isActive: true, createdBy: null }]);

    const events = await service.findByForm('form-1', 'org-1');

    expect(historyRepo.find).toHaveBeenCalledWith({ where: { adoptionFormId: 'form-1', organizationId: 'org-1', isActive: true }, order: { createdAt: 'DESC' } });
    expect(events[0]).not.toHaveProperty('isActive');
  });

  describe('findAll', () => {
    it('pagina por organização com createdAt DESC', async () => {
      const result = await service.findAll({ page: 2, limit: 5 }, 'org-1');

      expect(historyRepo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ where: { organizationId: 'org-1', isActive: true }, order: { createdAt: 'DESC' }, skip: 5, take: 5 }),
      );
      expect(result).toEqual({ data: [], total: 0, page: 2, limit: 5, totalPages: 0 });
    });

    it('aplica filtros de tipo, ficha, nome e período (dia local inclusivo)', async () => {
      await service.findAll(
        { type: AdoptionHistoryType.STATUS_ALTERADO, adoptionFormId: 'form-1', search: ' mar ', from: '2026-10-01', to: '2026-10-02' },
        'org-1',
      );

      const where = historyRepo.findAndCount.mock.calls[0][0].where;
      expect(where).toEqual(expect.objectContaining({ type: 'STATUS_ALTERADO', adoptionFormId: 'form-1' }));
      expect(where.adopterName.value).toBe('%mar%');
      expect(where.createdAt).toBeInstanceOf(FindOperator);
      const [from, to] = where.createdAt.value.map((operator) => operator.value);
      expect(from.toISOString()).toBe('2026-10-01T03:00:00.000Z');
      expect(to.toISOString()).toBe('2026-10-03T03:00:00.000Z');
    });

    it('só data inicial', async () => {
      await service.findAll({ from: '2026-10-01' }, 'org-1');

      const where = historyRepo.findAndCount.mock.calls[0][0].where;
      expect(where.createdAt.type).toBe('moreThanOrEqual');
    });
  });
});
