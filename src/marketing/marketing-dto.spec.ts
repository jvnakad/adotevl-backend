import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateMarketingListDto } from './dto/marketing-list.dto';
import { CreateMarketingLabelDto } from './dto/marketing-label.dto';
import { CreateMarketingCardDto, UpdateMarketingCardDto } from './dto/marketing-card.dto';
import { CreateMarketingTaskDto } from './dto/marketing-task.dto';
import { CreateMarketingCommentDto } from './dto/marketing-comment.dto';
import { FindMarketingCalendarDto, FindMarketingCardsDto } from './dto/marketing-query.dto';
import { cleanFileName } from './marketing-attachment.service';
import { MoveMarketingCardDto } from './dto/marketing-card.dto';
import { FindMarketingListCardsDto } from './dto/marketing-query.dto';
import { PaginationDto } from '../common/pagination.dto';

const UUID = '3f2b8c1e-1a2b-4c3d-8e4f-5a6b7c8d9e0f';
const errorsOf = async (cls: any, plain: object) => (await validate(plainToInstance(cls, plain))).flatMap((e) => Object.values(e.constraints ?? {}));
const valid = async (cls: any, plain: object) => expect(await errorsOf(cls, plain)).toEqual([]);

describe('DTOs do Marketing: limites de tamanho', () => {
  it('nome da fila: até 40', async () => {
    await valid(CreateMarketingListDto, { name: 'a'.repeat(40), color: '#FFF' });
    expect(await errorsOf(CreateMarketingListDto, { name: 'a'.repeat(41), color: '#FFFFFF' })).toEqual(['Use até 40 caracteres.']);
  });

  it('nome da etiqueta: até 30', async () => {
    await valid(CreateMarketingLabelDto, { name: 'a'.repeat(30), color: '#FFFFFF' });
    expect(await errorsOf(CreateMarketingLabelDto, { name: 'a'.repeat(31), color: '#FFFFFF' })).toEqual(['Use até 30 caracteres.']);
  });

  it('título do card: até 250; descrição: até 5000', async () => {
    await valid(CreateMarketingCardDto, { listId: UUID, title: 'a'.repeat(250), description: 'b'.repeat(5000) });
    expect(await errorsOf(CreateMarketingCardDto, { listId: UUID, title: 'a'.repeat(251) })).toEqual(['Use até 250 caracteres.']);
    expect(await errorsOf(CreateMarketingCardDto, { listId: UUID, title: 'x', description: 'b'.repeat(5001) })).toEqual(['A descrição pode ter até 5000 caracteres.']);
  });

  it('subtarefa: até 250; comentário: até 2000', async () => {
    await valid(CreateMarketingTaskDto, { title: 'a'.repeat(250) });
    expect(await errorsOf(CreateMarketingTaskDto, { title: 'a'.repeat(251) })).toEqual(['Use até 250 caracteres.']);
    await valid(CreateMarketingCommentDto, { body: 'a'.repeat(2000) });
    expect(await errorsOf(CreateMarketingCommentDto, { body: 'a'.repeat(2001) })).toHaveLength(1);
  });

  it('título vazio ou só espaços é recusado com a mensagem de obrigatório', async () => {
    expect(await errorsOf(CreateMarketingCardDto, { listId: UUID, title: '   ' })).toEqual(['Informe o título do card.']);
  });
});

describe('DTOs do Marketing: cor', () => {
  it('aceita #RGB e #RRGGBB em qualquer caixa e normaliza para #RRGGBB maiúsculo', async () => {
    const short = plainToInstance(CreateMarketingListDto, { name: 'Fila', color: '#f0a' });
    const long = plainToInstance(CreateMarketingLabelDto, { name: 'Etiq', color: ' #e1306c ' });

    expect(short.color).toBe('#FF00AA');
    expect(long.color).toBe('#E1306C');
    expect(await validate(short)).toEqual([]);
  });

  it('recusa formatos inválidos', async () => {
    for (const color of ['red', '#GGGGGG', '#12345', 'FFFFFF', '#1234567']) {
      expect(await errorsOf(CreateMarketingListDto, { name: 'Fila', color })).toEqual(['Cor inválida. Use o formato #RGB ou #RRGGBB.']);
    }
  });
});

