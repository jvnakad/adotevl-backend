import { ConflictException } from '@nestjs/common';
import { indexFromNeighbours, orderWith, planPosition, resolvePosition } from './marketing-position';

describe('planPosition', () => {
  it('lista vazia: primeira posição é 1024', () => {
    expect(planPosition([], 0)).toEqual({ position: 1024 });
  });

  it('fim da lista: último + 1024', () => {
    expect(planPosition([1024, 2048], 2)).toEqual({ position: 3072 });
  });

  it('índice acima do tamanho vale o fim', () => {
    expect(planPosition([1024], 99)).toEqual({ position: 2048 });
  });

  it('início da lista: meio entre 0 e o primeiro', () => {
    expect(planPosition([1024, 2048], 0)).toEqual({ position: 512 });
  });

  it('meio da lista: ponto médio entre os vizinhos (arredondado para baixo)', () => {
    expect(planPosition([1024, 2048, 3072], 1)).toEqual({ position: 1536 });
    expect(planPosition([10, 13], 1)).toEqual({ position: 11 });
  });

  it('sem espaço entre os vizinhos pede renumeração', () => {
    expect(planPosition([10, 11], 1)).toEqual({ renumber: true });
    expect(planPosition([1, 5], 0)).toEqual({ renumber: true });
  });

  it('estouro do inteiro no fim pede renumeração', () => {
    expect(planPosition([2147483000], 1)).toEqual({ renumber: true });
  });

  it('índice negativo vale o início', () => {
    expect(planPosition([1024], -3)).toEqual({ position: 512 });
  });
});

describe('orderWith', () => {
  it('insere o item movido no índice pedido', () => {
    expect(orderWith(['a', 'b', 'c'], 'x', 1)).toEqual(['a', 'x', 'b', 'c']);
    expect(orderWith(['a', 'b'], 'x', 9)).toEqual(['a', 'b', 'x']);
  });

  it('sem item movido mantém a ordem', () => {
    expect(orderWith(['a', 'b'], null, 1)).toEqual(['a', 'b']);
  });
});

describe('resolvePosition', () => {
  const makeManager = () => ({ query: jest.fn(async () => undefined) });

  it('com espaço não escreve nada: devolve só a posição', async () => {
    const manager = makeManager();

    const result = await resolvePosition(manager as any, 'marketing_cards', [{ id: 'a', position: 1024 }], 'x', 0);

    expect(result).toEqual({ position: 512, renumbered: false });
    expect(manager.query).not.toHaveBeenCalled();
  });

  it('sem espaço renumera o escopo inteiro com passo 1024, incluindo o item movido', async () => {
    const manager = makeManager();
    const siblings = [
      { id: 'a', position: 10 },
      { id: 'b', position: 11 },
      { id: 'c', position: 12 },
    ];

    const result = await resolvePosition(manager as any, 'marketing_cards', siblings, 'x', 1);

    expect(result).toEqual({ position: 2048, renumbered: true });
    expect(manager.query).toHaveBeenCalledTimes(1);
    const [sql, params] = manager.query.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toContain('UPDATE marketing_cards');
    // ordem final: a, x, b, c
    expect(params).toEqual(['a', 1024, 'x', 2048, 'b', 3072, 'c', 4096]);
  });

  it('criação no fim com estouro renumera os existentes e devolve o próximo passo', async () => {
    const manager = makeManager();

    const result = await resolvePosition(manager as any, 'marketing_card_tasks', [{ id: 'a', position: 2147483000 }], null, 1);

    expect(result).toEqual({ position: 2048, renumbered: true });
    expect((manager.query.mock.calls[0] as unknown as [string, unknown[]])[1]).toEqual(['a', 1024]);
  });
});

describe('indexFromNeighbours', () => {
  const ids = ['a', 'b', 'c', 'd'];

  it('sem vizinhos: fim da fila', () => {
    expect(indexFromNeighbours(ids, null, null)).toBe(4);
    expect(indexFromNeighbours([], null, null)).toBe(0);
  });

  it('só afterCardId: logo depois dele', () => {
    expect(indexFromNeighbours(ids, 'b', null)).toBe(2);
    expect(indexFromNeighbours(ids, 'd', null)).toBe(4);
  });

  it('só beforeCardId: logo antes dele (topo = antes do primeiro)', () => {
    expect(indexFromNeighbours(ids, null, 'a')).toBe(0);
    expect(indexFromNeighbours(ids, null, 'c')).toBe(2);
  });

  it('os dois: logo depois do afterCardId, exigindo a ordem after -> before', () => {
    expect(indexFromNeighbours(ids, 'a', 'b')).toBe(1);
    // vizinhos visíveis com cards ocultos entre eles: entra logo depois do primeiro
    expect(indexFromNeighbours(ids, 'a', 'd')).toBe(1);
    expect(() => indexFromNeighbours(ids, 'c', 'a')).toThrow(ConflictException);
    expect(() => indexFromNeighbours(ids, 'b', 'b')).toThrow(ConflictException);
  });

  it('vizinho fora da fila de destino (ou o próprio card, que não está nos irmãos) é 409', () => {
    expect(() => indexFromNeighbours(ids, 'x', null)).toThrow(new ConflictException('O card vizinho não está mais na fila de destino. Atualize o quadro.'));
    expect(() => indexFromNeighbours(ids, null, 'x')).toThrow(ConflictException);
    expect(() => indexFromNeighbours(ids, 'a', 'x')).toThrow(ConflictException);
  });
});
