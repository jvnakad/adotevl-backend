import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { ProductService } from './product.service';
import { Product, ProductUnit } from './product.entity';
import { ProductType } from './product-type.entity';
import { StockHistoryType } from './stock-history.entity';
import { createMockRepository, MockRepository } from '../testing/mock-repository';

const ORG = 'org-1';
const USER = 'user-1';
const TYPE_RACAO = { id: 'type-racao', name: 'Ração', isActive: true, organizationId: ORG };
const TYPE_MED = { id: 'type-med', name: 'Medicamento', isActive: true, organizationId: ORG };
const TYPE_OLD = { id: 'type-old', name: 'Antigo', isActive: false, organizationId: ORG };

const baseProduct = (overrides: Partial<Product> = {}): Product =>
  ({
    id: 'p1',
    organizationId: ORG,
    name: 'Ração Premium',
    nameNormalized: 'racao premium',
    productTypeId: TYPE_RACAO.id,
    productType: TYPE_RACAO,
    unit: ProductUnit.UNIT,
    quantity: '10.000',
    expirationDate: null,
    notes: null,
    isActive: true,
    createdBy: 'creator',
    createdByName: 'Maria',
    updatedBy: null,
    updatedByName: null,
    createdAt: new Date('2026-10-10T12:00:00Z'),
    updatedAt: new Date('2026-10-10T12:00:00Z'),
    ...overrides,
  }) as Product;

