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
import { MailService } from '../mail/mail.service';

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

  async findAll() {
    return this.userRepository.find();
  }

  async findOne(id: string) {
    return this.userRepository.findOne({ where: { id } });
  }

  async findByEmail(email: string) {
    return this.userRepository.findOne({ where: { email } });
  }
}
