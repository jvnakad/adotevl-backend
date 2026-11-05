import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Not, Repository } from 'typeorm';
import { ProductType } from './product-type.entity';
import { Product } from './product.entity';
import { StockHistoryType } from './stock-history.entity';
import { StockHistoryService } from './stock-history.service';
import { CreateProductTypeDto, UpdateProductTypeDto } from './dto/create-product-type.dto';
import { PaginationDto } from '../common/pagination.dto';
import { normalizeName } from '../common/normalize-name';
import { toDuplicateNameError } from './stock-errors';

const DUPLICATE_MESSAGE = 'Já existe um tipo de produto com esse nome.';
const NOT_FOUND_MESSAGE = 'Tipo de produto não encontrado.';

@Injectable()
export class ProductTypeService {
  constructor(
    @InjectRepository(ProductType)
    private readonly typeRepository: Repository<ProductType>,
    private readonly dataSource: DataSource,
    private readonly history: StockHistoryService,
  ) {}

  async findAll(pagination: PaginationDto, organizationId: string) {
    const { page = 1, limit = 10 } = pagination;
    const [types, total] = await this.activeTypesQuery(organizationId)
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();
    return { data: types.map((type) => this.toResponse(type)), total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  /** Tipos ativos para select e filtro (só id e nome, sem paginar). */
  async findOptions(organizationId: string) {
    const types = await this.activeTypesQuery(organizationId).select(['t.id', 't.name']).getMany();
    return types.map((type) => ({ id: type.id, name: type.name }));
  }

  async usage(id: string, organizationId: string) {
    const type = await this.typeRepository.findOne({ where: { id, organizationId, isActive: true } });
    if (!type) throw new NotFoundException(NOT_FOUND_MESSAGE);
    return { activeProductsCount: await this.countActiveProducts(this.typeRepository.manager, type) };
  }

  async create(dto: CreateProductTypeDto, userId: string, organizationId: string) {
    const nameNormalized = normalizeName(dto.name);
    try {
      const saved = await this.dataSource.transaction(async (manager) => {
        await this.assertNameFree(manager, organizationId, nameNormalized);
        const repository = manager.getRepository(ProductType);
        const type = await repository.save(repository.create({ organizationId, name: dto.name, nameNormalized, createdBy: userId }));
        await this.history.record(manager, {
          organizationId,
          type: StockHistoryType.TIPO_CRIADO,
          productTypeId: type.id,
          subjectName: type.name,
          description: `Tipo de produto ${type.name} criado.`,
          metadata: { name: type.name },
          userId,
          userName: await this.history.resolveUserName(manager, userId),
        });
        return type;
      });
      return this.toResponse(saved);
    } catch (error) {
      throw toDuplicateNameError(error) ?? error;
    }
  }

  async update(id: string, dto: UpdateProductTypeDto, userId: string, organizationId: string) {
    try {
      const saved = await this.dataSource.transaction(async (manager) => {
        const repository = manager.getRepository(ProductType);
        const type = await repository.findOne({ where: { id, organizationId, isActive: true } });
        if (!type) throw new NotFoundException(NOT_FOUND_MESSAGE);
        // Nome igual ao gravado (depois de normalizar espaços): nada muda e nenhum evento é gerado
        if (type.name === dto.name) return type;

        const nameNormalized = normalizeName(dto.name);
        // O próprio tipo não conta como duplicado ("racao" para "Ração")
        await this.assertNameFree(manager, organizationId, nameNormalized, id);

        const previousName = type.name;
        type.name = dto.name;
        type.nameNormalized = nameNormalized;
        type.updatedBy = userId;
        const updated = await repository.save(type);
        await this.history.record(manager, {
          organizationId,
          type: StockHistoryType.TIPO_RENOMEADO,
          productTypeId: updated.id,
          subjectName: updated.name,
          previousSubjectName: previousName,
          description: `Tipo de produto renomeado: ${previousName} → ${updated.name}.`,
          metadata: { before: previousName, after: updated.name },
          userId,
          userName: await this.history.resolveUserName(manager, userId),
        });
        return updated;
      });
      return this.toResponse(saved);
    } catch (error) {
      throw toDuplicateNameError(error) ?? error;
    }
  }

  async remove(id: string, userId: string, organizationId: string) {
    await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(ProductType);
      const type = await repository.findOne({ where: { id, organizationId, isActive: true } });
      if (!type) throw new NotFoundException(NOT_FOUND_MESSAGE);

      const activeProductsCount = await this.countActiveProducts(manager, type);
      type.isActive = false;
      type.updatedBy = userId;
      await repository.save(type);
      await this.history.record(manager, {
        organizationId,
        type: StockHistoryType.TIPO_REMOVIDO,
        productTypeId: type.id,
        subjectName: type.name,
        description: `Tipo de produto ${type.name} removido.`,
        metadata: { activeProductsCount },
        userId,
        userName: await this.history.resolveUserName(manager, userId),
      });
    });
  }

  /**
   * Tipos ativos em ordem A→Z pelo nome normalizado (sem acento e minúsculo), por código de caractere (COLLATE "C"):
   * a mesma ordem em qualquer banco, sem depender da collation do servidor (pontuação e dígitos inclusos). O id desempata.
   */
  private activeTypesQuery(organizationId: string) {
    return this.typeRepository
      .createQueryBuilder('t')
      .where('t.organizationId = :organizationId', { organizationId })
      .andWhere('t.isActive = true')
      .orderBy('t.nameNormalized COLLATE "C"', 'ASC')
      .addOrderBy('t.id', 'ASC');
  }

  private countActiveProducts(manager: EntityManager, type: ProductType) {
    return manager.count(Product, { where: { organizationId: type.organizationId, productTypeId: type.id, isActive: true } });
  }

  /** Checagem prévia para dar a mensagem; o índice único parcial garante no caso de cadastros simultâneos. */
  private async assertNameFree(manager: EntityManager, organizationId: string, nameNormalized: string, exceptId?: string) {
    const existing = await manager.findOne(ProductType, {
      where: { organizationId, nameNormalized, isActive: true, ...(exceptId ? { id: Not(exceptId) } : {}) },
      select: { id: true },
    });
    if (existing) throw new ConflictException(DUPLICATE_MESSAGE);
  }

  private toResponse(type: ProductType) {
    return { id: type.id, name: type.name, createdBy: type.createdBy ?? null, updatedBy: type.updatedBy ?? null, createdAt: type.createdAt, updatedAt: type.updatedAt };
  }
}
