import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { mkdir, writeFile, rm } from 'fs/promises';
import { dirname, join } from 'path';

export const LOCAL_UPLOADS_DIR = join(process.cwd(), 'uploads');
export const isLocalStorage = () => process.env.STORAGE_DRIVER === 'local';

@Injectable()
export class StorageService {
  private client: SupabaseClient;
  private readonly bucket = process.env.SUPABASE_STORAGE_BUCKET || 'pet-photos';

  // Cliente criado sob demanda para o app subir mesmo sem as variáveis do Supabase configuradas
  private getClient() {
    if (!this.client) {
      const url = process.env.SUPABASE_URL;
      const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (!url || !key) {
        throw new InternalServerErrorException('Storage não configurado.');
      }
      this.client = createClient(url, key, { auth: { persistSession: false } });
    }
    return this.client;
  }

  async upload(path: string, buffer: Buffer, contentType: string) {
    if (isLocalStorage()) return this.uploadLocal(path, buffer);
    const storage = this.getClient().storage.from(this.bucket);
    const { error } = await storage.upload(path, buffer, { contentType, upsert: false });
    if (error) throw new InternalServerErrorException('Falha ao enviar arquivo.');
    return storage.getPublicUrl(path).data.publicUrl;
  }

  async remove(paths: string[]) {
    if (!paths.length) return;
    if (isLocalStorage()) return this.removeLocal(paths);
    const { error } = await this.getClient().storage.from(this.bucket).remove(paths);
    if (error) throw new InternalServerErrorException('Falha ao remover arquivo.');
  }

  // Driver local (STORAGE_DRIVER=local): grava em ./uploads e serve em /uploads (ver main.ts)
  private async uploadLocal(path: string, buffer: Buffer) {
    const target = join(LOCAL_UPLOADS_DIR, path);
    try {
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, buffer);
    } catch {
      throw new InternalServerErrorException('Falha ao enviar arquivo.');
    }
    const baseUrl = process.env.API_URL || `http://localhost:${process.env.PORT || 3000}`;
    return `${baseUrl}/uploads/${path}`;
  }

  private async removeLocal(paths: string[]) {
    await Promise.all(paths.map((path) => rm(join(LOCAL_UPLOADS_DIR, path), { force: true })));
  }
}
