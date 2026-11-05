import { ConflictException, NotFoundException } from '@nestjs/common';
import { ProductTypeService } from './product-type.service';
import { Product } from './product.entity';
import { ProductType } from './product-type.entity';
import { StockHistoryType } from './stock-history.entity';
import { createMockRepository, MockRepository } from '../testing/mock-repository';

const ORG = 'org-1';
const USER = 'user-1';

const baseType = (overrides: Partial<ProductType> = {}): ProductType =>
  ({ id: 't1', organizationId: ORG, name: 'Racao', nameNormalized: 'racao', isActive: true, createdBy: 'c', updatedBy: null, createdAt: new Date(), updatedAt: new Date(), ...overrides }) as ProductType;

describe('ProductTypeService', () => {
  let typeRepo: MockRepository;
  let history: { record: jest.Mock; resolveUserName: jest.Mock };
  let manager: { getRepository: jest.Mock; findOne: jest.Mock; count: jest.Mock };
  let service: ProductTypeService;
  let duplicate: boolean;
  let activeProducts: number;

  beforeEach(() => {
    typeRepo = createMockRepository();
    (typeRepo as any).manager = undefined;
    history = { record: jest.fn(), resolveUserName: jest.fn().mockResolvedValue('Maria Souza') };
    duplicate = false;
    activeProducts = 0;
    manager = {
      getRepository: jest.fn(() => typeRepo),
      findOne: jest.fn(async (entity: any) => (entity === ProductType && duplicate ? { id: 'other' } : null)),
      count: jest.fn(async (entity: any) => (entity === Product ? activeProducts : 0)),
    };
    (typeRepo as any).manager = manager;
    const dataSource = { transaction: (callback: (m: any) => any) => callback(manager) };
    service = new ProductTypeService(typeRepo as any, dataSource as any, history as any);
  });

  describe('findAll / findOptions', () => {
    // Query builder falso que registra a cadeia de chamadas
    const fakeQuery = (result: any) => {
      const calls: Record<string, any[]> = {};
      const qb: any = {};
      for (const method of ['where', 'andWhere', 'orderBy', 'addOrderBy', 'skip', 'take', 'select']) {
        qb[method] = jest.fn((...args) => ((calls[method] = [...(calls[method] ?? []), args]), qb));
      }
      qb.getManyAndCount = jest.fn(async () => result);
      qb.getMany = jest.fn(async () => result);
      (typeRepo as any).createQueryBuilder = jest.fn(() => qb);
      return { qb, calls };
    };

    it('lista só tipos ativos da organização em ordem A→Z por código de caractere (COLLATE "C") com id de desempate', async () => {
      const { qb, calls } = fakeQuery([[baseType()], 1]);

      const result = await service.findAll({ page: 2, limit: 10 }, ORG);

      expect(calls.where[0]).toEqual(['t.organizationId = :organizationId', { organizationId: ORG }]);
      expect(calls.andWhere[0]).toEqual(['t.isActive = true']);
      expect(calls.orderBy[0]).toEqual(['t.nameNormalized COLLATE "C"', 'ASC']);
      expect(calls.addOrderBy[0]).toEqual(['t.id', 'ASC']);
      expect(qb.skip).toHaveBeenCalledWith(10);
      expect(qb.take).toHaveBeenCalledWith(10);
      expect(result).toMatchObject({ total: 1, page: 2, limit: 10, totalPages: 1 });
      expect(result.data[0]).toEqual({ id: 't1', name: 'Racao', createdBy: 'c', updatedBy: null, createdAt: expect.any(Date), updatedAt: expect.any(Date) });
      expect(result.data[0]).not.toHaveProperty('organizationId');
      expect(result.data[0]).not.toHaveProperty('isActive');
    });

    it('opções: só id e nome, ativos, mesma ordem', async () => {
      const { calls } = fakeQuery([baseType(), baseType({ id: 't2', name: 'Medicamento' })]);

      expect(await service.findOptions(ORG)).toEqual([
        { id: 't1', name: 'Racao' },
        { id: 't2', name: 'Medicamento' },
      ]);
      expect(calls.orderBy[0]).toEqual(['t.nameNormalized COLLATE "C"', 'ASC']);
      expect(calls.addOrderBy[0]).toEqual(['t.id', 'ASC']);
      expect(calls.select[0]).toEqual([['t.id', 't.name']]);
    });
  });

  describe('usage', () => {
    it('conta produtos ativos vinculados ao tipo', async () => {
      typeRepo.findOne.mockResolvedValue(baseType());
      activeProducts = 3;

      expect(await service.usage('t1', ORG)).toEqual({ activeProductsCount: 3 });
      expect(manager.count).toHaveBeenCalledWith(Product, { where: { organizationId: ORG, productTypeId: 't1', isActive: true } });
    });

    it('tipo inexistente, excluído ou de outra organização é 404', async () => {
      typeRepo.findOne.mockResolvedValue(null);
      await expect(service.usage('t1', ORG)).rejects.toThrow(new NotFoundException('Tipo de produto não encontrado.'));
      expect(typeRepo.findOne).toHaveBeenCalledWith({ where: { id: 't1', organizationId: ORG, isActive: true } });
    });
  });

  describe('create', () => {
    it('grava com nome normalizado, created_by e o evento TIPO_CRIADO', async () => {
      typeRepo.save.mockImplementation(async (data) => ({ id: 't1', ...data }));

      const result = await service.create({ name: 'Ração' }, USER, ORG);

      expect(typeRepo.create).toHaveBeenCalledWith({ organizationId: ORG, name: 'Ração', nameNormalized: 'racao', createdBy: USER });
      expect(result).toMatchObject({ id: 't1', name: 'Ração', createdBy: USER, updatedBy: null });
      expect(history.record).toHaveBeenCalledWith(
        manager,
        expect.objectContaining({
          type: StockHistoryType.TIPO_CRIADO,
          productTypeId: 't1',
          subjectName: 'Ração',
          description: 'Tipo de produto Ração criado.',
          metadata: { name: 'Ração' },
          userId: USER,
          userName: 'Maria Souza',
        }),
      );
    });

    it('nome duplicado entre ativos (sem acento e maiúscula) é 409 e não grava', async () => {
      duplicate = true;
      await expect(service.create({ name: 'RAÇÃO' }, USER, ORG)).rejects.toThrow(new ConflictException('Já existe um tipo de produto com esse nome.'));
      expect(manager.findOne).toHaveBeenCalledWith(ProductType, expect.objectContaining({ where: { organizationId: ORG, nameNormalized: 'racao', isActive: true } }));
      expect(typeRepo.save).not.toHaveBeenCalled();
      expect(history.record).not.toHaveBeenCalled();
    });

    it('índice único violado por cadastro simultâneo vira 409', async () => {
      typeRepo.save.mockRejectedValue({ driverError: { code: '23505', constraint: 'UQ_product_types_org_name_active' } });
      await expect(service.create({ name: 'Ração' }, USER, ORG)).rejects.toThrow(new ConflictException('Já existe um tipo de produto com esse nome.'));
    });
  });

  describe('update (renomear)', () => {
    beforeEach(() => typeRepo.save.mockImplementation(async (data) => data));

    it('renomear só por acento conta: grava e gera TIPO_RENOMEADO com antes e depois', async () => {
      typeRepo.findOne.mockResolvedValue(baseType());

      const result = await service.update('t1', { name: 'Ração' }, USER, ORG);

      expect(result).toMatchObject({ name: 'Ração', updatedBy: USER });
      expect(typeRepo.save).toHaveBeenCalledWith(expect.objectContaining({ name: 'Ração', nameNormalized: 'racao', updatedBy: USER }));
      expect(history.record).toHaveBeenCalledWith(
        manager,
        expect.objectContaining({
          type: StockHistoryType.TIPO_RENOMEADO,
          subjectName: 'Ração',
          previousSubjectName: 'Racao',
          description: 'Tipo de produto renomeado: Racao → Ração.',
          metadata: { before: 'Racao', after: 'Ração' },
        }),
      );
      // O próprio tipo não conta como duplicado
      expect(manager.findOne).toHaveBeenCalledWith(ProductType, expect.objectContaining({ where: expect.objectContaining({ nameNormalized: 'racao', id: expect.anything() }) }));
    });

    it('mesmo nome (depois de normalizar espaços) não grava nem gera evento', async () => {
      typeRepo.findOne.mockResolvedValue(baseType({ name: 'Ração', nameNormalized: 'racao' }));

      const result = await service.update('t1', { name: 'Ração' }, USER, ORG);

      expect(result).toMatchObject({ name: 'Ração', updatedBy: null });
      expect(typeRepo.save).not.toHaveBeenCalled();
      expect(history.record).not.toHaveBeenCalled();
    });

    it('nome de outro tipo ativo é 409', async () => {
      typeRepo.findOne.mockResolvedValue(baseType({ name: 'Medicamento', nameNormalized: 'medicamento' }));
      duplicate = true;

      await expect(service.update('t1', { name: 'ração' }, USER, ORG)).rejects.toThrow(new ConflictException('Já existe um tipo de produto com esse nome.'));
      expect(typeRepo.save).not.toHaveBeenCalled();
    });

    it('tipo inexistente, excluído ou de outra organização é 404', async () => {
      typeRepo.findOne.mockResolvedValue(null);
      await expect(service.update('t1', { name: 'X' }, USER, ORG)).rejects.toThrow(NotFoundException);
      expect(typeRepo.findOne).toHaveBeenCalledWith({ where: { id: 't1', organizationId: ORG, isActive: true } });
    });
  });

  describe('remove', () => {
    it('exclusão lógica com produtos vinculados: grava a contagem no evento TIPO_REMOVIDO', async () => {
      typeRepo.findOne.mockResolvedValue(baseType());
      activeProducts = 3;

      await service.remove('t1', USER, ORG);

      expect(typeRepo.save).toHaveBeenCalledWith(expect.objectContaining({ isActive: false, updatedBy: USER }));
      expect(history.record).toHaveBeenCalledWith(
        manager,
        expect.objectContaining({
          type: StockHistoryType.TIPO_REMOVIDO,
          subjectName: 'Racao',
          description: 'Tipo de produto Racao removido.',
          metadata: { activeProductsCount: 3 },
        }),
      );
    });

    it('tipo inexistente ou já excluído é 404 e não gera evento', async () => {
      typeRepo.findOne.mockResolvedValue(null);
      await expect(service.remove('t1', USER, ORG)).rejects.toThrow(NotFoundException);
      expect(history.record).not.toHaveBeenCalled();
    });
  });
});
