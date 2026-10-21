// Cria as tabelas no Supabase, importa os dados de data/db.json (se existir) e verifica a segurança.
// Uso:  npm run db:setup
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const ROOT = path.join(__dirname, '..');
const url = process.env.DATABASE_URL;
if (!url) { console.error('Falta DATABASE_URL (ficheiro .env).'); process.exit(1); }

(async () => {
  const c = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await c.connect();
  console.log('Ligado ao Supabase.');

  // 1) esquema
  await c.query(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
  console.log('Esquema aplicado (tabelas, índices e políticas RLS).');

  // 2) importação do que já existia no ficheiro local
  const file = path.join(ROOT, 'data', 'db.json');
  if (fs.existsSync(file)) {
    const d = JSON.parse(fs.readFileSync(file, 'utf8'));
    const counts = {};
    await c.query('begin');
    try {
      const content = Object.entries(d.content || {});
      for (const [k, v] of content)
        await c.query('insert into public.site_content (key, value) values ($1,$2) on conflict (key) do nothing', [k, String(v)]);
      counts.conteudo = content.length;
      for (const [i, s] of (d.services || []).entries())
        await c.query('insert into public.services (id, position, title, text, image, label, href) values ($1,$2,$3,$4,$5,$6,$7) on conflict (id) do nothing', [s.id, i, s.title || '', s.text || '', s.image || '', s.label || '', s.href || '']);
      counts.servicos = (d.services || []).length;
      for (const [i, g] of (d.gallery || []).entries())
        await c.query('insert into public.gallery (id, position, src, alt) values ($1,$2,$3,$4) on conflict (id) do nothing', [g.id, i, g.src, g.alt || '']);
      counts.galeria = (d.gallery || []).length;
      for (const r of d.reservations || [])
        await c.query('insert into public.reservations (id, created_at, status, nome, telefone, email, mensagem, checkin, checkout, hospedes) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) on conflict (id) do nothing',
          [r.id, r.createdAt, r.status, r.nome, r.telefone, r.email || '', r.mensagem || '', r.checkin, r.checkout, r.hospedes || 1]);
      counts.reservas = (d.reservations || []).length;
      for (const r of d.events || [])
        await c.query('insert into public.events (id, created_at, status, nome, telefone, email, mensagem, tipo, data) values ($1,$2,$3,$4,$5,$6,$7,$8,$9) on conflict (id) do nothing',
          [r.id, r.createdAt, r.status, r.nome, r.telefone, r.email || '', r.mensagem || '', r.tipo || '', r.data || null]);
      counts.eventos = (d.events || []).length;
      if (d.admin && d.admin.hash)
        await c.query('insert into public.admin_user (id, username, salt, hash) values (1,$1,$2,$3) on conflict (id) do nothing', [d.admin.user, d.admin.salt, d.admin.hash]);
      await c.query('commit');
      console.log('Dados importados de data/db.json:', JSON.stringify(counts));
    } catch (e) { await c.query('rollback'); throw e; }
  } else console.log('Sem data/db.json: o servidor criará o conteúdo inicial no primeiro arranque.');

  // 3) estado final
  const n = async t => (await c.query(`select count(*)::int as n from public.${t}`)).rows[0].n;
  console.log('Linhas:', JSON.stringify({
    site_content: await n('site_content'), services: await n('services'), gallery: await n('gallery'),
    reservations: await n('reservations'), events: await n('events'), admin_user: await n('admin_user')
  }));
  await c.end();

  // 4) a API pública (chaves anon/publishable) só deve ler o conteúdo, nunca os pedidos nem a conta
  const base = process.env.SUPABASE_URL;
  for (const [nome, key] of [['anon (JWT)', process.env.SUPABASE_ANON_KEY], ['publishable', process.env.SUPABASE_PUBLISHABLE_KEY]]) {
    if (!base || !key) continue;
    const get = async t => {
      const r = await fetch(`${base}/rest/v1/${t}?select=*&limit=1`, { headers: { apikey: key, ...(key.startsWith('eyJ') ? { Authorization: 'Bearer ' + key } : {}) } });
      const body = await r.text();
      return { status: r.status, linhas: (() => { try { const j = JSON.parse(body); return Array.isArray(j) ? j.length : '-'; } catch { return '-'; } })() };
    };
    const res = { site_content: await get('site_content'), reservations: await get('reservations'), admin_user: await get('admin_user') };
    console.log('Chave ' + nome + ':', JSON.stringify(res));
  }
  console.log('Concluído.');
})().catch(e => { console.error('Falhou:', e.message); process.exit(1); });
