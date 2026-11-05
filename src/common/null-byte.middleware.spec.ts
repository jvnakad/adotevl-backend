import { BadRequestException } from '@nestjs/common';
import { containsNullByte, NULL_BYTE_MESSAGE, NullByteMiddleware } from './null-byte.middleware';

describe('NullByteMiddleware', () => {
  const middleware = new NullByteMiddleware();

  describe('containsNullByte', () => {
    it.each([
      ['texto', 'a\u0000b', true],
      ['objeto aninhado', { a: { b: ['x', 'y\u0000'] } }, true],
      ['chave', { 'a\u0000b': 1 }, true],
      ['texto normal', 'Ração 100% / \\ _ ç', false],
      ['objeto sem nulo', { name: 'Ração', n: 1, ok: true, x: null, list: [1, 'a'] }, false],
      ['vazio', undefined, false],
    ])('%s', (_label, value, expected) => {
      expect(containsNullByte(value)).toBe(expected);
    });
  });

  it('segue em frente quando query e corpo são válidos', () => {
    const next = jest.fn();
    middleware.use({ query: { search: 'racao', limit: '10' }, body: { name: 'Ração' } }, {}, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('recusa byte nulo na query com 400 em PT-BR', () => {
    const next = jest.fn();
    expect(() => middleware.use({ query: { search: 'a\u0000b' }, body: {} }, {}, next)).toThrow(new BadRequestException(NULL_BYTE_MESSAGE));
    expect(next).not.toHaveBeenCalled();
  });

  it('recusa byte nulo no corpo', () => {
    expect(() => middleware.use({ query: {}, body: { notes: 'x\u0000' } }, {}, jest.fn())).toThrow(BadRequestException);
  });
});
