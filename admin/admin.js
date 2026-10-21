(() => {
  const app = document.getElementById('app');
  const toastEl = document.getElementById('toast');
  let data = null;
  let tab = 'resumo';
  let filter = 'todas';

  /* ---------- utilitários ---------- */
  // cria elementos sem innerHTML: tudo o que vem dos visitantes é inserido como texto
  const h = (tag, attrs, ...kids) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === 'class') e.className = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else if (v === true) e.setAttribute(k, '');
      else if (v !== false && v != null) e.setAttribute(k, v);
    }
    for (const k of kids.flat()) if (k != null && k !== false) e.append(k.nodeType ? k : document.createTextNode(k));
    return e;
  };
  const toast = (m, bad) => {
    toastEl.textContent = m;
    toastEl.className = 'show' + (bad ? ' bad' : '');
    clearTimeout(toast.t);
    toast.t = setTimeout(() => (toastEl.className = ''), 2600);
  };
  const api = async (method, url, body) => {
    const opt = { method, headers: {} };
    if (body instanceof FormData) opt.body = body;
    else if (body !== undefined) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
    const r = await fetch(url, opt);
    const j = await r.json().catch(() => ({}));
    if (r.status === 401 && !url.endsWith('/login')) { showLogin(); throw new Error('Sessão expirada'); }
    if (!r.ok) throw new Error(j.error || 'Erro');
    return j;
  };
  const fmtDate = iso => { try { return new Date(iso).toLocaleString('pt-PT', { dateStyle: 'short', timeStyle: 'short' }); } catch { return iso; } };
  const fmtDay = d => (d ? d.split('-').reverse().join('/') : '-');
  const reload = async () => { data = await api('GET', '/api/admin/data'); render(); };
  const newCount = () => data.reservations.filter(r => r.status === 'nova').length + data.events.filter(r => r.status === 'nova').length;

  /* ---------- login ---------- */
  const showLogin = () => {
    data = null;
    const err = h('p', { class: 'err' });
    const user = h('input', { name: 'user', value: 'admin', autocomplete: 'username', required: true });
    const pw = h('input', { name: 'password', type: 'password', autocomplete: 'current-password', required: true });
    app.replaceChildren(h('div', { class: 'login' },
      h('form', {
        onsubmit: async e => {
          e.preventDefault();
          err.textContent = '';
          try { await api('POST', '/api/login', { user: user.value, password: pw.value }); await reload(); }
          catch (x) { err.textContent = x.message; }
        }
      },
        h('img', { src: '/logo.png', alt: '' }),
        h('h1', null, 'Administração'),
        h('label', null, 'Utilizador', user),
        h('label', null, 'Palavra-passe', pw),
        err,
        h('button', { class: 'btn' }, 'Entrar'))));
  };

  /* ---------- ícones (SVG constantes, sem dados de utilizadores) ---------- */
  const P = {
    home: '<path d="M4 11 12 4l8 7v9h-5v-6H9v6H4z"/>',
    cal: '<rect x="4" y="5" width="16" height="15" rx="2.5"/><path d="M4 10h16M8 3v4M16 3v4M8 14h2M12 14h2M8 17h2"/>',
    calstar: '<rect x="4" y="5" width="16" height="15" rx="2.5"/><path d="M4 10h16M8 3v4M16 3v4"/><path d="m12 12.2.9 1.9 2.1.3-1.5 1.5.4 2.1-1.9-1-1.9 1 .4-2.1-1.5-1.5 2.1-.3z"/>',
    doc: '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5M10 13h6M10 17h6"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    image: '<rect x="3" y="4" width="18" height="16" rx="2.5"/><circle cx="9" cy="10" r="1.6"/><path d="m4 18 5-5 4 4 3-3 4 4"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7"/>',
    ext: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
    out: '<path d="M10 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h5M15 8l4 4-4 4M19 12H9"/>',
    chev: '<path d="m9 6 6 6-6 6"/>',
    down: '<path d="m6 9 6 6 6-6"/>',
    inbox: '<path d="m4 13 2-8h12l2 8M4 13v6h16v-6M4 13h5l1 2h4l1-2h5"/>',
    sun: '<circle cx="12" cy="12" r="3.6"/><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M18.4 5.6l-1.8 1.8M7.4 16.6l-1.8 1.8"/>'
  };
  const ico = (name, cls = '') => {
    const e = document.createElement('span');
    e.className = 'ico ' + cls;
    e.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + P[name] + '</svg>';
    return e;
  };

  const svg = (cls, vb, inner, stretch) => {
    const t = document.createElement('div');
    t.innerHTML = '<svg class="' + cls + '" viewBox="' + vb + '"' + (stretch ? ' preserveAspectRatio="none"' : '') + ' aria-hidden="true">' + inner + '</svg>';
    return t.firstChild;
  };

  /* ---------- estrutura ---------- */
  const tabs = [
    ['resumo', 'Resumo', 'home'], ['reservas', 'Reservas', 'cal'], ['eventos', 'Eventos', 'calstar'],
    ['textos', 'Textos', 'doc'], ['servicos', 'Serviços', 'gear'], ['galeria', 'Galeria', 'image'], ['conta', 'Conta', 'user']
  ];
  const go = k => { tab = k; filter = 'todas'; render(); scrollTo({ top: 0 }); };
  let menuOpen = false;

  const render = () => {
    const nr = data.reservations.filter(r => r.status === 'nova').length;
    const ne = data.events.filter(r => r.status === 'nova').length;
    const count = { reservas: nr, eventos: ne };
    const side = h('aside', { class: 'side' },
      h('a', { class: 'logo', href: '/', target: '_blank', rel: 'noopener', 'aria-label': 'Ver o site' }, h('img', { src: '/logo.png', alt: 'Tinguita Paradise' })),
      h('nav', { class: 'menu' }, tabs.map(([k, l, i]) => h('button', { class: 'tab' + (tab === k ? ' on' : ''), onclick: () => go(k) },
        ico(i), h('span', { class: 'lbl' }, l), count[k] ? h('span', { class: 'badge' }, count[k]) : null))),
      h('div', { class: 'sp' }),
      h('div', { class: 'menu low' },
        h('a', { class: 'tab', href: '/', target: '_blank', rel: 'noopener' }, ico('ext'), h('span', { class: 'lbl' }, 'Ver o site')),
        h('button', { class: 'tab', onclick: async () => { await api('POST', '/api/logout'); showLogin(); } }, ico('out'), h('span', { class: 'lbl' }, 'Terminar sessão'))));
    const view = { resumo: vResumo, reservas: () => vRequests('reservas'), eventos: () => vRequests('eventos'), textos: vTextos, servicos: vServicos, galeria: vGaleria, conta: vConta }[tab]();
    app.replaceChildren(h('div', { class: 'shell' }, side, h('main', { class: 'main' }, h('div', { class: 'bg', 'aria-hidden': 'true' }), view)));
  };

  // cabeçalho da página com fotografia, etiqueta, título e menu de boas-vindas
  const title = (t, sub) => {
    const name = (data.user || 'admin').replace(/^./, c => c.toUpperCase());
    const dd = h('div', { class: 'dd' + (menuOpen ? ' open' : '') },
      h('button', { onclick: () => { menuOpen = false; go('conta'); } }, ico('user'), 'Conta'),
      h('button', { onclick: async () => { await api('POST', '/api/logout'); showLogin(); } }, ico('out'), 'Terminar sessão'));
    return h('header', { class: 'page-head' },
      h('div', { class: 'welcome' },
        h('button', { class: 'wbtn', 'aria-haspopup': 'true', 'aria-expanded': String(menuOpen), onclick: e => { menuOpen = !menuOpen; e.currentTarget.parentElement.querySelector('.dd').classList.toggle('open', menuOpen); } },
          ico('sun', 'sun'), h('span', null, 'Bem-vindo, ', h('b', null, name)), ico('down', 'dn')),
        dd),
      h('p', { class: 'kicker' }, 'Painel administrativo'),
      h('h1', null, t),
      sub ? h('p', { class: 'lede' }, sub) : null);
  };
  const saveBtn = fn => h('div', { class: 'sticky' }, h('button', {
    class: 'btn',
    onclick: async e => {
      e.target.disabled = true;
      try { await fn(); toast('Guardado'); await reload(); } catch (x) { toast(x.message, true); }
      e.target.disabled = false;
    }
  }, 'Guardar alterações'));

  /* ---------- resumo ---------- */
  const vResumo = () => {
    const nr = data.reservations.filter(r => r.status === 'nova').length;
    const ne = data.events.filter(r => r.status === 'nova').length;
    const latest = [...data.reservations.map(r => ({ ...r, kind: 'Reserva', to: 'reservas' })), ...data.events.map(r => ({ ...r, kind: 'Evento', to: 'eventos' }))]
      .sort((x, y) => y.createdAt.localeCompare(x.createdAt)).slice(0, 6);
    const stat = (tone, icon, n, label, to) => h('button', { class: 'stat ' + tone, onclick: () => go(to) },
      h('span', { class: 'row1' }, h('span', { class: 'ib' }, ico(icon)), h('span', { class: 'go' }, ico('chev'))),
      h('b', null, String(n)),
      h('span', { class: 'lb' }, label),
      svg('wv', '0 0 200 70', '<path d="M0 70C50 66 110 18 200 0V70Z"/>'));
    const stats = h('section', { class: 'stats' },
      stat('gold', 'cal', nr, 'Reservas novas', 'reservas'),
      stat('blue', 'calstar', ne, 'Eventos novos', 'eventos'),
      stat('green', 'doc', data.reservations.length + data.events.length, 'Pedidos no total', 'reservas'),
      stat('violet', 'image', data.gallery.length, 'Fotos na galeria', 'galeria'));

    const body = latest.length
      ? h('div', { class: 'rows' }, latest.map(r => h('button', { class: 'rrow', onclick: () => go(r.to) },
        h('span', { class: 'who' }, h('b', null, r.nome), h('small', null, r.kind + ' · ' + fmtDate(r.createdAt))),
        h('span', { class: 'ph' }, r.telefone),
        h('span', { class: 'pill ' + r.status }, r.status))))
      : h('div', { class: 'empty2' },
        h('span', { class: 'eb' }, ico('inbox')),
        h('h3', null, 'Ainda não há pedidos.'),
        h('p', null, 'Quando houver pedidos, eles aparecerão aqui.'));
    const wv = svg('ew', '0 0 1000 120', '<path d="M0 120C120 60 260 50 420 100C500 125 560 130 600 120V120H0Z"/><path d="M1000 120C900 70 800 60 700 100C660 116 640 124 600 120V120H1000Z"/>', true);
    const panel = h('section', { class: 'recent' },
      h('div', { class: 'rh' },
        h('span', { class: 'ib' }, ico('doc')),
        h('h2', null, 'Pedidos recentes'),
        h('button', { class: 'all', onclick: () => go('reservas') }, 'Ver todos', ico('chev'))),
      h('div', { class: 'rbody' }, latest.length ? null : wv, body));

    return h('div', null,
      title('Resumo', 'Visão geral do site Tinguita Paradise. Acompanhe reservas, eventos, pedidos e mantenha o conteúdo sempre atualizado.'),
      stats, panel);
  };

  /* ---------- reservas e eventos ---------- */
  const vRequests = kind => {
    const list = data[kind === 'reservas' ? 'reservations' : 'events'];
    const shown = filter === 'todas' ? list : list.filter(r => r.status === filter);
    const filters = h('div', { class: 'filters' }, ['todas', 'nova', 'confirmada', 'cancelada'].map(f =>
      h('button', { class: 'btn ghost sm' + (filter === f ? ' on' : ''), onclick: () => { filter = f; render(); } }, f[0].toUpperCase() + f.slice(1))));
    const card = r => h('div', { class: 'card req' },
      h('div', { class: 'head' }, h('span', { class: 'name' }, r.nome), h('span', null, r.notified ? h('span', { class: 'pill confirmada', title: 'A empresa foi avisada no WhatsApp' }, 'WhatsApp avisado') : null, ' ', h('span', { class: 'pill ' + r.status }, r.status))),
      h('div', { class: 'meta' },
        h('span', null, 'Recebido em ' + fmtDate(r.createdAt)),
        h('a', { href: 'tel:' + r.telefone.replace(/[^\d+]/g, '') }, r.telefone),
        r.email ? h('a', { href: 'mailto:' + r.email }, r.email) : null,
        kind === 'reservas'
          ? [h('span', null, `Entrada ${fmtDay(r.checkin)}`), h('span', null, `Saída ${fmtDay(r.checkout)}`), h('span', null, `${r.hospedes} hóspede(s)`)]
          : [h('span', null, r.tipo), h('span', null, 'Data: ' + fmtDay(r.data))]),
      r.mensagem ? h('div', { class: 'note' }, r.mensagem) : null,
      h('div', { class: 'act' },
        ['nova', 'confirmada', 'cancelada'].filter(s => s !== r.status).map(s =>
          h('button', { class: 'btn ghost sm', onclick: async () => { await api('PATCH', `/api/admin/${kind}/${r.id}`, { status: s }); toast('Estado atualizado'); reload(); } }, 'Marcar ' + s)),
        h('button', { class: 'btn danger sm', onclick: async () => { if (confirm('Apagar este pedido?')) { await api('DELETE', `/api/admin/${kind}/${r.id}`); reload(); } } }, 'Apagar')));
    return h('div', null,
      title(kind === 'reservas' ? 'Reservas' : 'Pedidos de eventos', 'Pedidos feitos pelo site'),
      filters,
      shown.length ? h('div', { class: 'grid' }, shown.map(card)) : h('div', { class: 'card empty' }, 'Nada para mostrar.'));
  };

  /* ---------- textos ---------- */
  const textGroups = [
    ['Início (vídeo)', [['heroTag', 'Etiqueta', 1], ['heroTitle', 'Título de boas-vindas', 1], ['heroLead', 'Frase de apresentação', 2]]],
    ['Painéis do vídeo', [['panelRoomsTitle', 'Quartos: título', 1], ['panelFoodTitle', 'Gastronomia: título', 1], ['panelFoodLead', 'Gastronomia: texto', 2], ['panelEventsTitle', 'Eventos: título', 1], ['panelEventsLead', 'Eventos: texto', 2]]],
    ['Sobre nós', [['aboutTitle', 'Título', 1], ['aboutText', 'Texto', 3]]],
    ['Quartos', [['roomsTitle', 'Título', 1], ['roomsText', 'Texto', 3]]],
    ['Restaurante e bar', [['restTitle', 'Título', 1], ['restText', 'Texto', 3]]],
    ['Eventos', [['eventsTitle', 'Título', 1], ['eventsText', 'Texto', 3]]],
    ['Contactos', [['address', 'Endereço', 1], ['phone', 'Telefone', 1], ['hours', 'Horário', 1]]],
    ['Rodapé', [['footerText', 'Frase do rodapé', 2]]]
  ];
  const vTextos = () => {
    const inputs = {};
    const body = textGroups.map(([g, fields]) => h('div', { class: 'card group' }, h('h3', null, g),
      fields.map(([k, label, rows]) => {
        inputs[k] = rows === 1 ? h('input', { value: data.content[k] || '' }) : h('textarea', { rows }, data.content[k] || '');
        if (rows !== 1) inputs[k].value = data.content[k] || '';
        return h('label', null, label, inputs[k]);
      })));
    return h('div', null,
      title('Textos do site', 'Altere qualquer texto, telefone, endereço ou horário'),
      h('div', { class: 'fields' }, body),
      saveBtn(() => api('PUT', '/api/admin/content', Object.fromEntries(Object.entries(inputs).map(([k, i]) => [k, i.value])))));
  };

  /* ---------- imagens ---------- */
  const uploadFiles = async files => {
    const fd = new FormData();
    [...files].forEach(f => fd.append('files', f));
    const r = await api('POST', '/api/admin/upload', fd);
    return r.files;
  };
  const pickFiles = (multiple, onDone) => {
    const inp = h('input', { type: 'file', accept: 'image/*', multiple });
    inp.addEventListener('change', async () => {
      if (!inp.files.length) return;
      toast('A enviar...');
      try { onDone(await uploadFiles(inp.files)); } catch (x) { toast(x.message, true); }
    });
    inp.click();
  };
  const move = (arr, i, d) => { const j = i + d; if (j < 0 || j >= arr.length) return; [arr[i], arr[j]] = [arr[j], arr[i]]; };

  /* ---------- serviços ---------- */
  const vServicos = () => {
    const list = data.services.map(s => ({ ...s }));
    const known = () => [...new Set([...data.gallery.map(g => g.src), ...list.map(s => s.image)].filter(Boolean))];
    const draw = () => {
      box.replaceChildren(...list.map((s, i) => {
        const thumb = h('img', { class: 'thumb', src: '/' + s.image, alt: '' });
        const sel = h('select', { onchange: e => { s.image = e.target.value; thumb.src = '/' + s.image; } },
          known().map(src => h('option', { value: src, selected: src === s.image }, src.replace(/^(images|uploads)\//, ''))));
        return h('div', { class: 'card svc' },
          h('div', null, thumb),
          h('div', { class: 'f' },
            h('label', null, 'Título', h('input', { value: s.title, oninput: e => (s.title = e.target.value) })),
            h('label', null, 'Descrição', h('textarea', { rows: 2, oninput: e => (s.text = e.target.value) }, s.text)),
            h('div', { class: 'grid cols' },
              h('label', null, 'Texto do botão', h('input', { value: s.label, oninput: e => (s.label = e.target.value) })),
              h('label', null, 'Ligação do botão', h('input', { value: s.href, placeholder: '#contacto', oninput: e => (s.href = e.target.value) }))),
            h('label', null, 'Foto', sel),
            h('div', { class: 'tools' },
              h('button', { class: 'btn ghost sm', onclick: () => pickFiles(false, f => { s.image = f[0]; draw(); }) }, 'Enviar nova foto'),
              h('button', { class: 'btn ghost sm', onclick: () => { move(list, i, -1); draw(); } }, 'Subir'),
              h('button', { class: 'btn ghost sm', onclick: () => { move(list, i, 1); draw(); } }, 'Descer'),
              h('button', { class: 'btn danger sm', onclick: () => { list.splice(i, 1); draw(); } }, 'Remover'))));
      }));
    };
    const box = h('div', { class: 'grid' });
    draw();
    return h('div', null,
      title('Serviços', 'Os cartões com foto da secção "O que oferecemos"'),
      box,
      h('div', { style: 'margin-top:16px' }, h('button', {
        class: 'btn ghost',
        onclick: () => { if (list.length >= 12) return toast('Máximo de 12 serviços', true); list.push({ id: '', title: 'Novo serviço', text: '', image: known()[0] || '', label: 'Saber mais', href: '#contacto' }); draw(); }
      }, 'Adicionar serviço')),
      saveBtn(() => api('PUT', '/api/admin/services', list)));
  };

  /* ---------- galeria ---------- */
  const vGaleria = () => {
    const list = data.gallery.map(g => ({ ...g }));
    const draw = () => {
      grid.replaceChildren(...list.map((g, i) => h('div', { class: 'card item' },
        h('img', { src: '/' + g.src, alt: '' }),
        h('input', { value: g.alt, placeholder: 'Descrição da foto', oninput: e => (g.alt = e.target.value) }),
        h('div', { class: 'tools' },
          h('span', { class: 'pos' }, `${i + 1} / ${list.length}`),
          h('span', null,
            h('button', { class: 'btn ghost sm', title: 'Mover para trás', onclick: () => { move(list, i, -1); draw(); } }, '<'), ' ',
            h('button', { class: 'btn ghost sm', title: 'Mover para a frente', onclick: () => { move(list, i, 1); draw(); } }, '>'), ' ',
            h('button', { class: 'btn danger sm', onclick: () => { list.splice(i, 1); draw(); } }, 'Remover')))
      )));
    };
    const add = files => { files.forEach(src => list.push({ id: '', src, alt: '' })); draw(); toast('Fotos adicionadas. Clique em Guardar.'); };
    const drop = h('div', { class: 'drop', onclick: () => pickFiles(true, add) }, 'Clique aqui ou arraste fotos para adicionar (JPG, PNG, WebP)');
    drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', async e => {
      e.preventDefault(); drop.classList.remove('over');
      if (!e.dataTransfer.files.length) return;
      try { add(await uploadFiles(e.dataTransfer.files)); } catch (x) { toast(x.message, true); }
    });
    const grid = h('div', { class: 'gal' });
    draw();
    return h('div', null,
      title('Galeria', 'A ordem aqui é a ordem no site. A primeira foto aparece em grande.'),
      drop, grid,
      saveBtn(() => api('PUT', '/api/admin/gallery', list)));
  };

  /* ---------- conta ---------- */
  const vConta = () => {
    const user = h('input', { value: data.user, autocomplete: 'username' });
    const cur = h('input', { type: 'password', autocomplete: 'current-password' });
    const nw = h('input', { type: 'password', autocomplete: 'new-password' });
    const nw2 = h('input', { type: 'password', autocomplete: 'new-password' });
    const err = h('p', { class: 'err' });
    return h('div', null,
      title('Conta', 'Utilizador e palavra-passe de acesso'),
      h('form', {
        class: 'card fields', style: 'max-width:460px',
        onsubmit: async e => {
          e.preventDefault(); err.textContent = '';
          if (nw.value !== nw2.value) { err.textContent = 'As palavras-passe novas não coincidem'; return; }
          try { await api('POST', '/api/admin/password', { user: user.value, current: cur.value, next: nw.value }); toast('Dados atualizados'); cur.value = nw.value = nw2.value = ''; await reload(); }
          catch (x) { err.textContent = x.message; }
        }
      },
        h('label', null, 'Utilizador', user),
        h('label', null, 'Palavra-passe atual', cur),
        h('label', null, 'Nova palavra-passe (mínimo 8 caracteres)', nw),
        h('label', null, 'Repetir nova palavra-passe', nw2),
        err,
        h('button', { class: 'btn' }, 'Atualizar')));
  };

  /* ---------- arranque ---------- */
  fetch('/api/me').then(r => r.json()).then(m => (m.auth ? reload() : showLogin())).catch(showLogin);
})();
