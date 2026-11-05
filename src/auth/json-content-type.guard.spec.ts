import { ExecutionContext, UnsupportedMediaTypeException } from '@nestjs/common';
import { JsonContentTypeGuard } from './json-content-type.guard';

const contextFor = (headers: Record<string, unknown>) => ({ switchToHttp: () => ({ getRequest: () => ({ headers }) }) }) as unknown as ExecutionContext;

describe('JsonContentTypeGuard (SEC-BUG-03)', () => {
  const guard = new JsonContentTypeGuard();

  it.each(['application/json', 'application/json; charset=utf-8', 'Application/JSON', ' application/json ;charset=UTF-8'])('aceita %p', (value) => {
    expect(guard.canActivate(contextFor({ 'content-type': value }))).toBe(true);
  });

  it.each([
    ['form urlencoded', { 'content-type': 'application/x-www-form-urlencoded' }],
    ['text/plain', { 'content-type': 'text/plain' }],
    ['multipart', { 'content-type': 'multipart/form-data; boundary=x' }],
    ['json-like', { 'content-type': 'application/jsonx' }],
    ['sem Content-Type', {}],
    ['vazio', { 'content-type': '' }],
  ])('recusa %s com 415', (_label, headers) => {
    expect(() => guard.canActivate(contextFor(headers))).toThrow(new UnsupportedMediaTypeException('Content-Type deve ser application/json.'));
  });
});
