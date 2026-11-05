import { hideSensitiveUserData } from './user.service';

describe('hideSensitiveUserData', () => {
  it('remove CPF, telefone, nascimento e dados do responsável e mantém o resto', () => {
    const result = hideSensitiveUserData({ id: 'u1', fullName: 'Ana', cpf: '1', phone: '2', birthDate: '2000-01-01', guardianName: 'x', guardianPhone: 'y', guardianConsentAt: new Date() });
    expect(result).toEqual({ id: 'u1', fullName: 'Ana' });
  });
});
