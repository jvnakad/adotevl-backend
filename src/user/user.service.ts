import {
  Injectable,
  ConflictException,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { randomBytes, randomUUID } from 'crypto';
import * as bcrypt from 'bcryptjs';
import { TutorialProgress, User } from './user.entity';
import { Profile } from '../profile/profile.entity';
import { Organization } from '../organization/organization.entity';
import { CreateUserDto } from './dto/create-user.dto';
import { CreateFloatingVolunteerDto } from './dto/create-floating-volunteer.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { UpdateTutorialDto } from './dto/update-tutorial.dto';
import { MailService } from '../mail/mail.service';
import { JwtService } from '@nestjs/jwt';
import { PaginationDto } from '../common/pagination.dto';
import { paginate } from '../common/paginate.helper';
import { TeamMembershipService } from '../team/team-membership.service';
import { TeamService } from '../team/team.service';
import { TeamSystemKey } from '../team/team.entity';
import { AccessService } from '../access/access.service';
import { RealtimeService } from '../realtime/realtime.service';
import { guardianFields } from './volunteer-age';
import { normalizeCpf, normalizeEmail, normalizePersonName } from '../common/validation/person';
import { VolunteerApplication } from '../volunteer-application/volunteer-application.entity';
import { closePendingEmailChange, closeRecoveryCodes } from './email-change-pending';

/** O ValidationPipe global não grava a normalização no body: nome, e-mail e CPF vão limpos para o banco. */
function normalizedPerson(dto: { fullName: string; cpf: string; email: string; guardianName?: string }) {
  return {
    fullName: normalizePersonName(dto.fullName) as string,
    cpf: normalizeCpf(dto.cpf) as string,
    email: normalizeEmail(dto.email) as string,
    guardianName: normalizePersonName(dto.guardianName) as string | undefined,
  };
}

const EMAIL_IN_USE_MESSAGE = 'Este e-mail já está em uso.';

const EMPTY_TUTORIAL: TutorialProgress = { tours: {}, disabled: false };

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
    @InjectRepository(VolunteerApplication)
    private readonly applicationRepository: Repository<VolunteerApplication>,
    private readonly access: AccessService,
    private readonly realtime: RealtimeService,
  ) {}

  async create(dto: CreateUserDto, createdBy: string = null) {
    const person = normalizedPerson(dto);
    const guardian = guardianFields({ ...dto, guardianName: person.guardianName });
    await this.assertCanRegister({ ...dto, ...person });

    const isFirstUser = !(await this.userRepository.findOne({ where: { organizationId: dto.organizationId } }));
    // Voluntário fixo responde o questionário; o admin inicial da organização não
    if (!isFirstUser && !dto.application) throw new BadRequestException('Preencha o questionário de voluntário fixo.');
    // Perfil é legado (o acesso vem da equipe): o cadastro não escolhe, só registra ADMIN/VOLUNTEER
    const profileId = await this.legacyProfileId(isFirstUser ? 'ADMIN' : 'VOLUNTEER');

    const hashedPassword = await bcrypt.hash(dto.password, 10);
    const confirmationCode = randomUUID();

    const user = this.userRepository.create({
      fullName: person.fullName,
      cpf: person.cpf,
      email: person.email,
      phone: dto.phone,
      birthDate: dto.birthDate as unknown as Date,
      password: hashedPassword,
      profileId,
      organizationId: dto.organizationId,
      isConfirmed: false,
      confirmationCode,
      consentAt: new Date(),
      ...guardian,
      isActive: true,
      createdBy,
      updatedBy: createdBy,
    });

    const saved = await this.userRepository.save(user);
    if (dto.application) {
      await this.applicationRepository.save(this.applicationRepository.create({ ...dto.application, userId: saved.id }));
    }
    // Primeiro usuário da organização administra tudo: cria as equipes padrão e entra na Admin
    if (isFirstUser) {
      const adminTeam = await this.teams.ensureDefaultTeams(dto.organizationId);
      await this.membership.assign(saved, adminTeam.id, createdBy);
    }
    await this.mailService.sendConfirmationEmail(saved.email, saved.fullName, saved.confirmationCode);
    return saved;
  }

  /** Volante: sem senha (gera uma aleatória só para o login aceitar), já aprovado e na equipe Voluntário Volante. */
  async createFloating(dto: CreateFloatingVolunteerDto) {
    const person = normalizedPerson(dto);
    const guardian = guardianFields({ ...dto, guardianName: person.guardianName });
    await this.assertCanRegister({ ...dto, ...person });
    const profileId = await this.legacyProfileId('VOLUNTEER');
    const password = await bcrypt.hash(randomBytes(24).toString('base64url'), 10);

    const saved = await this.userRepository.save(
      this.userRepository.create({
        fullName: person.fullName,
        cpf: person.cpf,
        email: person.email,
        phone: dto.phone,
        birthDate: dto.birthDate as unknown as Date,
        password,
        profileId,
        organizationId: dto.organizationId,
        isConfirmed: true,
        isApproved: true,
        isActive: true,
        consentAt: new Date(),
        ...guardian,
      }),
    );
    const team = await this.teams.systemTeam(dto.organizationId, TeamSystemKey.FLOATING_VOLUNTEER);
    await this.membership.assign(saved, team.id, null);
    await this.mailService.sendFloatingWelcomeEmail(saved.email, saved.fullName);
    return { id: saved.id, fullName: saved.fullName, email: saved.email };
  }

  /** Email único no sistema, CPF único na organização e organização existente. */
  private async assertCanRegister(dto: { email: string; cpf: string; organizationId: string }) {
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
  }

  private async legacyProfileId(name: 'ADMIN' | 'VOLUNTEER') {
    const profile = await this.profileRepository.findOne({ where: { name } });
    if (!profile) throw new BadRequestException(`Perfil ${name} não encontrado.`);
    return profile.id;
  }

  async confirmAccount(confirmationCode: string) {
    const user = await this.userRepository.findOne({ where: { confirmationCode } });
    if (!user) throw new NotFoundException('Código de confirmação inválido.');
    if (user.isConfirmed) throw new BadRequestException('Esta conta já foi confirmada.');
    user.isConfirmed = true;
    user.confirmationCode = null;
    // O save devolve as colunas select:false preenchidas (null): nenhuma delas volta na resposta (RN-35)
    const { password: _hash, confirmationCode: _code, passwordChangedAt: _changed, passwordResetLockedUntil: _locked, ...confirmed } = await this.userRepository.save(user);
    return confirmed;
  }

  /** Só usuários da organização de quem chama (RN-36). */
  async findAll(pagination: PaginationDto, organizationId: string, filters: { isApproved?: boolean; teamId?: string } = {}) {
    const where: Record<string, unknown> = { organizationId };
    if (filters.isApproved !== undefined) where.isApproved = filters.isApproved;
    // Equipe fica em volunteers.teamId: filtra pelos usuários dela
    if (filters.teamId) where.id = In(await this.membership.userIdsOfTeam(filters.teamId));
    const result = await paginate(this.userRepository, pagination, where);
    const ids = result.data.map((user) => user.id);
    const teams = await this.membership.teamsOf(ids);
    const answered = new Set(
      ids.length ? (await this.applicationRepository.find({ where: { userId: In(ids) }, select: { userId: true } })).map((row) => row.userId) : [],
    );
    return {
      ...result,
      data: result.data.map((user) => ({ ...user, team: teams.get(user.id) ?? null, hasApplication: answered.has(user.id) })),
    };
  }

  /** Questionário do voluntário fixo (só da organização de quem consulta). */
  async findApplication(userId: string, organizationId: string) {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user || user.organizationId !== organizationId) throw new NotFoundException('Usuário não encontrado.');
    const application = await this.applicationRepository.findOne({ where: { userId } });
    if (!application) throw new NotFoundException('Este voluntário não respondeu o questionário.');
    return application;
  }

  async findOne(id: string) {
    return this.userRepository.findOne({ where: { id } });
  }

  /** Usuário de outra organização responde 404, igual a inexistente (RN-36). */
  async findInOrganization(id: string, organizationId: string) {
    const user = await this.userRepository.findOne({ where: { id } });
    if (!user || user.organizationId !== organizationId) throw new NotFoundException('Usuário não encontrado.');
    return user;
  }

  /** Só o login lê o hash da senha (a coluna é select:false). */
  async findByEmail(email: string) {
    return this.userRepository.createQueryBuilder('user').leftJoinAndSelect('user.profile', 'profile').addSelect('user.password').where('user.email = :email', { email }).getOne();
  }

  /** `canManage`: quem edita Voluntários altera qualquer usuário da organização; os demais só o próprio perfil. */
  async update(id: string, dto: UpdateUserDto, updatedBy: string = null, canManage = false, organizationId: string = null, isAdminTeam = false) {
    const current = await this.findInOrganization(id, organizationId);

    const isAdmin = canManage;

    if (!isAdmin && id !== updatedBy) {
      throw new ForbiddenException('Você só pode editar o próprio perfil.');
    }

    const data: Partial<UpdateUserDto> = isAdmin
      ? { ...dto }
      : { fullName: dto.fullName, cpf: dto.cpf, phone: dto.phone, birthDate: dto.birthDate };
    if (data.fullName !== undefined) data.fullName = normalizePersonName(data.fullName) as string;
    if (data.cpf !== undefined) data.cpf = normalizeCpf(data.cpf) as string;

    // E-mail só muda pela edição do admin em outro usuário; igual ao atual é no-op (o painel reenvia o formulário inteiro)
    let emailChanged = false;
    if (data.email !== undefined) {
      data.email = normalizeEmail(data.email) as string;
      if (data.email === current.email?.trim().toLowerCase()) {
        delete data.email;
      } else if (id === updatedBy) {
        throw new BadRequestException('Altere seu e-mail em Editar perfil.');
      } else if (!isAdminTeam) {
        // D-12: só a equipe Admin troca o e-mail de outro usuário; Voluntários (Editar) segue editando o resto
        throw new ForbiddenException('Só o Admin pode alterar o e-mail.');
      } else {
        await this.assertEmailAvailable(data.email, id);
        emailChanged = true;
      }
    }

    // Trocar o e-mail revoga as sessões: iat anterior é recusado pelo guard e pelo websocket, como na troca de senha
    const revoke = emailChanged ? { passwordChangedAt: new Date() } : {};
    try {
      await this.userRepository.update(id, { ...data, ...revoke, updatedBy });
    } catch (error) {
      // Corrida: outro cadastro pegou o e-mail entre a checagem e a gravação (unique_violation)
      if (emailChanged && (error as { code?: string }).code === '23505') throw new ConflictException(EMAIL_IN_USE_MESSAGE);
      throw error;
    }
    if (emailChanged) {
      // Código de recuperação aberto foi pedido para o e-mail antigo
      await closeRecoveryCodes(this.userRepository.manager, id);
      // Pedido de troca do próprio e-mail pendente deixa de valer (RN-31)
      await closePendingEmailChange(this.userRepository.manager, id, 'admin');
      await this.realtime.disconnectUser(id);
    }
    // Desativado pela edição: o websocket aberto cai junto com a sessão
    if (data.isActive === false) await this.realtime.disconnectUser(id);
    return this.userRepository.findOne({ where: { id } });
  }

  private async assertEmailAvailable(email: string, exceptUserId: string) {
    const taken = await this.userRepository.createQueryBuilder('user').where('lower(user.email) = :email', { email }).andWhere('user.id <> :id', { id: exceptUserId }).getOne();
    if (taken) throw new ConflictException(EMAIL_IN_USE_MESSAGE);
  }

  async activate(id: string, updatedBy: string = null, organizationId: string = null) {
    await this.findInOrganization(id, organizationId);
    await this.userRepository.update(id, { isActive: true, updatedBy });
    return this.userRepository.findOne({ where: { id } });
  }

  /** Aprovar exige a equipe: é ela que define o acesso às telas. */
  async approve(id: string, teamId: string, updatedBy: string = null, organizationId: string = null) {
    const user = await this.findInOrganization(id, organizationId);
    await this.membership.assign(user, teamId, updatedBy);
    await this.userRepository.update(id, { isApproved: true, updatedBy });
    const updated = await this.userRepository.findOne({ where: { id } });
    const payload = { sub: updated.id, email: updated.email, profileId: updated.profileId, profileName: updated.profile?.name, organizationId: updated.organizationId };
    const token = this.jwtService.sign(payload);
    await this.mailService.sendApprovalEmail(updated.email, updated.fullName, token);
    return updated;
  }

  async reject(id: string, updatedBy: string = null, organizationId: string = null) {
    await this.findInOrganization(id, organizationId);
    await this.membership.ensureNotLastAdmin(id);
    await this.userRepository.update(id, { isActive: false, updatedBy });
    await this.realtime.disconnectUser(id);
    return this.userRepository.findOne({ where: { id } });
  }

  async changeTeam(id: string, teamId: string, updatedBy: string = null, organizationId: string = null) {
    const user = await this.findInOrganization(id, organizationId);
    await this.membership.assign(user, teamId, updatedBy);
    // Pode ter virado volante: o websocket aberto cai e a reconexão passa pelas checagens de novo
    await this.realtime.disconnectUser(id);
    return user;
  }

  /** Troca pelo perfil: derruba as outras sessões (password_changed_at) e devolve um token novo para a atual (RN-29). */
  async changePassword(id: string, dto: ChangePasswordDto) {
    const user = await this.userRepository
      .createQueryBuilder('user')
      .leftJoinAndSelect('user.profile', 'profile')
      .addSelect('user.password')
      .where('user.id = :id', { id })
      .getOne();
    if (!user) throw new NotFoundException('Usuário não encontrado.');
    const match = await bcrypt.compare(dto.currentPassword, user.password);
    if (!match) throw new BadRequestException('Senha atual incorreta.');
    const hashed = await bcrypt.hash(dto.newPassword, 10);
    await this.userRepository.update(id, { password: hashed, passwordChangedAt: new Date() });
    await closePendingEmailChange(this.userRepository.manager, id, 'troca_de_senha');
    await this.realtime.disconnectUser(id);
    // Assinado depois da gravação: o iat fica no mesmo segundo da troca ou depois, e o guard só recusa iat menor (RN-30)
    const access_token = this.jwtService.sign({ sub: user.id, email: user.email, profileId: user.profileId, profileName: user.profile?.name, organizationId: user.organizationId });
    await this.mailService.sendPasswordChangedEmail(user.email, user.fullName);
    return { message: 'Senha alterada com sucesso.', access_token };
  }

  async updateTutorial(id: string, dto: UpdateTutorialDto) {
    const user = await this.userRepository.findOne({ where: { id } });
    if (!user) throw new NotFoundException('Usuário não encontrado.');
    const current = user.tutorialProgress ?? EMPTY_TUTORIAL;
    const progress: TutorialProgress = {
      tours: dto.tour ? { ...current.tours, [dto.tour]: dto.version } : { ...current.tours },
      disabled: dto.disabled ?? current.disabled,
    };
    await this.userRepository.update(id, { tutorialProgress: progress });
    return progress;
  }

  /** "Rever todos os tutoriais": volta a mostrar tudo como no primeiro acesso */
  async resetTutorial(id: string) {
    const user = await this.userRepository.findOne({ where: { id } });
    if (!user) throw new NotFoundException('Usuário não encontrado.');
    const progress: TutorialProgress = { ...EMPTY_TUTORIAL, tours: {} };
    await this.userRepository.update(id, { tutorialProgress: progress });
    return progress;
  }

  /** Reset pela tela Voluntários: só da organização de quem chama e nunca de volante (RN-27). Derruba as sessões do usuário (RN-28). */
  async resetPassword(id: string, organizationId: string = null) {
    const user = await this.findInOrganization(id, organizationId);
    if (await this.access.isFloatingVolunteer(id)) {
      throw new BadRequestException('Voluntários volantes não usam o painel. Troque a equipe antes de redefinir a senha.');
    }
    const newPassword = randomUUID().slice(0, 8);
    const hashed = await bcrypt.hash(newPassword, 10);
    await this.userRepository.update(id, { password: hashed, passwordChangedAt: new Date() });
    await closePendingEmailChange(this.userRepository.manager, id, 'troca_de_senha');
    await this.realtime.disconnectUser(id);
    await this.mailService.sendPasswordResetEmail(user.email, user.fullName, newPassword);
    return { message: 'Senha redefinida e enviada por e-mail.' };
  }
}
