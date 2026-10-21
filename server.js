const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const store = require('./store');
const defaults = require('./defaults');
const notify = require('./notify');

const ROOT = __dirname;
const UPLOADS = path.join(ROOT, 'uploads');
const PORT = process.env.PORT || 3000;
fs.mkdirSync(UPLOADS, { recursive: true });

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
const sessions = new Map();           // token -> expira
const SESSION_MS = 12 * 3600 * 1000;
const attempts = new Map();           // ip -> tempos
const posts = new Map();              // ip -> tempos

const cookies = req => Object.fromEntries((req.headers.cookie || '').split(';').map(c => c.trim().split('=')).filter(c => c[0]));
const authed = req => {
  const t = cookies(req).sid;
  const exp = t && sessions.get(t);
  if (!exp) return false;
  if (exp < Date.now()) { sessions.delete(t); return false; }
  return true;
};
const requireAuth = (req, res, next) => authed(req) ? next() : res.status(401).json({ error: 'Sessão expirada' });
const throttle = (map, ip, max, windowMs) => {
  const now = Date.now();
  const list = (map.get(ip) || []).filter(t => now - t < windowMs);
  list.push(now); map.set(ip, list);
  return list.length > max;
};
const isLocalImage = src => typeof src === 'string' && /^(images|uploads)\/[\w.\-]+$/.test(src);

// conteúdo público em cache curto (evita 3 consultas por visita); limpa-se sempre que o painel guarda
let publicCache = null, publicAt = 0;
const dropCache = () => { publicCache = null; };
const getPublic = async () => {
  if (publicCache && Date.now() - publicAt < 15000) return publicCache;
  const [content, services, gallery] = await Promise.all([store.getContent(), store.getServices(), store.getGallery()]);
  publicCache = { content, services, gallery }; publicAt = Date.now();
  return publicCache;
};

/* ---------- app ---------- */
const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));
app.use((req, res, next) => {
  res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin' });
  next();
});

// só pastas públicas são servidas (.env, data/, server.js e node_modules ficam fora)
for (const f of ['images', 'uploads']) app.use('/' + f, express.static(path.join(ROOT, f), { maxAge: '7d' }));
app.use('/admin', express.static(path.join(ROOT, 'admin')));
for (const f of ['index.html', 'style.css', 'script.js', 'logo.png', 'tinguita.mp4', 'tinguita2.mp4'])
  app.get('/' + (f === 'index.html' ? '' : f), (req, res) => res.sendFile(path.join(ROOT, f)));

/* público */
app.get('/api/public', async (req, res) => res.json(await getPublic()));

// aviso no WhatsApp da empresa: nunca impede nem atrasa o pedido do visitante
const alertCompany = async (kind, r) => {
  try {
    if (!notify.configured()) return;
    const { content } = await getPublic();
    if (await notify.send(kind, r, content.phone)) await store.markNotified(kind, r.id);
  } catch (e) { console.error('Aviso no WhatsApp falhou:', e.message); }
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
  res.json({ ok: true });
  alertCompany('reservas', r);
});
app.post('/api/eventos', async (req, res) => {
  if (!guard(req, res)) return;
  const b = req.body || {};
  const r = { ...common(b), tipo: str(b.tipo, 40), data: str(b.data, 10) };
  if (!r.nome || !r.telefone) return res.status(400).json({ error: 'Preencha nome e telefone.' });
  if (r.data && !isDate(r.data)) return res.status(400).json({ error: 'Data inválida.' });
  await store.addEvent(r);
  res.json({ ok: true });
  alertCompany('eventos', r);
});

