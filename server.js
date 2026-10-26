const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const store = require('./store');
const defaults = require('./defaults');
const notify = require('./notify');

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const UPLOADS = path.join(ROOT, 'uploads');           // só para fotografias antigas guardadas em disco (uso local)
const PORT = process.env.PORT || 3000;
const SERVERLESS = !!process.env.VERCEL;              // na Vercel não há disco persistente nem processo permanente

/* ---------- palavra-passe ---------- */
const hashPw = (pw, salt = crypto.randomBytes(16).toString('hex')) =>
  ({ salt, hash: crypto.scryptSync(pw, salt, 64).toString('hex') });
const checkPw = (pw, a) => {
  const h = crypto.scryptSync(pw, a.salt, 64);
  const b = Buffer.from(a.hash, 'hex');
  return h.length === b.length && crypto.timingSafeEqual(h, b);
};

/* ---------- utilitários ---------- */
const uid = () => crypto.randomBytes(6).toString('hex');
const str = (v, max = 500) => String(v ?? '').trim().slice(0, max);
const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
const attempts = new Map();           // ip -> tempos (por instância: proteção básica)
const posts = new Map();
const throttle = (map, ip, max, windowMs) => {
  const now = Date.now();
  const list = (map.get(ip) || []).filter(t => now - t < windowMs);
  list.push(now); map.set(ip, list);
  return list.length > max;
};
const isLocalImage = src => typeof src === 'string' && /^(images|uploads|media)\/[\w.\-]+$/.test(src);

/* ---------- sessão sem estado (cookie assinado): funciona em várias instâncias ---------- */
const SESSION_MS = 12 * 3600 * 1000;
const secret = () => crypto.createHash('sha256').update('tinguita-session:' + (process.env.SESSION_SECRET || process.env.DATABASE_URL || '')).digest();
const mac = b => crypto.createHmac('sha256', secret()).update(b).digest('base64url');
const makeToken = () => { const b = Buffer.from(JSON.stringify({ exp: Date.now() + SESSION_MS })).toString('base64url'); return b + '.' + mac(b); };
const cookies = req => Object.fromEntries((req.headers.cookie || '').split(';').map(c => c.trim().split('=')).filter(c => c[0]));
const authed = req => {
  const [b, m] = String(cookies(req).sid || '').split('.');
  if (!b || !m) return false;
  const good = Buffer.from(mac(b)), got = Buffer.from(m);
  if (good.length !== got.length || !crypto.timingSafeEqual(good, got)) return false;
  try { return JSON.parse(Buffer.from(b, 'base64url').toString()).exp > Date.now(); } catch { return false; }
};
const requireAuth = (req, res, next) => authed(req) ? next() : res.status(401).json({ error: 'Sessão expirada' });
const cookie = (req, value, maxAge) => `sid=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${req.secure ? '; Secure' : ''}`;

// conteúdo público em cache curto (evita 3 consultas por visita); limpa-se sempre que o painel guarda
let publicCache = null, publicAt = 0;
const dropCache = () => { publicCache = null; };
const getPublic = async () => {
  if (publicCache && Date.now() - publicAt < 15000) return publicCache;
  publicCache = await store.getPublicAll(); publicAt = Date.now();
  return publicCache;
};

/* ---------- arranque preguiçoso (também no primeiro pedido de uma instância nova) ---------- */
let booting = null;
const boot = async () => {
  await store.seedIfEmpty();
  const a = await store.getAdmin();
  if (!a) {
    const pw = process.env.ADMIN_PASSWORD || crypto.randomBytes(5).toString('hex');
    const h = hashPw(pw);
    await store.setAdmin('admin', h.salt, h.hash);
    console.log('\n  Acesso à administração criado\n  Utilizador: admin\n  Palavra-passe: ' + pw + '\n  (altere-a no painel, em Conta)\n');
  }
};
const ready = () => (booting ||= boot().catch(e => { booting = null; throw e; }));

/* ---------- app ---------- */
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);                            // IP e HTTPS reais atrás da Vercel
app.use(express.json({ limit: '1mb' }));
app.use((req, res, next) => {
  res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin' });
  next();
});

// ficheiros do site (na Vercel a pasta public/ é servida diretamente pela rede de distribuição)
if (fs.existsSync(UPLOADS)) app.use('/uploads', express.static(UPLOADS, { maxAge: '7d' }));
app.use(express.static(PUBLIC, { maxAge: '1h' }));

// fotografias enviadas pelo painel (guardadas na base de dados)
app.get('/media/:file', async (req, res) => {
  const m = /^([a-f0-9]{16,40})\.jpg$/.exec(req.params.file);
  if (!m) return res.sendStatus(404);
  const row = await store.getMedia(m[1]);
  if (!row) return res.sendStatus(404);
  res.set({ 'Content-Type': row.mime, 'Cache-Control': 'public, max-age=31536000, immutable' });
  res.send(row.data);
});

