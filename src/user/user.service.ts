import {
  Injectable,
  ConflictException,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import * as bcrypt from 'bcryptjs';
import { User } from './user.entity';
import { Profile } from '../profile/profile.entity';
import { Organization } from '../organization/organization.entity';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { MailService } from '../mail/mail.service';
import { JwtService } from '@nestjs/jwt';
import { PaginationDto } from '../common/pagination.dto';
import { paginate } from '../common/paginate.helper';
import { TeamMembershipService } from '../team/team-membership.service';
import { TeamService } from '../team/team.service';

@Injectable()
export class UserService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Profile)
    private readonly profileRepository: Repository<Profile>,
    @InjectRepository(Organization)
    private readonly organizationRepository: Repository<Organization>,
    private readonly mailService: MailService,
    private readonly jwtService: JwtService,
    private readonly membership: TeamMembershipService,
    private readonly teams: TeamService,
  ) {}

  async create(dto: CreateUserDto, createdBy: string = null) {
    const emailExists = await this.userRepository.findOne({ where: { email: dto.email } });
    if (emailExists) {
      throw new ConflictException('Já existe um usuário cadastrado com este e-mail.');
    }

    const cpfInOrg = await this.userRepository.findOne({
      where: { cpf: dto.cpf, organizationId: dto.organizationId },
    });
    if (cpfInOrg) {
      throw new ConflictException('Já existe um usuário com este CPF nesta organização.');
    }

    const organization = await this.organizationRepository.findOne({ where: { id: dto.organizationId } });
    if (!organization) {
      throw new NotFoundException('Organização não encontrada.');
    }

    const isFirstUser = !(await this.userRepository.findOne({ where: { organizationId: dto.organizationId } }));
    let profileId: string;

    // Perfil é legado (o acesso vem da equipe): o cadastro não escolhe, só registra ADMIN/VOLUNTEER
    const profileName = isFirstUser ? 'ADMIN' : 'VOLUNTEER';
    const profile = await this.profileRepository.findOne({ where: { name: profileName } });
    if (!profile) throw new BadRequestException(`Perfil ${profileName} não encontrado.`);
    profileId = profile.id;

    const hashedPassword = await bcrypt.hash(dto.password, 10);
    const confirmationCode = randomUUID();

    const user = this.userRepository.create({
      fullName: dto.fullName,
      cpf: dto.cpf,
      email: dto.email,
      phone: dto.phone,
      birthDate: dto.birthDate,
      password: hashedPassword,
      profileId,
      organizationId: dto.organizationId,
      isConfirmed: false,
      confirmationCode,
      isActive: true,
      createdBy,
      updatedBy: createdBy,
    });

    const saved = await this.userRepository.save(user);
    // Primeiro usuário da organização administra tudo: cria as equipes padrão e entra na Admin
    if (isFirstUser) {
      const adminTeam = await this.teams.ensureDefaultTeams(dto.organizationId);
      await this.membership.assign(saved, adminTeam.id, createdBy);
    }
    await this.mailService.sendConfirmationEmail(saved.email, saved.fullName, saved.confirmationCode);
    return saved;
  }

  async confirmAccount(confirmationCode: string) {
    const user = await this.userRepository.findOne({ where: { confirmationCode } });
    if (!user) throw new NotFoundException('Código de confirmação inválido.');
    if (user.isConfirmed) throw new BadRequestException('Esta conta já foi confirmada.');
    user.isConfirmed = true;
    user.confirmationCode = null;
    return this.userRepository.save(user);
  }

  async findAll(pagination: PaginationDto, filters: { isApproved?: boolean; teamId?: string } = {}) {
    const where: Record<string, unknown> = {};
    if (filters.isApproved !== undefined) where.isApproved = filters.isApproved;
    // Equipe fica em volunteers.teamId: filtra pelos usuários dela
    if (filters.teamId) where.id = In(await this.membership.userIdsOfTeam(filters.teamId));
    const result = await paginate(this.userRepository, pagination, where);
    const teams = await this.membership.teamsOf(result.data.map((user) => user.id));
    return { ...result, data: result.data.map((user) => ({ ...user, team: teams.get(user.id) ?? null })) };
  }

  async findOne(id: string) {
    return this.userRepository.findOne({ where: { id } });
  }

  async findByEmail(email: string) {
    return this.userRepository.findOne({ where: { email } });
  }

  /** `canManage`: quem edita Voluntários altera qualquer usuário; os demais só o próprio perfil. */
  async update(id: string, dto: UpdateUserDto, updatedBy: string = null, canManage = false) {
    const user = await this.userRepository.findOne({ where: { id } });
    if (!user) throw new NotFoundException('Usuário não encontrado.');

    const isAdmin = canManage;

    if (!isAdmin && id !== updatedBy) {
      throw new ForbiddenException('Você só pode editar o próprio perfil.');
    }

    const data: Partial<UpdateUserDto> = isAdmin
      ? { ...dto }
      : { fullName: dto.fullName, cpf: dto.cpf, phone: dto.phone, birthDate: dto.birthDate };

    await this.userRepository.update(id, { ...data, updatedBy });
    return this.userRepository.findOne({ where: { id } });
  }

  async activate(id: string, updatedBy: string = null) {
    const user = await this.userRepository.findOne({ where: { id } });
    if (!user) throw new NotFoundException('Usuário não encontrado.');
    await this.userRepository.update(id, { isActive: true, updatedBy });
    return this.userRepository.findOne({ where: { id } });
  }

  /** Aprovar exige a equipe: é ela que define o acesso às telas. */
  async approve(id: string, teamId: string, updatedBy: string = null) {
    const user = await this.userRepository.findOne({ where: { id } });
    if (!user) throw new NotFoundException('Usuário não encontrado.');
    await this.membership.assign(user, teamId, updatedBy);
    await this.userRepository.update(id, { isApproved: true, updatedBy });
    const updated = await this.userRepository.findOne({ where: { id } });
    const payload = { sub: updated.id, email: updated.email, profileId: updated.profileId, profileName: updated.profile?.name, organizationId: updated.organizationId };
    const token = this.jwtService.sign(payload);
    await this.mailService.sendApprovalEmail(updated.email, updated.fullName, token);
    return updated;
  }

  async reject(id: string, updatedBy: string = null) {
    const user = await this.userRepository.findOne({ where: { id } });
    if (!user) throw new NotFoundException('Usuário não encontrado.');
    await this.membership.ensureNotLastAdmin(id);
    await this.userRepository.update(id, { isActive: false, updatedBy });
    return this.userRepository.findOne({ where: { id } });
  }

  async changeTeam(id: string, teamId: string, updatedBy: string = null) {
    const user = await this.userRepository.findOne({ where: { id } });
    if (!user) throw new NotFoundException('Usuário não encontrado.');
    await this.membership.assign(user, teamId, updatedBy);
    return user;
  }

  async changePassword(id: string, dto: ChangePasswordDto) {
    const user = await this.userRepository.findOne({ where: { id } });
    if (!user) throw new NotFoundException('Usuário não encontrado.');
    const match = await bcrypt.compare(dto.currentPassword, user.password);
    if (!match) throw new BadRequestException('Senha atual incorreta.');
    const hashed = await bcrypt.hash(dto.newPassword, 10);
    await this.userRepository.update(id, { password: hashed });
    return { message: 'Senha alterada com sucesso.' };
  }

  async resetPassword(id: string) {
    const user = await this.userRepository.findOne({ where: { id } });
    if (!user) throw new NotFoundException('Usuário não encontrado.');
    const newPassword = randomUUID().slice(0, 8);
    const hashed = await bcrypt.hash(newPassword, 10);
    await this.userRepository.update(id, { password: hashed });
    await this.mailService.sendPasswordResetEmail(user.email, user.fullName, newPassword);
    return { message: 'Senha redefinida e enviada por e-mail.' };
  }
}