/* sessão */
let admin_ = null;   // conta carregada no arranque e atualizada ao mudar a palavra-passe
app.post('/api/login', (req, res) => {
  if (throttle(attempts, req.ip, 8, 15 * 60 * 1000)) return res.status(429).json({ error: 'Demasiadas tentativas. Aguarde alguns minutos.' });
  const { user, password } = req.body || {};
  if (user !== admin_.user || !checkPw(str(password, 200), admin_)) return res.status(401).json({ error: 'Dados incorretos' });
  const t = crypto.randomBytes(32).toString('hex');
  sessions.set(t, Date.now() + SESSION_MS);
  res.set('Set-Cookie', `sid=${t}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MS / 1000}`);
  res.json({ ok: true });
});
app.post('/api/logout', (req, res) => {
  sessions.delete(cookies(req).sid);
  res.set('Set-Cookie', 'sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
  res.json({ ok: true });
});
app.get('/api/me', (req, res) => res.json({ auth: authed(req) }));

/* administração */
const admin = express.Router();
admin.use(requireAuth);

admin.get('/data', async (req, res) => {
  const [content, services, gallery, reservations, events] = await Promise.all([
    store.getContent(), store.getServices(), store.getGallery(), store.listReservations(), store.listEvents()]);
  res.json({ content, services, gallery, reservations, events, user: admin_.user });
});

admin.put('/content', async (req, res) => {
  const incoming = req.body || {};
  const out = {};
  for (const k of Object.keys(defaults.content)) if (k in incoming) out[k] = str(incoming[k], 1200);
  await store.setContent(out); dropCache();
  res.json({ ok: true });
});

admin.put('/services', async (req, res) => {
  const list = Array.isArray(req.body) ? req.body : [];
  const seen = new Set();
  const items = list.slice(0, 12).map(s => {
    let id = str(s.id, 20) || uid();
    if (seen.has(id)) id = uid();
    seen.add(id);
    return { id, title: str(s.title, 80), text: str(s.text, 300), image: isLocalImage(s.image) ? s.image : '', label: str(s.label, 30), href: str(s.href, 200) };
  });
  await store.setServices(items); dropCache();
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
  // apaga do disco os ficheiros enviados que deixaram de ser usados
  const [oldGallery, services] = await Promise.all([store.getGallery(), store.getServices()]);
  const used = new Set([...keep.map(g => g.src), ...services.map(s => s.image)]);
  await store.setGallery(keep); dropCache();
  for (const g of oldGallery) {
    if (g.src.startsWith('uploads/') && !used.has(g.src)) fs.rm(path.join(ROOT, g.src), () => {});
  }
  res.json({ ok: true });
});

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 30 * 1024 * 1024, files: 10 } });
admin.post('/upload', upload.array('files', 10), async (req, res) => {
  try {
    const out = [];
    for (const f of req.files || []) {
      const name = `${Date.now()}-${uid()}.jpg`;
      await sharp(f.buffer).rotate().resize({ width: 1800, withoutEnlargement: true }).jpeg({ quality: 80, mozjpeg: true }).toFile(path.join(UPLOADS, name));
      out.push('uploads/' + name);
    }
    res.json({ files: out });
  } catch {
    res.status(400).json({ error: 'Ficheiro de imagem inválido' });
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
  if (!checkPw(str(current, 200), admin_)) return res.status(400).json({ error: 'Palavra-passe atual incorreta' });
  if (str(next, 200).length < 8) return res.status(400).json({ error: 'A nova palavra-passe deve ter pelo menos 8 caracteres' });
  const name = str(user, 40) || admin_.user;
  const h = hashPw(str(next, 200));
  await store.setAdmin(name, h.salt, h.hash);
  admin_ = { user: name, ...h };
  res.json({ ok: true });
});
app.use('/api/admin', admin);

app.use('/api', (req, res) => res.sendStatus(404));
app.use((err, req, res, next) => { console.error(err); res.status(500).json({ error: 'Erro interno' }); });

/* ---------- arranque ---------- */
(async () => {
  await store.seedIfEmpty();
  admin_ = await store.getAdmin();
  if (!admin_) {
    const pw = process.env.ADMIN_PASSWORD || crypto.randomBytes(5).toString('hex');
    const h = hashPw(pw);
    await store.setAdmin('admin', h.salt, h.hash);
    admin_ = { user: 'admin', ...h };
    console.log('\n  Acesso à administração criado');
    console.log('  Utilizador: admin');
    console.log('  Palavra-passe: ' + pw);
    console.log('  (altere-a no painel, em Conta)\n');
  }
  app.listen(PORT, () => console.log(`Base de dados: Supabase (ligada)\nSite: http://localhost:${PORT}\nAdministração: http://localhost:${PORT}/admin`));
})().catch(e => { console.error('Não foi possível iniciar:', e.message); process.exit(1); });