describe('ProductService', () => {
  let productRepo: MockRepository;
  let history: { record: jest.Mock; resolveUserName: jest.Mock };
  let manager: { getRepository: jest.Mock; findOne: jest.Mock };
  let service: ProductService;
  let types: Record<string, any>;
  let duplicate: boolean;

  beforeEach(() => {
    productRepo = createMockRepository();
    history = { record: jest.fn(), resolveUserName: jest.fn().mockResolvedValue('Maria Souza') };
    types = { [TYPE_RACAO.id]: TYPE_RACAO, [TYPE_MED.id]: TYPE_MED, [TYPE_OLD.id]: TYPE_OLD };
    duplicate = false;
    manager = {
      getRepository: jest.fn(() => productRepo),
      findOne: jest.fn(async (entity: any, options: any) => {
        if (entity === ProductType) return options.where.organizationId === ORG ? (types[options.where.id] ?? null) : null;
        if (entity === Product) return duplicate ? { id: 'other' } : null; // checagem de nome duplicado
        return null;
      }),
    };
    const dataSource = { transaction: (callback: (m: any) => any) => callback(manager) };
    service = new ProductService(productRepo as any, dataSource as any, history as any);
  });

  const create = (overrides: object = {}) =>
    service.create(
      { name: 'Ração Premium', productTypeId: TYPE_RACAO.id, unit: ProductUnit.KG, quantity: '10', expirationDate: '2026-12-31', notes: null, ...overrides } as any,
      USER,
      ORG,
    );

  describe('create', () => {
    it('grava o produto com snapshot do criador e o evento PRODUTO_CRIADO na mesma transação', async () => {
      productRepo.save.mockImplementation(async (data) => ({ id: 'p1', createdAt: new Date(), updatedAt: new Date(), ...data }));

      const product = await create();

      expect(productRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: ORG, name: 'Ração Premium', nameNormalized: 'racao premium', quantity: '10.000', createdBy: USER, createdByName: 'Maria Souza' }),
      );
      expect(product).toMatchObject({ quantity: '10.000', unit: 'KG', productType: { id: 'type-racao', name: 'Ração', isActive: true }, updatedBy: null, isExpired: false });
      expect(history.record).toHaveBeenCalledWith(
        manager,
        expect.objectContaining({
          type: StockHistoryType.PRODUTO_CRIADO,
          productId: 'p1',
          subjectName: 'Ração Premium',
          description: 'Produto Ração Premium criado com 10,000 kg.',
          userName: 'Maria Souza',
          metadata: { values: expect.objectContaining({ productTypeName: 'Ração', quantity: '10.000', unit: 'KG', expirationDate: '2026-12-31' }) },
        }),
      );
    });

    it('descrição usa o formato da unidade', async () => {
      productRepo.save.mockImplementation(async (data) => ({ id: 'p1', ...data }));

      await create({ unit: ProductUnit.UNIT, quantity: 1250 });

      expect(history.record.mock.calls[0][1].description).toBe('Produto Ração Premium criado com 1250 un.');
    });

    it('recusa quantidade inválida para a unidade sem gravar', async () => {
      await expect(create({ unit: ProductUnit.UNIT, quantity: '2.5' })).rejects.toThrow(new BadRequestException('Quantidade em unidade deve ser um número inteiro.'));
      await expect(create({ quantity: '1.2345' })).rejects.toThrow(BadRequestException);
      expect(productRepo.save).not.toHaveBeenCalled();
      expect(history.record).not.toHaveBeenCalled();
    });

    it('tipo excluído é 400; tipo de outra organização ou inexistente também', async () => {
      await expect(create({ productTypeId: TYPE_OLD.id })).rejects.toThrow(new BadRequestException('Este tipo de produto foi excluído. Escolha outro.'));
      await expect(create({ productTypeId: 'inexistente' })).rejects.toThrow(new BadRequestException('Tipo de produto não encontrado.'));
      expect(productRepo.save).not.toHaveBeenCalled();
    });

    it('nome duplicado entre ativos é 409', async () => {
      duplicate = true;
      await expect(create()).rejects.toThrow(new ConflictException('Já existe um produto com esse nome.'));
      expect(productRepo.save).not.toHaveBeenCalled();
    });

    it('violação do índice único (cadastro simultâneo) também vira 409', async () => {
      productRepo.save.mockRejectedValue({ driverError: { code: '23505', constraint: 'UQ_products_org_name_active' } });
      await expect(create()).rejects.toThrow(new ConflictException('Já existe um produto com esse nome.'));
    });

    it('outros erros do banco são propagados', async () => {
      productRepo.save.mockRejectedValue(new Error('falha'));
      await expect(create()).rejects.toThrow('falha');
    });

    it('se o evento não puder ser gravado, o erro sobe (a transação desfaz o produto)', async () => {
      productRepo.save.mockImplementation(async (data) => ({ id: 'p1', ...data }));
      history.record.mockRejectedValue(new Error('evento'));
      await expect(create()).rejects.toThrow('evento');
    });
  });

  describe('update', () => {
    const update = (dto: object, product = baseProduct()) => {
      productRepo.findOne.mockResolvedValue(product);
      productRepo.save.mockImplementation(async (data) => data);
      return service.update('p1', dto as any, USER, ORG);
    };

    it('produto inexistente, excluído ou de outra organização é 404', async () => {
      productRepo.findOne.mockResolvedValue(null);
      await expect(service.update('p1', { quantity: '1' } as any, USER, ORG)).rejects.toThrow(new NotFoundException('Produto não encontrado.'));
      expect(productRepo.findOne).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'p1', organizationId: ORG, isActive: true } }));
    });

    it('sem mudança real não grava, não gera evento e devolve o produto como está', async () => {
      const result = await update({ name: 'Ração Premium', quantity: '10', unit: ProductUnit.UNIT, productTypeId: TYPE_RACAO.id, notes: null, expirationDate: null });

      expect(productRepo.save).not.toHaveBeenCalled();
      expect(history.record).not.toHaveBeenCalled();
      expect(result).toMatchObject({ id: 'p1', quantity: '10.000', updatedBy: null });
    });

    it('corpo vazio também não muda nada', async () => {
      await update({});
      expect(productRepo.save).not.toHaveBeenCalled();
      expect(history.record).not.toHaveBeenCalled();
    });

    it('edita só a quantidade: um item no de/para, descrição sem valores e updatedBy preenchido', async () => {
      const result = await update({ quantity: 8 });

      expect(result).toMatchObject({ quantity: '8.000', updatedBy: USER, updatedByName: 'Maria Souza' });
      const event = history.record.mock.calls[0][1];
      expect(event).toMatchObject({ type: StockHistoryType.PRODUTO_EDITADO, subjectName: 'Ração Premium', previousSubjectName: null, description: 'Produto Ração Premium editado.' });
      expect(event.metadata.fields).toEqual([{ field: 'quantity', label: 'Quantidade', before: '10.000', after: '8.000', beforeUnit: 'UNIT', afterUnit: 'UNIT' }]);
    });

    it('trocar a unidade sem quantidade grava 0 e gera dois itens (unidade e quantidade)', async () => {
      const result = await update({ unit: ProductUnit.KG });

      expect(result).toMatchObject({ unit: 'KG', quantity: '0.000' });
      expect(history.record.mock.calls[0][1].metadata.fields).toEqual([
        { field: 'unit', label: 'Unidade de medida', before: 'UNIT', after: 'KG' },
        { field: 'quantity', label: 'Quantidade', before: '10.000', after: '0.000', beforeUnit: 'UNIT', afterUnit: 'KG' },
      ]);
    });

    it('trocar a unidade com quantidade grava a quantidade enviada, validada para a nova unidade', async () => {
      expect(await update({ unit: ProductUnit.KG, quantity: '2.5' })).toMatchObject({ unit: 'KG', quantity: '2.500' });
    });

    it('quantidade decimal em produto UNIT é 400 mesmo sem enviar a unidade', async () => {
      await expect(update({ quantity: '2.5' })).rejects.toThrow(new BadRequestException('Quantidade em unidade deve ser um número inteiro.'));
      expect(productRepo.save).not.toHaveBeenCalled();
    });

    it('trocar para UNIT com quantidade decimal enviada é 400', async () => {
      await expect(update({ unit: ProductUnit.UNIT, quantity: '1.5' }, baseProduct({ unit: ProductUnit.KG }))).rejects.toThrow(BadRequestException);
    });

    it('renomear grava o nome anterior no evento e confere duplicidade', async () => {
      await update({ name: 'Ração Super' });
      expect(history.record.mock.calls[0][1]).toMatchObject({ subjectName: 'Ração Super', previousSubjectName: 'Ração Premium' });
      expect(manager.findOne).toHaveBeenCalledWith(Product, expect.objectContaining({ where: expect.objectContaining({ nameNormalized: 'racao super', isActive: true }) }));
    });

    it('renomear para nome de outro produto ativo é 409', async () => {
      duplicate = true;
      await expect(update({ name: 'Outro' })).rejects.toThrow(new ConflictException('Já existe um produto com esse nome.'));
      expect(productRepo.save).not.toHaveBeenCalled();
    });

    it('mudar só maiúscula ou acento conta como renomear', async () => {
      await update({ name: 'RAÇÃO PREMIUM' });
      expect(history.record.mock.calls[0][1].metadata.fields[0]).toMatchObject({ field: 'name', before: 'Ração Premium', after: 'RAÇÃO PREMIUM' });
    });

    it('trocar o tipo registra o nome dos dois lados; tipo excluído como destino é 400', async () => {
      await update({ productTypeId: TYPE_MED.id });
      expect(history.record.mock.calls[0][1].metadata.fields).toEqual([
        { field: 'productTypeId', label: 'Tipo de produto', before: 'type-racao', after: 'type-med', beforeName: 'Ração', afterName: 'Medicamento' },
      ]);

      await expect(update({ productTypeId: TYPE_OLD.id })).rejects.toThrow(new BadRequestException('Este tipo de produto foi excluído. Escolha outro.'));
    });

    it('produto com tipo excluído pode ser editado em outros campos mantendo o tipo (enviado ou não)', async () => {
      const product = () => baseProduct({ productTypeId: TYPE_OLD.id, productType: TYPE_OLD as any });

      expect(await update({ quantity: '4' }, product())).toMatchObject({ quantity: '4.000', productType: { id: 'type-old', name: 'Antigo', isActive: false } });
      expect(await update({ quantity: '5', productTypeId: TYPE_OLD.id }, product())).toMatchObject({ quantity: '5.000' });
    });

    it('vencimento e observações podem ser limpos com null', async () => {
      await update({ expirationDate: null, notes: null }, baseProduct({ expirationDate: '2026-12-31', notes: 'texto antigo' }));
      expect(history.record.mock.calls[0][1].metadata.fields).toEqual([
        { field: 'expirationDate', label: 'Data de vencimento', before: '2026-12-31', after: null },
        { field: 'notes', label: 'Observações', before: 'texto antigo', after: null },
      ]);
    });

    it('os itens do de/para seguem a ordem dos campos do formulário', async () => {
      await update({ notes: 'n', quantity: '1', name: 'Zeta', expirationDate: '2027-01-01' });
      expect(history.record.mock.calls[0][1].metadata.fields.map((f: any) => f.field)).toEqual(['name', 'quantity', 'expirationDate', 'notes']);
    });

    it('nome, tipo ou unidade null são recusados', async () => {
      await expect(service.update('p1', { name: null } as any, USER, ORG)).rejects.toThrow(new BadRequestException('Informe o nome do produto.'));
      await expect(service.update('p1', { productTypeId: null } as any, USER, ORG)).rejects.toThrow(new BadRequestException('Escolha o tipo de produto.'));
      await expect(service.update('p1', { unit: null } as any, USER, ORG)).rejects.toThrow(new BadRequestException('Escolha a unidade de medida.'));
    });
  });

  describe('remove', () => {
    it('exclusão lógica preenchendo updatedBy e gerando PRODUTO_REMOVIDO', async () => {
      const product = baseProduct();
      productRepo.findOne.mockResolvedValue(product);

      await service.remove('p1', USER, ORG);

      expect(productRepo.save).toHaveBeenCalledWith(expect.objectContaining({ isActive: false, updatedBy: USER, updatedByName: 'Maria Souza' }));
      expect(history.record).toHaveBeenCalledWith(
        manager,
        expect.objectContaining({ type: StockHistoryType.PRODUTO_REMOVIDO, subjectName: 'Ração Premium', description: 'Produto Ração Premium removido.', metadata: null }),
      );
    });

    it('produto inexistente ou já excluído é 404', async () => {
      productRepo.findOne.mockResolvedValue(null);
      await expect(service.remove('p1', USER, ORG)).rejects.toThrow(NotFoundException);
      expect(history.record).not.toHaveBeenCalled();
    });
  });

  describe('findOne e selo Vencido', () => {
    it('produto vencido tem isExpired true; hoje, futuro e sem vencimento não', async () => {
      const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
      const day = (offset: number) => new Date(`${today}T12:00:00Z`).getTime() + offset * 86400000;
      const iso = (offset: number) => new Date(day(offset)).toISOString().slice(0, 10);
      const expired = async (expirationDate: string | null) => {
        productRepo.findOne.mockResolvedValue(baseProduct({ expirationDate }));
        return (await service.findOne('p1', ORG)).isExpired;
      };

      expect(await expired(iso(-1))).toBe(true);
      expect(await expired(today)).toBe(false);
      expect(await expired(iso(1))).toBe(false);
      expect(await expired(null)).toBe(false);
    });

    it('produto inexistente é 404', async () => {
      productRepo.findOne.mockResolvedValue(null);
      await expect(service.findOne('p1', ORG)).rejects.toThrow(new NotFoundException('Produto não encontrado.'));
    });
  });
});
