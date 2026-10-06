import { env } from 'cloudflare:workers';

export type RedirectRule = { from: string; to: string; status: number };
export type PostTemplate = { id: string; name: string; description: string; body: string };

type D1Statement = {
  bind(...values: unknown[]): D1Statement;
  run(): Promise<unknown>;
  all<T = Record<string, unknown>>(): Promise<{ results?: T[] }>;
};
type D1Binding = {
  prepare(query: string): D1Statement;
  batch(statements: D1Statement[]): Promise<unknown[]>;
};

function db(): D1Binding {
  const binding = (env as any).DB as D1Binding | undefined;
  if (!binding) throw new Error('DB is not configured.');
  return binding;
}

export async function listRedirects(): Promise<RedirectRule[]> {
  const result = await db()
    .prepare('SELECT source, destination, status FROM cms_redirects ORDER BY source ASC')
    .all<{ source: string; destination: string; status: number }>();
  return (result.results || []).map((row) => ({ from: row.source, to: row.destination, status: Number(row.status) }));
}

export async function saveRedirects(rules: RedirectRule[], updatedBy: string) {
  const binding = db();
  const now = Math.floor(Date.now() / 1000);
  const statements = [binding.prepare('DELETE FROM cms_redirects')];
  for (const rule of rules) {
    statements.push(
      binding.prepare('INSERT INTO cms_redirects (source, destination, status, updated_at, updated_by) VALUES (?, ?, ?, ?, ?)')
        .bind(rule.from, rule.to, rule.status, now, updatedBy)
    );
  }
  await binding.batch(statements);
  return now;
}

export async function listTemplates(): Promise<PostTemplate[]> {
  const result = await db()
    .prepare('SELECT id, name, description, body FROM cms_templates ORDER BY rowid ASC')
    .all<PostTemplate>();
  return result.results || [];
}

export async function saveTemplates(templates: PostTemplate[], updatedBy: string) {
  const binding = db();
  const now = Math.floor(Date.now() / 1000);
  const statements = [binding.prepare('DELETE FROM cms_templates')];
  for (const template of templates) {
    statements.push(
      binding.prepare('INSERT INTO cms_templates (id, name, description, body, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(template.id, template.name, template.description, template.body, now, updatedBy)
    );
  }
  await binding.batch(statements);
  return now;
}
