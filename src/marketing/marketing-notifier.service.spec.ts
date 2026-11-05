import { MarketingNotifier, planCommentRecipients } from './marketing-notifier.service';

describe('planCommentRecipients', () => {
  it('comentário novo: mencionado recebe menção; membro não mencionado recebe comentário', () => {
    expect(planCommentRecipients({ actorId: 'autor', mentionIds: ['ana'], memberIds: ['ana', 'bia', 'caio'], kind: 'created' })).toEqual({ mention: ['ana'], comment: ['bia', 'caio'] });
  });

  it('dedupe: quem é mencionado e membro recebe só a menção', () => {
    const plan = planCommentRecipients({ actorId: 'autor', mentionIds: ['ana'], memberIds: ['ana'], kind: 'created' });

    expect(plan.mention).toEqual(['ana']);
    expect(plan.comment).toEqual([]);
  });

  it('o autor nunca é notificado, nem como membro nem como mencionado', () => {
    const plan = planCommentRecipients({ actorId: 'autor', mentionIds: ['autor', 'ana'], memberIds: ['autor', 'bia'], kind: 'created' });

    expect(plan).toEqual({ mention: ['ana'], comment: ['bia'] });
  });

  it('menção repetida conta uma vez', () => {
    expect(planCommentRecipients({ actorId: 'autor', mentionIds: ['ana', 'ana'], memberIds: [], kind: 'created' }).mention).toEqual(['ana']);
  });

  it('edição: só as novas menções, membros não são avisados de novo', () => {
    expect(planCommentRecipients({ actorId: 'autor', mentionIds: ['nova'], memberIds: ['bia'], kind: 'edited' })).toEqual({ mention: ['nova'], comment: [] });
  });
});

describe('MarketingNotifier', () => {
  const ORG = 'org-1';
  const CARD = 'card-1';

  const setup = ({ members = [] as string[], viewers }: { members?: string[]; viewers?: string[] } = {}) => {
    const dataSource = {
      query: jest.fn(async (sql: string) => {
        if (sql.includes('FROM marketing_card_members')) return members.map((userId) => ({ userId }));
        if (sql.includes('FROM marketing_cards')) return [{ id: CARD, title: 'Post de adoção' }];
        if (sql.includes('FROM users')) return [{ name: 'Autor' }];
        if (sql.includes('FROM marketing_lists')) return [{ id: 'l1', name: 'Criação' }, { id: 'l2', name: 'Aprovação' }];
        return [];
      }),
    };
    const notifications = { notifyMany: jest.fn(async () => undefined) };
    // Por padrão todos enxergam o Marketing
    const eligibility = { filterViewers: jest.fn(async (_org: string, ids: string[]) => ids.filter((id) => !viewers || viewers.includes(id)).map((id) => ({ id, name: id }))) };
    const notifier = new MarketingNotifier(dataSource as any, notifications as any, eligibility as any);
    const sent = () => (notifications.notifyMany.mock.calls as unknown as [any[]][]).flatMap(([list]) => list);
    return { notifier, notifications, eligibility, sent };
  };

  describe('adicionado como membro', () => {
    it('notifica quem foi adicionado, com link para o card, e nunca o autor da ação', async () => {
      const { notifier, sent } = setup();

      await notifier.membersAdded(ORG, CARD, ['ana', 'autor', 'ana'], 'autor');

      expect(sent()).toEqual([
        expect.objectContaining({ userId: 'ana', organizationId: ORG, type: 'MARKETING_MEMBER_ADDED', link: `/marketing?card=${CARD}`, title: 'Autor adicionou você ao card "Post de adoção"' }),
      ]);
    });

    it('só o autor adicionado a si mesmo: nada é enviado', async () => {
      const { notifier, notifications } = setup();

      await notifier.membersAdded(ORG, CARD, ['autor'], 'autor');

      expect(notifications.notifyMany).not.toHaveBeenCalled();
    });
  });

  describe('comentário novo', () => {
    it('mencionado que também é membro recebe 1 notificação (menção); os outros membros recebem comentário', async () => {
      const { notifier, sent } = setup({ members: ['ana', 'bia', 'autor'] });

      await notifier.commentAdded(ORG, CARD, 'autor', ['ana'], 'oi @Ana');

      const byUser = Object.fromEntries(sent().map((n) => [n.userId, n.type]));
      expect(byUser).toEqual({ ana: 'MARKETING_MENTION', bia: 'MARKETING_COMMENT' });
      expect(sent()).toHaveLength(2);
      expect(sent().find((n) => n.userId === 'ana').body).toBe('oi @Ana');
    });

    it('quem perdeu o acesso ao Marketing não recebe (não vaza o título do card)', async () => {
      const { notifier, sent } = setup({ members: ['ana', 'bia'], viewers: ['bia'] });

      await notifier.commentAdded(ORG, CARD, 'autor', ['ana'], 'x');

      expect(sent().map((n) => n.userId)).toEqual(['bia']);
    });
  });

  describe('comentário editado', () => {
    it('notifica só as novas menções', async () => {
      const { notifier, sent } = setup({ members: ['bia'] });

      await notifier.commentEdited(ORG, CARD, 'autor', ['nova'], 'texto');

      expect(sent().map((n) => [n.userId, n.type])).toEqual([['nova', 'MARKETING_MENTION']]);
    });

    it('sem novas menções não envia nada (nem consulta o card)', async () => {
      const { notifier, notifications } = setup({ members: ['bia'] });

      await notifier.commentEdited(ORG, CARD, 'autor', [], 'texto');

      expect(notifications.notifyMany).not.toHaveBeenCalled();
    });
  });

  describe('card movido de fila', () => {
    it('avisa os membros com de → para, menos quem moveu', async () => {
      const { notifier, sent } = setup({ members: ['ana', 'autor'] });

      await notifier.cardMoved(ORG, CARD, 'autor', 'l1', 'l2');

      expect(sent()).toEqual([
        expect.objectContaining({ userId: 'ana', type: 'MARKETING_CARD_MOVED', title: 'Autor moveu "Post de adoção" de Criação para Aprovação' }),
      ]);
    });

    it('card sem outros membros: nada é enviado', async () => {
      const { notifier, notifications } = setup({ members: ['autor'] });

      await notifier.cardMoved(ORG, CARD, 'autor', 'l1', 'l2');

      expect(notifications.notifyMany).not.toHaveBeenCalled();
    });
  });

  it('falha interna nunca lança (a ação HTTP já foi concluída)', async () => {
    const { notifier, notifications } = setup({ members: ['ana'] });
    notifications.notifyMany.mockRejectedValue(new Error('banco') as never);

    await expect(notifier.cardMoved(ORG, CARD, 'autor', 'l1', 'l2')).resolves.toBeUndefined();
  });
});
