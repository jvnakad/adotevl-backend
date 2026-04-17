import {
  Injectable,
  ConflictException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
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
    let profileId = dto.profileId;

    if (isFirstUser) {
      const admin = await this.profileRepository.findOne({ where: { name: 'ADMIN' } });
      if (!admin) throw new BadRequestException('Perfil ADMIN não encontrado.');
      profileId = admin.id;
    } else {
      const profile = await this.profileRepository.findOne({ where: { id: dto.profileId } });
      if (!profile) throw new NotFoundException('Perfil não encontrado.');
    }

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

  async findAll(pagination: PaginationDto, isApproved?: boolean) {
    const where = isApproved !== undefined ? { isApproved } : {};
    return paginate(this.userRepository, pagination, where);
  }

  async findOne(id: string) {
    return this.userRepository.findOne({ where: { id } });
  }

  async findByEmail(email: string) {
    return this.userRepository.findOne({ where: { email } });
  }

  async update(id: string, dto: UpdateUserDto, updatedBy: string = null) {
    const user = await this.userRepository.findOne({ where: { id } });
    if (!user) throw new NotFoundException('Usuário não encontrado.');
    await this.userRepository.update(id, { ...dto, updatedBy });
    return this.userRepository.findOne({ where: { id } });
  }

  async activate(id: string, updatedBy: string = null) {
    const user = await this.userRepository.findOne({ where: { id } });
    if (!user) throw new NotFoundException('Usuário não encontrado.');
    await this.userRepository.update(id, { isActive: true, updatedBy });
    return this.userRepository.findOne({ where: { id } });
  }

  async approve(id: string, updatedBy: string = null) {
    const user = await this.userRepository.findOne({ where: { id } });
    if (!user) throw new NotFoundException('Usuário não encontrado.');
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
    await this.userRepository.update(id, { isActive: false, updatedBy });
    return this.userRepository.findOne({ where: { id } });
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
