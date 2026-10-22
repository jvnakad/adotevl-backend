// Ambiente dos testes unitários: o segredo do JWT é obrigatório (sem fallback no código)
process.env.JWT_SECRET = process.env.JWT_SECRET || 'unit-test-secret';
