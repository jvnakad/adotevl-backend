import { Injectable, NotFoundException, BadRequestException, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsOrder, ILike, In, Not, Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { extname } from 'path';
import { Pet, PetStatus } from './pet.entity';
import { AdoptionForm, AdoptionFormStatus } from '../adoption-form/adoption-form.entity';
import { PetAlreadyAdoptedException } from '../adoption-form/pet-already-adopted.exception';
import { PetPhoto } from './pet-photo.entity';
import { CreatePetDto } from './dto/create-pet.dto';
import { UpdatePetDto } from './dto/update-pet.dto';
import { PaginationDto } from '../common/pagination.dto';
import { paginate } from '../common/paginate.helper';
import { StorageService } from '../storage/storage.service';
import { petAgeLabel } from './pet-age';

export const MAX_PET_PHOTOS = 10;
export const MAX_PHOTO_SIZE = 5 * 1024 * 1024;
const ALLOWED_PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export interface PetFilters {
  organizationId?: string;
  species?: string;
  sex?: string;
  size?: string;
  castration?: string;
  status?: string;
  search?: string;
}

// Idade antiga (anos inteiros) vira nascimento aproximado: mês do cadastro menos a idade
const LEGACY_AGE_TO_BIRTH_DATE = `
  UPDATE pets
     SET birth_date = (date_trunc('month', created_at) - make_interval(years => age))::date,
         age = NULL
   WHERE age IS NOT NULL AND birth_date IS NULL`;

@Injectable()
export class PetService implements OnModuleInit {
  private readonly logger = new Logger(PetService.name);

  constructor(
    @InjectRepository(Pet)
    private readonly petRepository: Repository<Pet>,
    @InjectRepository(PetPhoto)
    private readonly photoRepository: Repository<PetPhoto>,
    private readonly storageService: StorageService,
    @InjectRepository(AdoptionForm)
    private readonly formRepository: Repository<AdoptionForm>,
  ) {}

  async onModuleInit() {
    const [, affected] = await this.petRepository.query(LEGACY_AGE_TO_BIRTH_DATE);
    if (affected) this.logger.log(`${affected} pet(s) com idade antiga convertido(s) para mês/ano de nascimento.`);
  }

  async create(dto: CreatePetDto, organizationId: string, createdBy: string = null) {
    // A organização é sempre a do usuário autenticado (o DTO não a aceita)
    const pet = this.petRepository.create({ ...dto, organizationId, createdBy, updatedBy: createdBy });
    const saved = await this.petRepository.save(pet);
    return this.withAge({ ...saved, fotos: [] });
  }

  async findAll(
    pagination: PaginationDto,
    filters: PetFilters = {},
    // Padrão do painel: cadastrados mais recentes primeiro
    order: FindOptionsOrder<Pet> = { createdAt: 'DESC' },
    withAdopter = true,
  ) {
    const where: any = { isActive: true };
    if (filters.organizationId) where.organizationId = filters.organizationId;
    if (filters.species) where.species = filters.species;
    if (filters.sex) where.sex = filters.sex;
    if (filters.size) where.size = filters.size;
    if (filters.castration !== undefined) where.castration = filters.castration === 'true';
    if (filters.status) where.status = filters.status;
    const result = await paginate(this.petRepository, pagination, this.searchWhere(where, filters.search), { fotos: true }, order);
    const adopters = withAdopter ? await this.adoptersOf(result.data) : new Map<string, { formId: string; name: string }>();
    return { ...result, data: result.data.map((pet) => ({ ...this.withAge(this.sortPhotos(pet)), ...(adopters.has(pet.id) && { adopter: adopters.get(pet.id) }) })) };
  }

  // Versão para o site público: só os campos exibidos, sem dados internos nem storagePath
  async findAllPublic(pagination: PaginationDto, filters: PetFilters = {}) {
    // Ordem por nome: a lista alimenta o select de animais do formulário de adoção
    const result = await this.findAll(pagination, filters, { name: 'ASC' }, false);
    return {
      ...result,
      data: result.data.map((pet) => ({
        id: pet.id,
        name: pet.name,
        species: pet.species,
        animal: pet.animal ?? null,
        sex: pet.sex,
        birthDate: pet.birthDate ?? null,
        ageLabel: pet.ageLabel,
        size: pet.size,
        castration: pet.castration,
        about: pet.about,
        fotos: (pet.fotos ?? []).map((foto) => ({ url: foto.url })),
      })),
    };
  }

  /** Pet da organização informada; de outra organização responde como inexistente (404). */
  async findOne(id: string, organizationId: string) {
    const pet = await this.petRepository.findOne({ where: { id, organizationId }, relations: { fotos: true } });
    if (!pet) throw new NotFoundException('Pet não encontrado.');
    const adopter = (await this.adoptersOf([pet])).get(pet.id);
    return { ...this.withAge(this.sortPhotos(pet)), ...(adopter && { adopter }) };
  }

  async update(id: string, dto: UpdatePetDto, organizationId: string, updatedBy: string = null) {
    const pet = await this.petRepository.findOne({ where: { id, organizationId }, select: { id: true, name: true, status: true } });
    if (!pet) throw new NotFoundException('Pet não encontrado.');
    // Fotos são gerenciadas pelos endpoints próprios; ignora caso o front reenvie o objeto completo
    const { fotos, adoptionFormId, ...data } = dto as Partial<CreatePetDto> & { fotos?: unknown; adoptionFormId?: string };
    if (!adoptionFormId) {
      await this.petRepository.update({ id, organizationId }, { ...data, updatedBy });
      return this.findOne(id, organizationId);
    }

    // Vínculo com a ficha: grava os dois lados (status do pet + petId da ficha) na mesma transação
    const status = data.status ?? pet.status;
    if (status !== PetStatus.EM_PROCESSO && status !== PetStatus.ADOTADO) {
      throw new BadRequestException('Para vincular uma ficha de adoção, o pet precisa estar Em processo ou Adotado.');
    }
    const form = await this.formRepository.findOne({ where: { id: adoptionFormId, organizationId, isActive: true }, select: { id: true, petId: true } });
    if (!form) throw new NotFoundException('Ficha de adoção não encontrada.');
    if (pet.status === PetStatus.ADOTADO) {
      const adopter = (await this.adoptersOf([pet as Pet])).get(id);
      if (adopter && adopter.formId !== adoptionFormId) throw new PetAlreadyAdoptedException(pet.name);
    }
    await this.petRepository.manager.transaction(async (manager) => {
      await manager.getRepository(Pet).update({ id, organizationId }, { ...data, updatedBy });
      await manager.getRepository(AdoptionForm).update(form.id, { petId: id, updatedBy });
      // Pet anterior da ficha volta a ficar disponível, se nenhuma outra ficha ativa o segura
      if (form.petId && form.petId !== id) {
        const held = await manager
          .getRepository(AdoptionForm)
          .count({ where: { petId: form.petId, id: Not(form.id), isActive: true, status: Not(In([AdoptionFormStatus.REPROVADO, AdoptionFormStatus.PENDENTE])) } });
        if (!held) await manager.getRepository(Pet).update({ id: form.petId, organizationId, status: PetStatus.EM_PROCESSO }, { status: PetStatus.DISPONIVEL, updatedBy });
      }
    });
    return this.findOne(id, organizationId);
  }

  // Ficha concluída que adotou cada pet ADOTADO, em uma consulta para a lista toda (sem N+1)
  private async adoptersOf(pets: Pet[]) {
    const adopted = pets.filter((pet) => pet.status === PetStatus.ADOTADO).map((pet) => pet.id);
    const result = new Map<string, { formId: string; name: string }>();
    if (!adopted.length) return result;
    const forms = await this.formRepository.find({
      select: { id: true, petId: true, fullName: true },
      where: { petId: In(adopted), status: AdoptionFormStatus.CONCLUIDA, isActive: true },
      order: { updatedAt: 'DESC' },
    });
    forms.forEach((form) => result.has(form.petId) || result.set(form.petId, { formId: form.id, name: form.fullName }));
    return result;
  }

  async remove(id: string, organizationId: string, updatedBy: string = null) {
    await this.assertOwned(id, organizationId);
    await this.petRepository.update({ id, organizationId }, { isActive: false, updatedBy });
    return { message: 'Pet desativado com sucesso.' };
  }

  async addPhotos(petId: string, files: Express.Multer.File[], organizationId: string, createdBy: string = null) {
    if (!files?.length) throw new BadRequestException('Envie ao menos uma foto no campo "photos".');

    const invalid = files.find((file) => !ALLOWED_PHOTO_TYPES.includes(file.mimetype));
    if (invalid) throw new BadRequestException('Formato inválido. Envie apenas imagens JPEG, PNG ou WEBP.');

    const pet = await this.petRepository.findOne({ where: { id: petId, organizationId, isActive: true } });
    if (!pet) throw new NotFoundException('Pet não encontrado.');

    const current = await this.photoRepository.count({ where: { petId } });
    if (current + files.length > MAX_PET_PHOTOS) {
      throw new BadRequestException(
        `O pet pode ter no máximo ${MAX_PET_PHOTOS} fotos. Atualmente possui ${current}, restam ${MAX_PET_PHOTOS - current}.`,
      );
    }

    const uploaded: { path: string; url: string }[] = [];
    try {
      for (const file of files) {
        const path = `${petId}/${randomUUID()}${extname(file.originalname).toLowerCase()}`;
        const url = await this.storageService.upload(path, file.buffer, file.mimetype);
        uploaded.push({ path, url });
      }
      const photos = this.photoRepository.create(
        uploaded.map(({ path, url }) => ({ petId, url, storagePath: path, createdBy })),
      );
      await this.photoRepository.save(photos);
    } catch (error) {
      // Evita arquivos órfãos no bucket caso algum upload ou o insert falhe
      await this.storageService.remove(uploaded.map((u) => u.path)).catch(() => undefined);
      throw error;
    }

    return this.findOne(petId, organizationId);
  }

  async removePhoto(petId: string, photoId: string, organizationId: string) {
    await this.assertOwned(petId, organizationId);
    const photo = await this.photoRepository.findOne({ where: { id: photoId, petId } });
    if (!photo) throw new NotFoundException('Foto não encontrada.');
    await this.storageService.remove([photo.storagePath]);
    await this.photoRepository.delete(photo.id);
    return { message: 'Foto removida com sucesso.' };
  }

  private async assertOwned(id: string, organizationId: string) {
    if (!(await this.petRepository.findOne({ where: { id, organizationId }, select: { id: true } }))) throw new NotFoundException('Pet não encontrado.');
  }

  // Busca por nome ou raça: array no where vira OR, mantendo os demais filtros em cada ramo
  private searchWhere(base: Record<string, unknown>, rawSearch?: string) {
    const search = rawSearch?.trim();
    if (!search) return base;
    return [
      { ...base, name: ILike(`%${search}%`) },
      { ...base, animal: ILike(`%${search}%`) },
    ];
  }

  // Idade sempre calculada na hora a partir do mês/ano de nascimento
  private withAge<T extends Pick<Pet, 'birthDate'>>(pet: T) {
    // `age` é legado: o retorno do save traz a coluna mesmo com select: false
    const { age: _legacyAge, ...rest } = pet as T & { age?: number };
    return { ...rest, ageLabel: petAgeLabel(pet.birthDate ?? null) };
  }

  private sortPhotos(pet: Pet) {
    pet.fotos?.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    return pet;
  }
}
