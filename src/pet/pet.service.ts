import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsOrder, Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { extname } from 'path';
import { Pet } from './pet.entity';
import { PetPhoto } from './pet-photo.entity';
import { CreatePetDto } from './dto/create-pet.dto';
import { PaginationDto } from '../common/pagination.dto';
import { paginate } from '../common/paginate.helper';
import { StorageService } from '../storage/storage.service';

export const MAX_PET_PHOTOS = 10;
export const MAX_PHOTO_SIZE = 5 * 1024 * 1024;
const ALLOWED_PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

@Injectable()
export class PetService {
  constructor(
    @InjectRepository(Pet)
    private readonly petRepository: Repository<Pet>,
    @InjectRepository(PetPhoto)
    private readonly photoRepository: Repository<PetPhoto>,
    private readonly storageService: StorageService,
  ) {}

  async create(dto: CreatePetDto, createdBy: string = null) {
    const pet = this.petRepository.create({ ...dto, createdBy, updatedBy: createdBy });
    const saved = await this.petRepository.save(pet);
    return { ...saved, fotos: [] };
  }

  async findAll(
    pagination: PaginationDto,
    filters: { organizationId?: string; species?: string; sex?: string; size?: string; castration?: string; status?: string } = {},
    order?: FindOptionsOrder<Pet>,
  ) {
    const where: any = { isActive: true };
    if (filters.organizationId) where.organizationId = filters.organizationId;
    if (filters.species) where.species = filters.species;
    if (filters.sex) where.sex = filters.sex;
    if (filters.size) where.size = filters.size;
    if (filters.castration !== undefined) where.castration = filters.castration === 'true';
    if (filters.status) where.status = filters.status;
    const result = await paginate(this.petRepository, pagination, where, { fotos: true }, order);
    result.data.forEach((pet) => this.sortPhotos(pet));
    return result;
  }

  // Versão para o site público: só os campos exibidos, sem dados internos nem storagePath
  async findAllPublic(pagination: PaginationDto, filters: { organizationId?: string; species?: string; sex?: string; size?: string; castration?: string; status?: string } = {}) {
    // Ordem por nome: a lista alimenta o select de animais do formulário de adoção
    const result = await this.findAll(pagination, filters, { name: 'ASC' });
    return {
      ...result,
      data: result.data.map((pet) => ({
        id: pet.id,
        name: pet.name,
        species: pet.species,
        animal: pet.animal ?? null,
        sex: pet.sex,
        age: pet.age,
        size: pet.size,
        castration: pet.castration,
        about: pet.about,
        fotos: (pet.fotos ?? []).map((foto) => ({ url: foto.url })),
      })),
    };
  }

  async findOne(id: string) {
    const pet = await this.petRepository.findOne({ where: { id }, relations: { fotos: true } });
    if (!pet) throw new NotFoundException('Pet não encontrado.');
    return this.sortPhotos(pet);
  }

  async update(id: string, dto: Partial<CreatePetDto>, updatedBy: string = null) {
    // Fotos são gerenciadas pelos endpoints próprios; ignora caso o front reenvie o objeto completo
    const { fotos, ...data } = dto as Partial<CreatePetDto> & { fotos?: unknown };
    await this.petRepository.update(id, { ...data, updatedBy });
    return this.findOne(id);
  }

  async remove(id: string, updatedBy: string = null) {
    const pet = await this.petRepository.findOne({ where: { id } });
    if (!pet) throw new NotFoundException('Pet não encontrado.');
    await this.petRepository.update(id, { isActive: false, updatedBy });
    return { message: 'Pet desativado com sucesso.' };
  }

  async addPhotos(petId: string, files: Express.Multer.File[], createdBy: string = null) {
    if (!files?.length) throw new BadRequestException('Envie ao menos uma foto no campo "photos".');

    const invalid = files.find((file) => !ALLOWED_PHOTO_TYPES.includes(file.mimetype));
    if (invalid) throw new BadRequestException('Formato inválido. Envie apenas imagens JPEG, PNG ou WEBP.');

    const pet = await this.petRepository.findOne({ where: { id: petId, isActive: true } });
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

    return this.findOne(petId);
  }

  async removePhoto(petId: string, photoId: string) {
    const photo = await this.photoRepository.findOne({ where: { id: photoId, petId } });
    if (!photo) throw new NotFoundException('Foto não encontrada.');
    await this.storageService.remove([photo.storagePath]);
    await this.photoRepository.delete(photo.id);
    return { message: 'Foto removida com sucesso.' };
  }

  private sortPhotos(pet: Pet) {
    pet.fotos?.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    return pet;
  }
}
