import { createHmac, timingSafeEqual } from 'crypto';
import { extname } from 'path';

// Driver local: anexos do Marketing ficam em ./uploads/marketing e só abrem com link assinado (como o bucket privado)
export const LOCAL_PRIVATE_PREFIX = 'marketing/';
const LOCAL_SIGNATURE_SECRET = () => `${process.env.JWT_SECRET || 'changeme'}:uploads`;

export const isLocalPrivatePath = (path: string) => path.startsWith(LOCAL_PRIVATE_PREFIX);

const sign = (path: string, exp: number) => createHmac('sha256', LOCAL_SIGNATURE_SECRET()).update(`${path}\n${exp}`).digest('hex');

/** Query `?exp=<epoch s>&sig=<hmac>` do link assinado de um arquivo privado do driver local. */
export function localSignatureQuery(path: string, expiresInSeconds: number, now = Date.now()) {
  const exp = Math.floor(now / 1000) + expiresInSeconds;
  return `exp=${exp}&sig=${sign(path, exp)}`;
}

export function verifyLocalSignature(path: string, exp: string | undefined, sig: string | undefined, now = Date.now()) {
  const expiry = Number(exp);
  if (!Number.isInteger(expiry) || typeof sig !== 'string' || expiry < Math.floor(now / 1000)) return false;
  const expected = Buffer.from(sign(path, expiry));
  const received = Buffer.from(sig);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

// Só imagens raster e PDF abrem no navegador; o resto baixa
const INLINE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.pdf']);

/** Middleware de `/uploads` (driver local): nosniff sempre; arquivo do Marketing exige link assinado e baixa como anexo. */
export function localUploadsMiddleware(req: any, res: any, next: () => void) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  let path: string;
  try {
    path = decodeURIComponent(String(req.path ?? '')).replace(/^\/+/, '');
  } catch {
    return res.status(400).end();
  }
  if (!isLocalPrivatePath(path)) return next();
  if (path.includes('..') || !verifyLocalSignature(path, req.query?.exp, req.query?.sig)) return res.status(403).json({ statusCode: 403, message: 'Link inválido ou expirado.', error: 'Forbidden' });
  res.setHeader('Content-Disposition', INLINE_EXTENSIONS.has(extname(path).toLowerCase()) ? 'inline' : 'attachment');
  res.setHeader('Cache-Control', 'private, no-store');
  next();
}
