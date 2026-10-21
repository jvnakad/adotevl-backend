import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { buildCardFilter } from './marketing-card-filter';
import { FindMarketingBoardDto, FindMarketingCardsDto } from './dto/marketing-query.dto';

const UUID_A = '3f2b8c1e-1a2b-4c3d-8e4f-5a6b7c8d9e0f';
const UUID_B = '4a2b8c1e-1a2b-4c3d-8e4f-5a6b7c8d9e0f';

describe('buildCardFilter', () => {
  it('sem filtros: nada a acrescentar', () => {
    const params: unknown[] = ['org'];

    expect(buildCardFilter({}, params)).toBe('');
    expect(params).toEqual(['org']);
  });

  it('numera os parâmetros a partir do que já existe e combina tudo com AND', () => {
    const params: unknown[] = ['org'];

    const sql = buildCardFilter({ q: 'Ação', listIds: [UUID_A], memberIds: [UUID_A, UUID_B], labelIds: [UUID_B], dueFrom: '2026-12-01', dueTo: '2026-12-31' }, params);

    expect(sql.startsWith(' AND ')).toBe(true);
    expect(sql).toContain('c.title_normalized LIKE $2');
    expect(sql).toContain('c.list_id = ANY($3::uuid[])');
    expect(sql).toContain('fm.user_id = ANY($4::uuid[])');
    expect(sql).toContain('fl.label_id = ANY($5::uuid[])');
    expect(sql).toContain('c.due_date >= $6::date');
    expect(sql).toContain('c.due_date <= $7::date');
    // título normalizado: sem acento e minúsculo
    expect(params).toEqual(['org', '%acao%', [UUID_A], [UUID_A, UUID_B], [UUID_B], '2026-12-01', '2026-12-31']);
  });

  it('só considera etiquetas ativas no filtro de etiqueta', () => {
    expect(buildCardFilter({ labelIds: [UUID_A] }, [])).toContain('ml.is_active = true');
  });

  it('criação usa o dia de Brasília: início 00:00-03:00 e fim exclusivo no dia seguinte', () => {
    const params: unknown[] = [];

    const sql = buildCardFilter({ createdFrom: '2026-10-20', createdTo: '2026-10-20' }, params);

    expect(sql).toContain('c.created_at >= $1');
    expect(sql).toContain('c.created_at < $2');
    expect((params[0] as Date).toISOString()).toBe('2026-10-20T03:00:00.000Z');
    expect((params[1] as Date).toISOString()).toBe('2026-10-21T03:00:00.000Z');
  });

  it('without escolhe a coluna sem valor', () => {
    expect(buildCardFilter({ without: 'due' as any }, [])).toContain('c.due_date IS NULL');
    expect(buildCardFilter({ without: 'publish' as any }, [])).toContain('c.publish_date IS NULL');
  });

  it('intervalo invertido é 400', () => {
    expect(() => buildCardFilter({ dueFrom: '2026-12-02', dueTo: '2026-12-01' }, [])).toThrow(BadRequestException);
    expect(() => buildCardFilter({ publishFrom: '2026-12-02', publishTo: '2026-12-01' }, [])).toThrow(BadRequestException);
    expect(() => buildCardFilter({ createdFrom: '2026-12-02', createdTo: '2026-12-01' }, [])).toThrow(BadRequestException);
  });
});

describe('DTOs de filtro e paginação', () => {
  const errorsOf = async (cls: any, plain: object) => (await validate(plainToInstance(cls, plain))).flatMap((e) => Object.values(e.constraints ?? {}));

  it('listas aceitam vírgula, valor único e repetido', () => {
    expect(plainToInstance(FindMarketingBoardDto, { memberIds: `${UUID_A},${UUID_B}` }).memberIds).toEqual([UUID_A, UUID_B]);
    expect(plainToInstance(FindMarketingBoardDto, { labelIds: UUID_A }).labelIds).toEqual([UUID_A]);
    expect(plainToInstance(FindMarketingBoardDto, { listIds: [UUID_A, UUID_B] }).listIds).toEqual([UUID_A, UUID_B]);
  });

  it('recusa ids e datas inválidos, com mensagem', async () => {
    expect(await errorsOf(FindMarketingBoardDto, { memberIds: 'abc' })).toEqual(['Membro inválido.']);
    expect(await errorsOf(FindMarketingBoardDto, { dueFrom: '2026-02-31' })).toEqual(['Informe o prazo inicial no formato YYYY-MM-DD.']);
    expect(await errorsOf(FindMarketingBoardDto, { q: 'a'.repeat(151) })).toEqual(['Busca deve ter no máximo 150 caracteres.']);
  });

  it('limit do quadro: 1 a 100 (acima vira 100)', async () => {
    expect(plainToInstance(FindMarketingBoardDto, { limit: '500' }).limit).toBe(100);
    expect(await errorsOf(FindMarketingBoardDto, { limit: '0' })).toHaveLength(1);
  });

  it('a Lista herda os filtros e a paginação', async () => {
    const dto = plainToInstance(FindMarketingCardsDto, { page: '2', limit: '50', q: 'x', labelIds: UUID_A, without: 'due' });

    expect(dto).toMatchObject({ page: 2, limit: 50, q: 'x', labelIds: [UUID_A], without: 'due' });
    expect(await validate(dto)).toEqual([]);
  });
});
