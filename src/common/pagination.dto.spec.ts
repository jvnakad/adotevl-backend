import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PaginationDto } from './pagination.dto';

const parse = async (query: Record<string, string>) => {
  const dto = plainToInstance(PaginationDto, query);
  return { dto, errors: await validate(dto) };
};

describe('PaginationDto', () => {
  it('usa page 1 e limit 10 por padrão', async () => {
    const { dto, errors } = await parse({});
    expect(errors).toHaveLength(0);
    expect(dto).toMatchObject({ page: 1, limit: 10 });
  });

  it('aceita limit 100', async () => {
    const { dto, errors } = await parse({ limit: '100' });
    expect(errors).toHaveLength(0);
    expect(dto.limit).toBe(100);
  });

  it.each(['101', '500', '100000'])('limita limit=%s a 100 sem erro', async (limit) => {
    const { dto, errors } = await parse({ limit });
    expect(errors).toHaveLength(0);
    expect(dto.limit).toBe(100);
  });

  it.each(['0', '-1', '2.5', 'abc'])('continua recusando limit=%s', async (limit) => {
    const { errors } = await parse({ limit });
    expect(errors.map((e) => e.property)).toContain('limit');
  });
});
