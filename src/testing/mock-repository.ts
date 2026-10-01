// Repositório TypeORM falso para testes unitários dos services (só os métodos usados no projeto)
export type MockRepository = {
  create: jest.Mock;
  save: jest.Mock;
  findOne: jest.Mock;
  find: jest.Mock;
  findAndCount: jest.Mock;
  update: jest.Mock;
  delete: jest.Mock;
  count: jest.Mock;
  remove: jest.Mock;
};

export const createMockRepository = (): MockRepository => ({
  create: jest.fn((data) => data),
  save: jest.fn(async (data) => data),
  findOne: jest.fn(),
  find: jest.fn(),
  findAndCount: jest.fn(async () => [[], 0]),
  update: jest.fn(),
  delete: jest.fn(),
  count: jest.fn(),
  remove: jest.fn(),
});

export const pagination = { page: 1, limit: 10 };
