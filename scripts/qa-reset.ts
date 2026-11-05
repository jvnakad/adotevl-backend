// Limpa os dados criados em TESTE/QA, por fora da API (ela não tem exclusão para esses dados).
// Uso: npm run qa:reset [-- --dry-run]
// Apaga SÓ o que tem marca de teste:
//   - usuários com e-mail @example.com (e o que depende deles: sessões, turnos da agenda, códigos, notificações, voluntário);
//   - lançamentos financeiros cujo remetente/destinatário começa com "QA";
//   - cards do Marketing, tipos e produtos de estoque cujo nome/título começa com "QA".
// Nunca toca nas contas @adotevl.local do seed. Mesmas travas do seed: banco em localhost (ou serviço do compose com ALLOW_LOCAL_SEED=1) e fora de produção.
import { DataSource } from 'typeorm';

function assertLocal() {
  if (process.env.NODE_ENV === 'production') throw new Error('qa:reset não roda com NODE_ENV=production.');
  let host = '';
  try {
    host = new URL(process.env.DATABASE_URL ?? '').hostname;
  } catch {
    // DATABASE_URL ausente ou inválida cai na recusa abaixo
  }
  const isLoopback = host === 'localhost' || host === '127.0.0.1';
  const isComposeService = process.env.ALLOW_LOCAL_SEED === '1' && /^[a-z][a-z0-9_-]*$/i.test(host);
  if (!isLoopback && !isComposeService) {
    throw new Error(`qa:reset só roda com DATABASE_URL em localhost/127.0.0.1 ou no serviço do compose local com ALLOW_LOCAL_SEED=1 (host atual: "${host || 'indefinido'}").`);
  }
}

// Ordem importa: dependentes antes dos pais. [descrição, SQL de contagem/exclusão por WHERE]
const STEPS: [string, string, string][] = [
  ['lançamentos financeiros (entradas) QA', 'financial_entries', "sender LIKE 'QA%'"],
  ['lançamentos financeiros (saídas) QA', 'financial_expenses', "recipient LIKE 'QA%'"],
  ['histórico do Marketing dos cards QA', 'marketing_history_events', "card_id IN (SELECT id FROM marketing_cards WHERE title LIKE 'QA%')"],
  ['cards do Marketing QA', 'marketing_cards', "title LIKE 'QA%'"],
  ['histórico de estoque dos produtos/tipos QA', 'stock_history_events', "product_id IN (SELECT id FROM products WHERE name LIKE 'QA%') OR product_type_id IN (SELECT id FROM product_types WHERE name LIKE 'QA%')"],
  ['produtos QA', 'products', "name LIKE 'QA%' OR product_type_id IN (SELECT id FROM product_types WHERE name LIKE 'QA%')"],
  ['tipos de produto QA', 'product_types', "name LIKE 'QA%'"],
  ['voluntários vinculados a usuários de teste', 'volunteers', "user_id IN (SELECT id FROM users WHERE lower(email) LIKE '%@example.com')"],
  ['usuários de teste (@example.com)', 'users', "lower(email) LIKE '%@example.com'"],
];

async function main() {
  assertLocal();
  const dryRun = process.argv.includes('--dry-run');
  const dataSource = new DataSource({ type: 'postgres', url: process.env.DATABASE_URL });
  await dataSource.initialize();
  try {
    await dataSource.transaction(async (manager) => {
      for (const [label, table, where] of STEPS) {
        const [{ count }] = await manager.query(`SELECT count(*)::int AS count FROM ${table} WHERE ${where}`);
        if (!dryRun && count > 0) await manager.query(`DELETE FROM ${table} WHERE ${where}`);
        console.log(`${dryRun ? '[simulação] ' : ''}${label}: ${count}`);
      }
      if (dryRun) throw new Error('DRY_RUN');
    });
  } catch (error) {
    if ((error as Error).message !== 'DRY_RUN') throw error;
    console.log('Nada foi apagado (--dry-run).');
  } finally {
    await dataSource.destroy();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
