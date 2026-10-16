import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Not, Repository } from 'typeorm';
import { Product, ProductUnit } from './product.entity';
import { ProductType } from './product-type.entity';
import { StockHistoryType } from './stock-history.entity';
import { StockHistoryService } from './stock-history.service';
import { CreateProductDto, UpdateProductDto } from './dto/create-product.dto';
import { FindStockProductsDto } from './dto/find-stock-products.dto';
import { normalizeName, toLikeTerm } from '../common/normalize-name';
import { todayInBrazil } from '../volunteer-schedule/schedule-time';
import { localPeriod } from './stock-date';
import { formatQuantity, parseQuantity } from './stock-quantity';
import { toDuplicateNameError } from './stock-errors';

const DUPLICATE_MESSAGE = 'Já existe um produto com esse nome.';
const NOT_FOUND_MESSAGE = 'Produto não encontrado.';
const TYPE_NOT_FOUND_MESSAGE = 'Tipo de produto não encontrado.';
const TYPE_INACTIVE_MESSAGE = 'Este tipo de produto foi excluído. Escolha outro.';

type FieldChange = { field: string; label: string; before: any; after: any; [extra: string]: any };

@Injectable()
export class ProductService {
  constructor(
    @InjectRepository(Product)
    private readonly productRepository: Repository<Product>,
    private readonly dataSource: DataSource,
    private readonly history: StockHistoryService,
  ) {}

