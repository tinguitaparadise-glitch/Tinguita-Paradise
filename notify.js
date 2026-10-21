// Aviso automático no WhatsApp da empresa quando chega uma reserva ou um pedido de evento.
// Funciona com um destes fornecedores (configurados em .env). Sem configuração, não envia nada
// (o pedido fica sempre guardado no painel e o visitante pode avisar por WhatsApp no ecrã de confirmação).
//
//  1) CallMeBot (gratuito, para um número pessoal/da empresa):  CALLMEBOT_APIKEY=...
//  2) WhatsApp Cloud API da Meta:  WHATSAPP_TOKEN=...  WHATSAPP_PHONE_ID=...  [WHATSAPP_TEMPLATE=nome_do_modelo]
//
// Destino: WHATSAPP_NOTIFY_TO (ex.: 244940637666). Por omissão usa o telefone guardado no painel.

const fmtDay = d => (d ? String(d).split('-').reverse().join('/') : '-');

const compose = (kind, r) => {
  const lines = kind === 'reservas'
    ? ['*Nova reserva de quarto*', `Nome: ${r.nome}`, `Telefone: ${r.telefone}`, r.email && `E-mail: ${r.email}`,
       `Entrada: ${fmtDay(r.checkin)}`, `Saída: ${fmtDay(r.checkout)}`, `Hóspedes: ${r.hospedes}`, r.mensagem && `Mensagem: ${r.mensagem}`]
    : ['*Novo pedido de evento*', `Nome: ${r.nome}`, `Telefone: ${r.telefone}`, r.email && `E-mail: ${r.email}`,
       r.tipo && `Tipo: ${r.tipo}`, r.data && `Data prevista: ${fmtDay(r.data)}`, r.mensagem && `Mensagem: ${r.mensagem}`];
  if (process.env.PUBLIC_URL) lines.push(`Painel: ${process.env.PUBLIC_URL.replace(/\/$/, '')}/admin`);
  return lines.filter(Boolean).join('\n');
};

const digits = s => String(s || '').replace(/\D/g, '');
const target = phone => {
  const d = digits(process.env.WHATSAPP_NOTIFY_TO || phone);
  return d.length <= 9 ? '244' + d : d;      // sem indicativo: assume Angola (+244)
};

const withTimeout = async (url, opt = {}) => {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 9000);
  try { return await fetch(url, { ...opt, signal: ctl.signal }); } finally { clearTimeout(t); }
};

const configured = () => !!(process.env.CALLMEBOT_APIKEY || (process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_ID));

// devolve true se o fornecedor aceitou a mensagem; lança erro com o motivo caso contrário
const send = async (kind, r, phone) => {
  if (!configured()) return false;
  const text = compose(kind, r);
  const to = target(phone);

  if (process.env.CALLMEBOT_APIKEY) {
    const base = process.env.CALLMEBOT_URL || 'https://api.callmebot.com/whatsapp.php';
    const url = `${base}?phone=${encodeURIComponent('+' + to)}&text=${encodeURIComponent(text)}&apikey=${encodeURIComponent(process.env.CALLMEBOT_APIKEY)}`;
    const res = await withTimeout(url);
    if (!res.ok) throw new Error('CallMeBot respondeu ' + res.status + ': ' + (await res.text()).slice(0, 120));
    return true;
  }

  const base = process.env.WHATSAPP_API_URL || 'https://graph.facebook.com/v21.0';
  const body = process.env.WHATSAPP_TEMPLATE
    ? { messaging_product: 'whatsapp', to, type: 'template', template: { name: process.env.WHATSAPP_TEMPLATE, language: { code: process.env.WHATSAPP_LANG || 'pt_PT' },
        components: [{ type: 'body', parameters: [{ type: 'text', text: text.replace(/\s*\n\s*/g, ' | ') }] }] } }
    : { messaging_product: 'whatsapp', to, type: 'text', text: { body: text } };
  const res = await withTimeout(`${base}/${process.env.WHATSAPP_PHONE_ID}/messages`, {
    method: 'POST', headers: { Authorization: 'Bearer ' + process.env.WHATSAPP_TOKEN, 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error('WhatsApp Cloud API respondeu ' + res.status + ': ' + (await res.text()).slice(0, 160));
  return true;
};

module.exports = { send, compose, configured };