// diagnóstico: mostra se as variáveis existem e se a base de dados responde (nunca revela valores)
app.get('/api/health', async (req, res) => {
  const env = Object.fromEntries(['DATABASE_URL', 'SESSION_SECRET', 'SUPABASE_URL', 'PUBLIC_URL', 'CALLMEBOT_APIKEY', 'WHATSAPP_TOKEN'].map(k => [k, !!process.env[k]]));
  let db = false, erro;
  try { await store.q('select 1'); db = true; } catch (e) { erro = e.message; }
  res.status(db ? 200 : 503).json({ ok: db, db, erro, env, serverless: SERVERLESS, node: process.version });
});

// o conteúdo público e os formulários não esperam pelo arranque; só o painel e o login precisam da conta
app.use(['/api/login', '/api/admin'], async (req, res, next) => { await ready(); next(); });
// arranque em segundo plano (cria o conteúdo inicial na primeira vez)
ready().catch(e => console.error('Arranque:', e.message));

/* público */
// s-maxage: a rede da Vercel guarda a resposta 30 s e serve a antiga enquanto atualiza (carregamento rápido sem consultar a base de dados)
app.get('/api/public', async (req, res) => {
  res.set('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=600');
  res.json(await getPublic());
});

// aviso no WhatsApp da empresa: nunca impede o pedido do visitante
const alertCompany = async (kind, r) => {
  try {
    if (!notify.configured()) return;
    const { content } = await getPublic();
    if (await notify.send(kind, r, content.phone)) await store.markNotified(kind, r.id);
  } catch (e) { console.error('Aviso no WhatsApp falhou:', e.message); }
};
// em alojamento sem processo permanente o envio tem de terminar antes de responder
let waitUntil = null;
try { ({ waitUntil } = require('@vercel/functions')); } catch { /* fora da Vercel */ }
const alertAfter = async (kind, r) => {
  const p = alertCompany(kind, r);
  // na Vercel o aviso continua depois de responder ao visitante (sem o fazer esperar); sem waitUntil espera no máximo 7 s
  if (SERVERLESS) { if (waitUntil) waitUntil(p); else await Promise.race([p, new Promise(ok => setTimeout(ok, 7000))]); }
};

const common = body => ({
  id: uid(),
  nome: str(body.nome, 100), telefone: str(body.telefone, 30), email: str(body.email, 120), mensagem: str(body.mensagem, 1000)
});
const guard = (req, res) => {
  if (throttle(posts, req.ip, 5, 10 * 60 * 1000)) { res.status(429).json({ error: 'Demasiados pedidos. Tente mais tarde.' }); return false; }
  return true;
};
app.post('/api/reservas', async (req, res) => {
  if (!guard(req, res)) return;
  const b = req.body || {};
  const r = { ...common(b), checkin: str(b.checkin, 10), checkout: str(b.checkout, 10), hospedes: Math.min(20, Math.max(1, parseInt(b.hospedes) || 1)) };
  if (!r.nome || !r.telefone || !r.checkin || !r.checkout) return res.status(400).json({ error: 'Preencha nome, telefone e datas.' });
  if (!isDate(r.checkin) || !isDate(r.checkout)) return res.status(400).json({ error: 'Datas inválidas.' });
  if (r.checkout < r.checkin) return res.status(400).json({ error: 'A saída não pode ser antes da entrada.' });
  await store.addReservation(r);
  await alertAfter('reservas', r);
  res.json({ ok: true });
});
app.post('/api/eventos', async (req, res) => {
  if (!guard(req, res)) return;
  const b = req.body || {};
  const r = { ...common(b), tipo: str(b.tipo, 40), data: str(b.data, 10) };
  if (!r.nome || !r.telefone) return res.status(400).json({ error: 'Preencha nome e telefone.' });
  if (r.data && !isDate(r.data)) return res.status(400).json({ error: 'Data inválida.' });
  await store.addEvent(r);
  await alertAfter('eventos', r);
  res.json({ ok: true });
});

/* sessão */
app.post('/api/login', async (req, res) => {
  if (throttle(attempts, req.ip, 8, 15 * 60 * 1000)) return res.status(429).json({ error: 'Demasiadas tentativas. Aguarde alguns minutos.' });
  const { user, password } = req.body || {};
  const a = await store.getAdmin();
  if (!a || user !== a.user || !checkPw(str(password, 200), a)) return res.status(401).json({ error: 'Dados incorretos' });
  res.set('Set-Cookie', cookie(req, makeToken(), SESSION_MS / 1000));
  res.json({ ok: true });
});
app.post('/api/logout', (req, res) => {
  res.set('Set-Cookie', cookie(req, '', 0));
  res.json({ ok: true });
});
app.get('/api/me', (req, res) => res.json({ auth: authed(req) }));

/* administração */
const admin = express.Router();
admin.use(requireAuth);

admin.get('/data', async (req, res) => {
  const [content, services, gallery, reservations, events, a] = await Promise.all([
    store.getContent(), store.getServices(), store.getGallery(), store.listReservations(), store.listEvents(), store.getAdmin()]);
  res.json({ content, services, gallery, reservations, events, user: a.user });
});

