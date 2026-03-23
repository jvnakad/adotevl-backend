import { Injectable, ConflictException, BadRequestException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Profile } from './profile.entity';
import { User } from '../user/user.entity';
import { CreateProfileDto } from './dto/create-profile.dto';

const DEFAULT_PROFILES = [
  { name: 'ADMIN', description: 'Possui acesso total ao sistema.' },
  { name: 'FINANCIAL', description: 'Possui acesso ao módulo financeiro e às campanhas.' },
  { name: 'VOLUNTEER', description: 'Possui acesso de visualização e registro operacional.' },
];

@Injectable()
export class ProfileService implements OnModuleInit {
  constructor(
    @InjectRepository(Profile)
    private readonly profileRepository: Repository<Profile>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  async onModuleInit() {
    for (const data of DEFAULT_PROFILES) {
      const existing = await this.profileRepository.findOne({ where: { name: data.name } });
      if (!existing) {
        await this.profileRepository.save(this.profileRepository.create({ ...data, isActive: true }));
      }
    }
  }

  async create(dto: CreateProfileDto) {
    const existing = await this.profileRepository.findOne({ where: { name: dto.name } });
    if (existing) {
      throw new ConflictException('Já existe um perfil cadastrado com este nome.');
    }
    return this.profileRepository.save(this.profileRepository.create({ ...dto, isActive: true }));
  }

  async findAll() {
    return this.profileRepository.find();
  }

  async findOne(id: string) {
    return this.profileRepository.findOne({ where: { id } });
  }

  async findByName(name: string) {
    return this.profileRepository.findOne({ where: { name } });
  }

  async remove(id: string) {
    const profile = await this.profileRepository.findOne({ where: { id } });
    if (!profile) {
      throw new BadRequestException('Perfil não encontrado.');
    }
    const linkedUsers = await this.userRepository.count({ where: { profileId: id } });
    if (linkedUsers > 0) {
      throw new ConflictException('Não é possível excluir um perfil vinculado a usuários.');
    }
    return this.profileRepository.remove(profile);
  }
}