describe('DTOs do Marketing: datas e consultas', () => {
  it('datas do card só aceitam dia real do calendário e null para limpar', async () => {
    await valid(UpdateMarketingCardDto, { dueDate: '2026-11-05', publishDate: null });
    expect(await errorsOf(UpdateMarketingCardDto, { dueDate: '2026-02-31' })).toEqual(['Informe um prazo de entrega válido.']);
  });

  it('visão Lista: limit até 100 (acima é limitado), sort e without validados', async () => {
    const dto = plainToInstance(FindMarketingCardsDto, { limit: '500', sort: 'due', without: 'publish' });

    expect(dto.limit).toBe(100);
    expect(dto.without).toBe('publish');
    expect(await validate(dto)).toEqual([]);
    expect(await errorsOf(FindMarketingCardsDto, { sort: 'cor' })).toEqual(['Ordenação inválida.']);
  });

  it('calendário exige from e to e valida dateField', async () => {
    await valid(FindMarketingCalendarDto, { from: '2026-11-01', to: '2026-11-30', dateField: 'publish' });
    expect((await errorsOf(FindMarketingCalendarDto, {})).length).toBeGreaterThanOrEqual(2);
    expect(await errorsOf(FindMarketingCalendarDto, { from: '2026-11-01', to: '2026-11-30', dateField: 'x' })).toEqual(['dateField deve ser due ou publish.']);
  });
});

describe('anexos: nome de arquivo', () => {
  it('reconverte o nome recebido em latin1 e remove caminho', () => {
    const asMulter = Buffer.from('Arte ação.png', 'utf8').toString('latin1');

    expect(cleanFileName(asMulter)).toBe('Arte ação.png');
    expect(cleanFileName('../../etc/passwd')).toBe('passwd');
    expect(cleanFileName('')).toBe('arquivo');
  });
});

describe('BUG-08: comentário vazio devolve só a mensagem de obrigatório', () => {
  it.each(['', '   ', '\n\t', undefined])('corpo %j', async (body) => {
    expect(await errorsOf(CreateMarketingCommentDto, { body })).toEqual(['Escreva o comentário.']);
  });

  it('acima de 2000 devolve só a mensagem de tamanho', async () => {
    expect(await errorsOf(CreateMarketingCommentDto, { body: 'a'.repeat(2001) })).toEqual(['O comentário pode ter até 2.000 caracteres.']);
  });
});

describe('BUG-06: page e offset gigantes são recusados', () => {
  it('page acima do máximo é 400 com mensagem clara; o máximo passa', async () => {
    expect(await errorsOf(PaginationDto, { page: '9223372036854775807' })).toEqual(['page deve ser no máximo 100000.']);
    expect(await errorsOf(PaginationDto, { page: '100000' })).toEqual([]);
    expect(await errorsOf(FindMarketingCardsDto, { page: '9223372036854775807' })).toEqual(['page deve ser no máximo 100000.']);
  });

  it('offset do Ver mais acima do máximo é 400; o máximo passa', async () => {
    expect(await errorsOf(FindMarketingListCardsDto, { offset: '9223372036854775807' })).toEqual(['offset deve ser no máximo 1000000.']);
    expect(await errorsOf(FindMarketingListCardsDto, { offset: '1000000' })).toEqual([]);
  });
});

describe('move: position', () => {
  it('aceita só "last"', async () => {
    expect(await errorsOf(MoveMarketingCardDto, { listId: UUID, position: 'last' })).toEqual([]);
    expect(await errorsOf(MoveMarketingCardDto, { listId: UUID, position: 'meio' })).toEqual(['position só aceita "last".']);
  });
});
