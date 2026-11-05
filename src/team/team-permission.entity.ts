import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, Unique, CreateDateColumn, UpdateDateColumn } from 'typeorm';
import { Team } from './team.entity';
import { AccessLevel, Screen } from '../access/access';

// Uma linha por (equipe, tela). Tela sem linha = Sem acesso.
@Entity('team_permissions')
@Unique(['teamId', 'screen'])
export class TeamPermission {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Team, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'team_id' })
  team: Team;

  @Column({ name: 'team_id' })
  teamId: string;

  @Column({ type: 'enum', enum: Screen })
  screen: Screen;

  @Column({ type: 'enum', enum: AccessLevel })
  level: AccessLevel;

  @Column({ name: 'updated_by', nullable: true })
  updatedBy: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