admin.put('/content', async (req, res) => {
  const incoming = req.body || {};
  const out = {};
  for (const k of Object.keys(defaults.content)) if (k in incoming) out[k] = str(incoming[k], 1200);
  await store.setContent(out); dropCache();
  res.json({ ok: true });
});

// fotografias guardadas na base de dados que deixaram de ser usadas
const cleanMedia = async (before, still) => {
  for (const src of before) {
    const m = /^media\/([a-f0-9]{16,40})\.jpg$/.exec(src);
    if (m && !still.has(src)) await store.removeMedia(m[1]).catch(() => {});
    else if (src.startsWith('uploads/') && !still.has(src) && !SERVERLESS) fs.rm(path.join(ROOT, src), () => {});
  }
};

admin.put('/services', async (req, res) => {
  const list = Array.isArray(req.body) ? req.body : [];
  const seen = new Set();
  const items = list.slice(0, 12).map(s => {
    let id = str(s.id, 20) || uid();
    if (seen.has(id)) id = uid();
    seen.add(id);
    return { id, title: str(s.title, 80), text: str(s.text, 300), image: isLocalImage(s.image) ? s.image : '', label: str(s.label, 30), href: str(s.href, 200) };
  });
  const [oldServices, gallery] = await Promise.all([store.getServices(), store.getGallery()]);
  await store.setServices(items); dropCache();
  await cleanMedia(oldServices.map(s => s.image), new Set([...items.map(s => s.image), ...gallery.map(g => g.src)]));
  res.json({ ok: true });
});

admin.put('/gallery', async (req, res) => {
  const list = Array.isArray(req.body) ? req.body : [];
  const seen = new Set();
  const keep = list.filter(g => isLocalImage(g.src)).slice(0, 40).map(g => {
    let id = str(g.id, 20) || uid();
    if (seen.has(id)) id = uid();
    seen.add(id);
    return { id, src: g.src, alt: str(g.alt, 120) };
  });
  const [oldGallery, services] = await Promise.all([store.getGallery(), store.getServices()]);
  await store.setGallery(keep); dropCache();
  await cleanMedia(oldGallery.map(g => g.src), new Set([...keep.map(g => g.src), ...services.map(s => s.image)]));
  res.json({ ok: true });
});

// o painel reduz as fotos antes de enviar (a Vercel limita os pedidos a ~4,5 MB)
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 4 * 1024 * 1024, files: 10 } });
admin.post('/upload', upload.array('files', 10), async (req, res) => {
  try {
    let sharp = null;
    try { sharp = require('sharp'); } catch { /* sem sharp: guarda a imagem como veio, se já for pequena */ }
    const out = [];
    for (const f of req.files || []) {
      let buf = f.buffer;
      if (sharp) buf = await sharp(buf).rotate().resize({ width: 1800, withoutEnlargement: true }).jpeg({ quality: 80, mozjpeg: true }).toBuffer();
      else if (!/^image\/jpeg$/.test(f.mimetype)) throw new Error('formato');
      const id = crypto.randomBytes(12).toString('hex');
      await store.saveMedia(id, buf, 'image/jpeg');
      out.push(`media/${id}.jpg`);
    }
    res.json({ files: out });
  } catch (e) {
    console.error('Envio de foto falhou:', e.message);
    res.status(400).json({ error: 'Ficheiro de imagem inválido ou demasiado grande' });
  }
});

const statuses = ['nova', 'confirmada', 'cancelada'];
for (const route of ['reservas', 'eventos']) {
  admin.patch(`/${route}/:id`, async (req, res) => {
    if (!statuses.includes(req.body?.status)) return res.status(400).json({ error: 'Estado inválido' });
    const n = await store.setStatus(route, req.params.id, req.body.status);
    return n ? res.json({ ok: true }) : res.sendStatus(404);
  });
  admin.delete(`/${route}/:id`, async (req, res) => {
    await store.remove(route, req.params.id);
    res.json({ ok: true });
  });
}

admin.post('/password', async (req, res) => {
  const { current, next, user } = req.body || {};
  const a = await store.getAdmin();
  if (!checkPw(str(current, 200), a)) return res.status(400).json({ error: 'Palavra-passe atual incorreta' });
  if (str(next, 200).length < 8) return res.status(400).json({ error: 'A nova palavra-passe deve ter pelo menos 8 caracteres' });
  const h = hashPw(str(next, 200));
  await store.setAdmin(str(user, 40) || a.user, h.salt, h.hash);
  res.json({ ok: true });
});
app.use('/api/admin', admin);

app.use('/api', (req, res) => res.sendStatus(404));
app.use((err, req, res, next) => { console.error(err); res.status(500).json({ error: 'Erro interno' }); });

module.exports = app;

// localmente (npm run dev / npm start) arranca o servidor; na Vercel só exporta a aplicação
if (require.main === module) {
  ready().then(() => app.listen(PORT, () => console.log(`Base de dados: Supabase (ligada)\nSite: http://localhost:${PORT}\nAdministração: http://localhost:${PORT}/admin`)))
    .catch(e => { console.error('Não foi possível iniciar:', e.message); process.exit(1); });
}
