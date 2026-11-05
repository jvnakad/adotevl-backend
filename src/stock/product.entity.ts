import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, CreateDateColumn, UpdateDateColumn, Index, Check } from 'typeorm';
import { Organization } from '../organization/organization.entity';
import { ProductType } from './product-type.entity';
import { dateColumnTransformer } from '../volunteer-schedule/schedule-time';

export enum ProductUnit {
  UNIT = 'UNIT',
  KG = 'KG',
  LITER = 'LITER',
}

export const PRODUCT_UNIT_LABELS: Record<ProductUnit, string> = {
  [ProductUnit.UNIT]: 'un',
  [ProductUnit.KG]: 'kg',
  [ProductUnit.LITER]: 'L',
};

/** Produto em estoque. Quantidade editada direto (sem movimentações nesta versão). */
@Entity('products')
@Index('UQ_products_org_name_active', ['organizationId', 'nameNormalized'], { unique: true, where: '"is_active" = true' })
@Index('IDX_products_org_created_at', ['organizationId', 'createdAt'])
@Index('IDX_products_org_product_type', ['organizationId', 'productTypeId'])
@Check('CHK_products_quantity_non_negative', `"quantity" >= 0`)
@Check('CHK_products_unit_integer', `"unit" <> 'UNIT' OR "quantity" = trunc("quantity")`)
@Check('CHK_products_name_not_blank', `btrim("name") <> '' AND "name_normalized" <> ''`)
@Check('CHK_products_updated_by_pair', `("updated_by" IS NULL) = ("updated_by_name" IS NULL)`)
export class Product {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Organization, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'organization_id', foreignKeyConstraintName: 'FK_products_organization' })
  organization: Organization;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  // Pode apontar para tipo inativo (D-04); tipo ativo é exigido só ao criar ou trocar
  @ManyToOne(() => ProductType, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'product_type_id', foreignKeyConstraintName: 'FK_products_product_type' })
  productType: ProductType;

  @Column({ name: 'product_type_id', type: 'uuid' })
  productTypeId: string;

  @Column({ type: 'varchar', length: 250 })
  name: string;

  @Column({ name: 'name_normalized', type: 'varchar', length: 250 })
  nameNormalized: string;

  @Column({ type: 'enum', enum: ProductUnit })
  unit: ProductUnit;

  // String de propósito: o pg devolve numeric como texto ("10.000"); evita erro de ponto flutuante
  @Column({ type: 'numeric', precision: 12, scale: 3, default: 0 })
  quantity: string;

  /** 'YYYY-MM-DD'; sem hora, nunca new Date('YYYY-MM-DD') (R-04) */
  @Column({ name: 'expiration_date', type: 'date', nullable: true, transformer: dateColumnTransformer })
  expirationDate: string | null;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  notes: string | null;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @Column({ name: 'created_by', type: 'uuid' })
  createdBy: string;

  // Snapshot: o nome exibido não muda se o usuário for renomeado ou removido (D-12)
  @Column({ name: 'created_by_name', type: 'varchar' })
  createdByName: string;

  /** null até a primeira edição real: o detalhe só mostra "Última edição" quando preenchido */
  @Column({ name: 'updated_by', type: 'uuid', nullable: true })
  updatedBy: string | null;

  @Column({ name: 'updated_by_name', type: 'varchar', nullable: true })
  updatedByName: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
