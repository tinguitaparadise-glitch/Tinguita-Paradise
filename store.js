// Camada de dados: PostgreSQL no Supabase. Só o servidor usa esta ligação (DATABASE_URL é segredo).
const { Pool } = require('pg');
const defaults = require('./defaults');

// sem DATABASE_URL não se derruba o processo: as páginas estáticas continuam a abrir e a API responde com erro claro
const missing = !process.env.DATABASE_URL;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || undefined,
  ssl: { rejectUnauthorized: false },   // ligação cifrada ao Supabase
  max: process.env.VERCEL ? 1 : 6,   // na Vercel cada instância usa uma só ligação (use o pooler em modo transação, porta 6543)
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
});
pool.on('error', e => console.error('Erro na ligação à base de dados:', e.message));

const q = (text, params) => (missing ? Promise.reject(new Error('Falta a variável DATABASE_URL')) : pool.query(text, params));
const tx = async fn => {
  if (missing) throw new Error('Falta a variável DATABASE_URL');
  const c = await pool.connect();
  try { await c.query('begin'); const r = await fn(c); await c.query('commit'); return r; }
  catch (e) { await c.query('rollback').catch(() => {}); throw e; }
  finally { c.release(); }
};

/* ---------- conteúdo público ---------- */
const getContent = async () => {
  const { rows } = await q('select key, value from public.site_content');
  return { ...defaults.content, ...Object.fromEntries(rows.map(r => [r.key, r.value])) };
};
const getServices = async () => (await q('select id, title, text, image, label, href from public.services order by position, id')).rows;
const getGallery = async () => (await q('select id, src, alt from public.gallery order by position, id')).rows;

// conteúdo público numa só ida à base de dados (3 consultas em 1)
const getPublicAll = async () => {
  const { rows } = await q(`select
    (select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) from public.site_content) as content,
    (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'title', title, 'text', text, 'image', image, 'label', label, 'href', href) order by position, id), '[]'::jsonb) from public.services) as services,
    (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'src', src, 'alt', alt) order by position, id), '[]'::jsonb) from public.gallery) as gallery`);
  const r = rows[0];
  return { content: { ...defaults.content, ...r.content }, services: r.services, gallery: r.gallery };
};

const setContent = obj => {
  const keys = Object.keys(obj);
  if (!keys.length) return Promise.resolve();
  return q(`insert into public.site_content (key, value)
            select * from unnest($1::text[], $2::text[])
            on conflict (key) do update set value = excluded.value, updated_at = now()`, [keys, keys.map(k => obj[k])]);
};
const setServices = list => tx(async c => {
  await c.query('delete from public.services');
  for (const [i, s] of list.entries())
    await c.query('insert into public.services (id, position, title, text, image, label, href) values ($1,$2,$3,$4,$5,$6,$7)', [s.id, i, s.title, s.text, s.image, s.label, s.href]);
});
const setGallery = list => tx(async c => {
  await c.query('delete from public.gallery');
  for (const [i, g] of list.entries())
    await c.query('insert into public.gallery (id, position, src, alt) values ($1,$2,$3,$4)', [g.id, i, g.src, g.alt]);
});

/* ---------- pedidos ---------- */
const map = r => ({ ...r, createdAt: r.created_at.toISOString(), created_at: undefined });
const listReservations = async () => (await q(
  `select id, created_at, status, nome, telefone, email, mensagem, checkin::text as checkin, checkout::text as checkout, hospedes, notified
   from public.reservations order by created_at desc`)).rows.map(map);
const listEvents = async () => (await q(
  `select id, created_at, status, nome, telefone, email, mensagem, tipo, coalesce(data::text, '') as data, notified
   from public.events order by created_at desc`)).rows.map(map);

const addReservation = r => q(
  `insert into public.reservations (id, status, nome, telefone, email, mensagem, checkin, checkout, hospedes)
   values ($1,'nova',$2,$3,$4,$5,$6,$7,$8)`, [r.id, r.nome, r.telefone, r.email, r.mensagem, r.checkin, r.checkout, r.hospedes]);
const addEvent = r => q(
  `insert into public.events (id, status, nome, telefone, email, mensagem, tipo, data)
   values ($1,'nova',$2,$3,$4,$5,$6,$7)`, [r.id, r.nome, r.telefone, r.email, r.mensagem, r.tipo, r.data || null]);

const TABLES = { reservas: 'public.reservations', eventos: 'public.events' };
const setStatus = async (kind, id, status) => (await q(`update ${TABLES[kind]} set status = $2 where id = $1`, [id, status])).rowCount;
const markNotified = (kind, id) => q(`update ${TABLES[kind]} set notified = true where id = $1`, [id]);
const remove = async (kind, id) => (await q(`delete from ${TABLES[kind]} where id = $1`, [id])).rowCount;

/* ---------- conta de administração ---------- */
const getAdmin = async () => (await q('select username as user, salt, hash from public.admin_user where id = 1')).rows[0] || null;
const setAdmin = (user, salt, hash) => q(
  `insert into public.admin_user (id, username, salt, hash) values (1, $1, $2, $3)
   on conflict (id) do update set username = excluded.username, salt = excluded.salt, hash = excluded.hash`, [user, salt, hash]);

/* ---------- fotografias enviadas ---------- */
const saveMedia = (id, buf, mime = 'image/jpeg') => q('insert into public.media (id, mime, data) values ($1,$2,$3)', [id, mime, buf]);
const getMedia = async id => (await q('select mime, data from public.media where id = $1', [id])).rows[0] || null;
const removeMedia = id => q('delete from public.media where id = $1', [id]);

/* ---------- arranque ---------- */
const seedIfEmpty = async () => {
  const n = async t => +(await q(`select count(*)::int as n from ${t}`)).rows[0].n;
  if (!(await n('public.site_content'))) await setContent(defaults.content);
  if (!(await n('public.services'))) await setServices(defaults.services);
  if (!(await n('public.gallery'))) await setGallery(defaults.gallery);
};

module.exports = { pool, q, tx, getPublicAll, getContent, getServices, getGallery, setContent, setServices, setGallery,
  listReservations, listEvents, addReservation, addEvent, setStatus, markNotified, remove, saveMedia, getMedia, removeMedia, getAdmin, setAdmin, seedIfEmpty };
