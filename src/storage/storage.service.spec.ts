import { InternalServerErrorException } from '@nestjs/common';
import { join } from 'path';
import { mkdir, rm, writeFile } from 'fs/promises';
import { createClient } from '@supabase/supabase-js';
import { LOCAL_UPLOADS_DIR, StorageService } from './storage.service';

jest.mock('fs/promises', () => ({
  mkdir: jest.fn(async () => undefined),
  writeFile: jest.fn(async () => undefined),
  rm: jest.fn(async () => undefined),
}));
jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn() }));

const ENV_KEYS = ['STORAGE_DRIVER', 'API_URL', 'PORT', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_STORAGE_BUCKET', 'SUPABASE_ADOPTION_BUCKET'];

describe('StorageService', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.clearAllMocks();
    ENV_KEYS.forEach((key) => delete process.env[key]);
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('driver local (STORAGE_DRIVER=local)', () => {
    beforeEach(() => {
      process.env.STORAGE_DRIVER = 'local';
    });

    it('grava em ./uploads e devolve a URL servida pela API', async () => {
      process.env.API_URL = 'http://api.local';

      const url = await new StorageService().upload('pets/p1/a.png', Buffer.from('x'), 'image/png');

      expect(mkdir).toHaveBeenCalledWith(join(LOCAL_UPLOADS_DIR, 'pets', 'p1'), { recursive: true });
      expect(writeFile).toHaveBeenCalledWith(join(LOCAL_UPLOADS_DIR, 'pets/p1/a.png'), Buffer.from('x'));
      expect(url).toBe('http://api.local/uploads/pets/p1/a.png');
      expect(createClient).not.toHaveBeenCalled();
    });

    it('usa localhost:PORT quando API_URL não está definida', async () => {
      process.env.PORT = '3100';

      expect(await new StorageService().upload('a.png', Buffer.from('x'), 'image/png')).toBe('http://localhost:3100/uploads/a.png');
    });

    it('converte falha de disco em erro 500', async () => {
      (writeFile as jest.Mock).mockRejectedValueOnce(new Error('EACCES'));

      await expect(new StorageService().upload('a.png', Buffer.from('x'), 'image/png')).rejects.toThrow(InternalServerErrorException);
    });

    it('remove os arquivos do disco', async () => {
      await new StorageService().remove(['a.png', 'b/c.png']);

      expect(rm).toHaveBeenCalledWith(join(LOCAL_UPLOADS_DIR, 'a.png'), { force: true });
      expect(rm).toHaveBeenCalledWith(join(LOCAL_UPLOADS_DIR, 'b/c.png'), { force: true });
    });

    it('arquivos privados também vão para ./uploads e o link é a própria URL local', async () => {
      process.env.API_URL = 'http://api.local';
      const service = new StorageService();

      await service.uploadPrivate('adoption-forms/f1/a.png', Buffer.from('x'), 'image/png');
      await service.removePrivate(['adoption-forms/f1/a.png']);

      expect(writeFile).toHaveBeenCalledWith(join(LOCAL_UPLOADS_DIR, 'adoption-forms/f1/a.png'), Buffer.from('x'));
      expect(rm).toHaveBeenCalledWith(join(LOCAL_UPLOADS_DIR, 'adoption-forms/f1/a.png'), { force: true });
      expect(await service.getSignedUrls(['adoption-forms/f1/a.png'])).toEqual({
        'adoption-forms/f1/a.png': 'http://api.local/uploads/adoption-forms/f1/a.png',
      });
      expect(createClient).not.toHaveBeenCalled();
    });
  });

  describe('driver Supabase (padrão)', () => {
    let bucket: { upload: jest.Mock; getPublicUrl: jest.Mock; remove: jest.Mock; createSignedUrls: jest.Mock };
    let from: jest.Mock;

    beforeEach(() => {
      process.env.SUPABASE_URL = 'https://proj.supabase.co';
      process.env.SUPABASE_SERVICE_ROLE_KEY = 'key';
      bucket = {
        upload: jest.fn(async () => ({ error: null })),
        getPublicUrl: jest.fn((path: string) => ({ data: { publicUrl: `https://cdn/${path}` } })),
        remove: jest.fn(async () => ({ error: null })),
        createSignedUrls: jest.fn(async (paths: string[]) => ({
          data: paths.map((path) => ({ path, signedUrl: `https://signed/${path}`, error: null })),
          error: null,
        })),
      };
      from = jest.fn(() => bucket);
      (createClient as jest.Mock).mockReturnValue({ storage: { from } });
    });

    it('falha com 500 quando as variáveis não estão configuradas', async () => {
      delete process.env.SUPABASE_URL;

      await expect(new StorageService().upload('a.png', Buffer.from('x'), 'image/png')).rejects.toThrow('Storage não configurado.');
    });

    it('envia ao bucket e devolve a URL pública', async () => {
      const service = new StorageService();

      const url = await service.upload('a.png', Buffer.from('x'), 'image/png');

      expect(bucket.upload).toHaveBeenCalledWith('a.png', Buffer.from('x'), { contentType: 'image/png', upsert: false });
      expect(url).toBe('https://cdn/a.png');
    });

    it('cria o cliente uma única vez', async () => {
      const service = new StorageService();

      await service.upload('a.png', Buffer.from('x'), 'image/png');
      await service.remove(['a.png']);

      expect(createClient).toHaveBeenCalledTimes(1);
    });

    it('converte erro do Supabase em erro 500', async () => {
      bucket.upload.mockResolvedValue({ error: { message: 'quota' } });
      bucket.remove.mockResolvedValue({ error: { message: 'quota' } });
      const service = new StorageService();

      await expect(service.upload('a.png', Buffer.from('x'), 'image/png')).rejects.toThrow('Falha ao enviar arquivo.');
      await expect(service.remove(['a.png'])).rejects.toThrow('Falha ao remover arquivo.');
    });

    it('remove sem chamar o Supabase quando a lista está vazia', async () => {
      await new StorageService().remove([]);
      await new StorageService().removePrivate([]);
      expect(await new StorageService().getSignedUrls([])).toEqual({});

      expect(createClient).not.toHaveBeenCalled();
    });

    describe('bucket privado (fichas de adoção)', () => {
      it('usa o bucket adoption-forms por padrão e não gera URL pública', async () => {
        const service = new StorageService();

        const result = await service.uploadPrivate('a.png', Buffer.from('x'), 'image/png');

        expect(from).toHaveBeenCalledWith('adoption-forms');
        expect(bucket.upload).toHaveBeenCalledWith('a.png', Buffer.from('x'), { contentType: 'image/png', upsert: false });
        expect(bucket.getPublicUrl).not.toHaveBeenCalled();
        expect(result).toBeUndefined();
      });

      it('respeita SUPABASE_ADOPTION_BUCKET e não mexe no bucket dos pets', async () => {
        process.env.SUPABASE_ADOPTION_BUCKET = 'fichas';
        const service = new StorageService();

        await service.removePrivate(['a.png']);
        await service.upload('b.png', Buffer.from('x'), 'image/png');

        expect(from.mock.calls.map(([name]) => name)).toEqual(['fichas', 'pet-photos']);
      });

      it('gera URLs assinadas de 1 hora e ignora arquivos que não existem', async () => {
        bucket.createSignedUrls.mockResolvedValue({
          data: [
            { path: 'a.png', signedUrl: 'https://signed/a.png', error: null },
            { path: 'antiga.png', signedUrl: null, error: 'Object not found' },
          ],
          error: null,
        });

        const urls = await new StorageService().getSignedUrls(['a.png', 'antiga.png']);

        expect(bucket.createSignedUrls).toHaveBeenCalledWith(['a.png', 'antiga.png'], 3600);
        expect(urls).toEqual({ 'a.png': 'https://signed/a.png' });
      });

      it('converte erro do Supabase em erro 500', async () => {
        bucket.upload.mockResolvedValue({ error: { message: 'quota' } });
        bucket.remove.mockResolvedValue({ error: { message: 'quota' } });
        bucket.createSignedUrls.mockResolvedValue({ data: null, error: { message: 'quota' } });
        const service = new StorageService();

        await expect(service.uploadPrivate('a.png', Buffer.from('x'), 'image/png')).rejects.toThrow('Falha ao enviar arquivo.');
        await expect(service.removePrivate(['a.png'])).rejects.toThrow('Falha ao remover arquivo.');
        await expect(service.getSignedUrls(['a.png'])).rejects.toThrow('Falha ao gerar links dos arquivos.');
      });
    });
  });
});
