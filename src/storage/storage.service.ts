import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

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
    const storage = this.getClient().storage.from(this.bucket);
    const { error } = await storage.upload(path, buffer, { contentType, upsert: false });
    if (error) throw new InternalServerErrorException('Falha ao enviar arquivo.');
    return storage.getPublicUrl(path).data.publicUrl;
  }

  async remove(paths: string[]) {
    if (!paths.length) return;
    const { error } = await this.getClient().storage.from(this.bucket).remove(paths);
    if (error) throw new InternalServerErrorException('Falha ao remover arquivo.');
  }
}