  async findAll(query: FindStockProductsDto, organizationId: string) {
    const { page = 1, limit = 10 } = query;
    const { start, endExclusive } = localPeriod(query.from, query.to);

    const qb = this.productRepository
      .createQueryBuilder('p')
      .innerJoinAndSelect('p.productType', 't')
      .where('p.organizationId = :organizationId', { organizationId })
      .andWhere('p.isActive = true');
    const term = toLikeTerm(query.search ?? '');
    if (term) qb.andWhere('p.nameNormalized LIKE :term', { term });
    if (query.productTypeId) {
      // Tipo excluído não pode ser filtrado (RN-15, B-10): resultado vazio
      qb.andWhere('p.productTypeId = :productTypeId', { productTypeId: query.productTypeId }).andWhere('t.isActive = true');
    }
    if (start) qb.andWhere('p.createdAt >= :start', { start });
    if (endExclusive) qb.andWhere('p.createdAt < :endExclusive', { endExclusive });

    const [products, total] = await qb
      .orderBy('p.createdAt', 'DESC')
      .addOrderBy('p.id', 'DESC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    const today = todayInBrazil();
    return { data: products.map((product) => this.toResponse(product, today)), total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOne(id: string, organizationId: string) {
    const product = await this.productRepository.findOne({ where: { id, organizationId, isActive: true }, relations: { productType: true } });
    if (!product) throw new NotFoundException(NOT_FOUND_MESSAGE);
    return this.toResponse(product);
  }

  async create(dto: CreateProductDto, userId: string, organizationId: string) {
    try {
      const saved = await this.dataSource.transaction(async (manager) => {
        const nameNormalized = normalizeName(dto.name);
        const quantity = parseQuantity(dto.quantity, dto.unit);
        const type = await this.requireUsableType(manager, dto.productTypeId, organizationId);
        await this.assertNameFree(manager, organizationId, nameNormalized);

        const userName = await this.history.resolveUserName(manager, userId);
        const repository = manager.getRepository(Product);
        const product = await repository.save(
          repository.create({
            organizationId,
            productTypeId: type.id,
            name: dto.name,
            nameNormalized,
            unit: dto.unit,
            quantity,
            expirationDate: dto.expirationDate ?? null,
            notes: dto.notes ?? null,
            createdBy: userId,
            createdByName: userName,
          }),
        );
        product.productType = type;

        await this.history.record(manager, {
          organizationId,
          type: StockHistoryType.PRODUTO_CRIADO,
          productId: product.id,
          subjectName: product.name,
          description: `Produto ${product.name} criado com ${formatQuantity(quantity, product.unit)}.`,
          metadata: {
            values: {
              name: product.name,
              productTypeId: type.id,
              productTypeName: type.name,
              unit: product.unit,
              quantity,
              expirationDate: product.expirationDate,
              notes: product.notes,
            },
          },
          userId,
          userName,
        });
        return product;
      });
      return this.toResponse(saved);
    } catch (error) {
      throw toDuplicateNameError(error) ?? error;
    }
  }

  async update(id: string, dto: UpdateProductDto, userId: string, organizationId: string) {
    // Obrigatórios que o validador deixa passar como null (@IsOptional): recusa aqui
    if (dto.name === null) throw new BadRequestException('Informe o nome do produto.');
    if (dto.productTypeId === null) throw new BadRequestException('Escolha o tipo de produto.');
    if (dto.unit === null) throw new BadRequestException('Escolha a unidade de medida.');

    try {
      const result = await this.dataSource.transaction(async (manager) => {
        const repository = manager.getRepository(Product);
        const product = await repository.findOne({ where: { id, organizationId, isActive: true }, relations: { productType: true } });
        if (!product) throw new NotFoundException(NOT_FOUND_MESSAGE);

        const before = { ...product };
        const changes: FieldChange[] = [];
        let nextType: ProductType = product.productType;
        const unit = dto.unit ?? product.unit;
        const unitChanged = unit !== product.unit;

        // Tipo ativo só é exigido ao trocar de tipo; manter o tipo (mesmo excluído) é permitido (D-04)
        if (dto.productTypeId !== undefined && dto.productTypeId !== product.productTypeId) {
          nextType = await this.requireUsableType(manager, dto.productTypeId, organizationId);
        }

        // Troca de unidade sem quantidade grava 0 (D-08); com quantidade, valida para a nova unidade
        let quantity = product.quantity;
        if (dto.quantity !== undefined) quantity = parseQuantity(dto.quantity, unit);
        else if (unitChanged) quantity = '0.000';

        if (dto.name !== undefined && dto.name !== product.name) {
          await this.assertNameFree(manager, organizationId, normalizeName(dto.name), product.id);
          changes.push({ field: 'name', label: 'Nome', before: product.name, after: dto.name });
        }
        if (nextType.id !== product.productTypeId) {
          changes.push({
            field: 'productTypeId',
            label: 'Tipo de produto',
            before: product.productTypeId,
            after: nextType.id,
            beforeName: product.productType.name,
            afterName: nextType.name,
          });
        }
        if (unitChanged) changes.push({ field: 'unit', label: 'Unidade de medida', before: product.unit, after: unit });
        if (quantity !== product.quantity || unitChanged) {
          // Troca de unidade sempre mostra Quantidade no de/para, mesmo que o número fique igual
          changes.push({ field: 'quantity', label: 'Quantidade', before: product.quantity, after: quantity, beforeUnit: product.unit, afterUnit: unit });
        }
        if (dto.expirationDate !== undefined && (dto.expirationDate ?? null) !== (product.expirationDate ?? null)) {
          changes.push({ field: 'expirationDate', label: 'Data de vencimento', before: product.expirationDate ?? null, after: dto.expirationDate ?? null });
        }
        if (dto.notes !== undefined && (dto.notes ?? null) !== (product.notes ?? null)) {
          changes.push({ field: 'notes', label: 'Observações', before: product.notes ?? null, after: dto.notes ?? null });
        }

        // Sem mudança real: não grava nem gera evento (RN-31, D-09)
        if (!changes.length) return { product, changed: false };

        const userName = await this.history.resolveUserName(manager, userId);
        if (dto.name !== undefined) {
          product.name = dto.name;
          product.nameNormalized = normalizeName(dto.name);
        }
        product.productTypeId = nextType.id;
        product.productType = nextType;
        product.unit = unit;
        product.quantity = quantity;
        if (dto.expirationDate !== undefined) product.expirationDate = dto.expirationDate ?? null;
        if (dto.notes !== undefined) product.notes = dto.notes ?? null;
        product.updatedBy = userId;
        product.updatedByName = userName;
        const saved = await repository.save(product);
        saved.productType = nextType;

        const renamed = changes.some((change) => change.field === 'name');
        await this.history.record(manager, {
          organizationId,
          type: StockHistoryType.PRODUTO_EDITADO,
          productId: saved.id,
          subjectName: saved.name,
          previousSubjectName: renamed ? before.name : null,
          // Sem repetir valores: o de/para do metadata mostra o que mudou (D-40)
          description: `Produto ${saved.name} editado.`,
          metadata: { fields: this.orderChanges(changes) },
          userId,
          userName,
        });
        return { product: saved, changed: true };
      });
      return this.toResponse(result.product);
    } catch (error) {
      throw toDuplicateNameError(error) ?? error;
    }
  }

  async remove(id: string, userId: string, organizationId: string) {
    await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(Product);
      const product = await repository.findOne({ where: { id, organizationId, isActive: true } });
      if (!product) throw new NotFoundException(NOT_FOUND_MESSAGE);

      const userName = await this.history.resolveUserName(manager, userId);
      product.isActive = false;
      product.updatedBy = userId;
      product.updatedByName = userName;
      await repository.save(product);
      await this.history.record(manager, {
        organizationId,
        type: StockHistoryType.PRODUTO_REMOVIDO,
        productId: product.id,
        subjectName: product.name,
        description: `Produto ${product.name} removido.`,
        metadata: null,
        userId,
        userName,
      });
    });
  }

  // ---- internos ----

  /** Tipo da organização e ativo; tipo de outra organização ou inexistente é 400 (referência no corpo, não 404). */
  private async requireUsableType(manager: EntityManager, productTypeId: string, organizationId: string) {
    const type = await manager.findOne(ProductType, { where: { id: productTypeId, organizationId } });
    if (!type) throw new BadRequestException(TYPE_NOT_FOUND_MESSAGE);
    if (!type.isActive) throw new BadRequestException(TYPE_INACTIVE_MESSAGE);
    return type;
  }

  /** Checagem prévia para dar a mensagem; o índice único parcial garante no caso de cadastros simultâneos. */
  private async assertNameFree(manager: EntityManager, organizationId: string, nameNormalized: string, exceptId?: string) {
    const existing = await manager.findOne(Product, {
      where: { organizationId, nameNormalized, isActive: true, ...(exceptId ? { id: Not(exceptId) } : {}) },
      select: { id: true },
    });
    if (existing) throw new ConflictException(DUPLICATE_MESSAGE);
  }

  private orderChanges(changes: FieldChange[]) {
    const order = ['name', 'productTypeId', 'unit', 'quantity', 'expirationDate', 'notes'];
    return [...changes].sort((a, b) => order.indexOf(a.field) - order.indexOf(b.field));
  }

  private toResponse(product: Product, today = todayInBrazil()) {
    return {
      id: product.id,
      name: product.name,
      productTypeId: product.productTypeId,
      productType: { id: product.productType.id, name: product.productType.name, isActive: product.productType.isActive },
      unit: product.unit as ProductUnit,
      quantity: product.quantity,
      expirationDate: product.expirationDate ?? null,
      isExpired: !!product.expirationDate && product.expirationDate < today,
      notes: product.notes ?? null,
      createdBy: product.createdBy,
      createdByName: product.createdByName,
      createdAt: product.createdAt,
      updatedBy: product.updatedBy ?? null,
      updatedByName: product.updatedByName ?? null,
      updatedAt: product.updatedAt,
    };
  }
}
