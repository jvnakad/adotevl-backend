import { BadRequestException } from '@nestjs/common';
import { ProductUnit } from './product.entity';
import { formatQuantity, parseQuantity } from './stock-quantity';

describe('parseQuantity', () => {
  const recusa = (raw: unknown, unit: ProductUnit, message: string) =>
    expect(() => parseQuantity(raw, unit)).toThrow(new BadRequestException(message));

  it.each([
    ['10', ProductUnit.KG, '10.000'],
    [10, ProductUnit.UNIT, '10.000'],
    ['2.5', ProductUnit.LITER, '2.500'],
    [2.5, ProductUnit.KG, '2.500'],
    ['1250.500', ProductUnit.KG, '1250.500'],
    ['0', ProductUnit.UNIT, '0.000'],
    [0, ProductUnit.KG, '0.000'],
    ['-0', ProductUnit.KG, '0.000'],
    ['007', ProductUnit.UNIT, '7.000'],
    ['2.000', ProductUnit.UNIT, '2.000'], // zeros decimais em UNIT são inteiro
    ['999999999.999', ProductUnit.KG, '999999999.999'],
    ['999999999', ProductUnit.UNIT, '999999999.000'],
  ])('aceita %j em %s e devolve %s', (raw, unit, expected) => {
    expect(parseQuantity(raw, unit)).toBe(expected);
  });

  it.each([undefined, null, '', '   '])('exige a quantidade (%j)', (raw) => {
    recusa(raw, ProductUnit.KG, 'Informe a quantidade.');
  });

  it.each(['abc', '1,5', '1e3', '.5', '5.', '1 000', true, {}, [1]])('recusa formato inválido (%j)', (raw) => {
    recusa(raw, ProductUnit.KG, 'Quantidade inválida. Use apenas números, com ponto como separador decimal.');
  });

  it('recusa número em notação científica', () => {
    recusa(1e21, ProductUnit.KG, 'Quantidade inválida. Use apenas números, com ponto como separador decimal.');
    recusa(1e-7, ProductUnit.KG, 'Quantidade inválida. Use apenas números, com ponto como separador decimal.');
  });

  it.each(['-1', -1, '-0.001'])('recusa negativa (%j)', (raw) => {
    recusa(raw, ProductUnit.KG, 'A quantidade não pode ser negativa.');
  });

  it.each(['1.2345', '1.2340', '0.0001'])('recusa mais de 3 casas sem arredondar (%j)', (raw) => {
    recusa(raw, ProductUnit.KG, 'A quantidade pode ter no máximo 3 casas decimais.');
  });

  it.each(['2.5', 2.5, '0.001'])('recusa decimal em UNIT (%j)', (raw) => {
    recusa(raw, ProductUnit.UNIT, 'Quantidade em unidade deve ser um número inteiro.');
  });

  it.each(['1000000000', '1000000000.000', '12345678901'])('recusa acima do máximo (%j)', (raw) => {
    recusa(raw, ProductUnit.KG, 'A quantidade máxima é 999999999,999.');
  });

  it('a mesma quantidade em unidades diferentes segue a regra da unidade', () => {
    expect(parseQuantity('2.5', ProductUnit.KG)).toBe('2.500');
    expect(() => parseQuantity('2.5', ProductUnit.UNIT)).toThrow(BadRequestException);
  });
});

describe('formatQuantity', () => {
  it.each([
    ['10.000', ProductUnit.UNIT, '10 un'],
    ['2.500', ProductUnit.KG, '2,500 kg'],
    ['1.000', ProductUnit.LITER, '1,000 L'],
    ['1250.500', ProductUnit.KG, '1250,500 kg'], // sem separador de milhar
    ['1250.000', ProductUnit.UNIT, '1250 un'],
    ['0.000', ProductUnit.KG, '0,000 kg'],
  ])('formata %s %s como "%s"', (quantity, unit, expected) => {
    expect(formatQuantity(quantity, unit)).toBe(expected);
  });
});
