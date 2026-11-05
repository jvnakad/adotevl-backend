import { Column, Entity, PrimaryColumn } from 'typeorm';

/**
 * Marca de tarefa de manutenção que roda uma única vez (ex.: carimbo dos volantes no boot, RN-40).
 * Só o boot escreve; a tabela é fechada para `anon`/`authenticated` como as outras (docs/db/refresh-token.md §6.5).
 */
@Entity('app_maintenance')
export class AppMaintenance {
  /** Nome estável da tarefa */
  @PrimaryColumn({ name: 'key', type: 'varchar', length: 100, primaryKeyConstraintName: 'PK_app_maintenance_key' })
  key: string;

  @Column({ name: 'done_at', type: 'timestamptz', default: () => 'now()' })
  doneAt: Date;
}
