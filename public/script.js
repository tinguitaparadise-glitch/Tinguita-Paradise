(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  /* ---------- ecrã de carregamento: esqueleto até tudo estar pronto ---------- */
  const root = document.documentElement;
  const stage = { content: 0, fonts: 0, imgs: 0, video: 0 };
  const WEIGHT = { content: 0.05, fonts: 0.05, imgs: 0.25, video: 0.65 };
  const bootBar = $('#bootBar'), bootPct = $('#bootPct');
  const conn = navigator.connection;
  const slowNet = !!(conn && (conn.saveData || /(^|-)(2g|3g)/.test(conn.effectiveType || '')));
  const lite = () => slowNet || matchMedia('(max-width: 700px)').matches;
  // images/x.jpg -> images/x-s.jpg (800 px) quando o ecrã é pequeno ou a ligação é lenta
  // e usa WebP (cerca de 40% mais leve): o conteúdo guardado na base de dados ainda aponta para .jpg
  const lightSrc = src => {
    if (/^images\/[\w-]+\.jpg$/.test(src)) src = src.replace(/\.jpg$/, '.webp');
    return lite() && /^images\/[\w-]+\.webp$/.test(src) && !/-s\.webp$/.test(src) ? src.replace(/\.webp$/, '-s.webp') : src;
  };
  const lightenStatic = () => {
    $$('img[src^="images/"]').forEach(i => { const n = lightSrc(i.getAttribute('src')); if (n !== i.getAttribute('src')) i.setAttribute('src', n); });
    $$('[data-img]').forEach(b => { b.dataset.img = lightSrc(b.dataset.img); });
  };
  let bootDone = false;
  const bump = (k, v) => {
    stage[k] = Math.max(stage[k], Math.min(1, v));
    const total = Object.keys(WEIGHT).reduce((a, n) => a + WEIGHT[n] * stage[n], 0);
    if (bootBar) bootBar.style.transform = 'scaleX(' + total.toFixed(3) + ')';
    if (bootPct) bootPct.textContent = Math.round(total * 100);
  };
  const finishBoot = () => {
    if (bootDone) return;
    bootDone = true;
    window.__ready = true;
    if (!root.classList.contains('boot')) return;
    if (bootBar) bootBar.style.transform = 'scaleX(1)';
    if (bootPct) bootPct.textContent = '100';
    setTimeout(() => {
      root.classList.add('boot-out');
      setTimeout(() => root.classList.remove('boot', 'boot-out'), 650);
    }, 250);
  };
  setTimeout(finishBoot, 30000);   // limite: nunca prende o visitante mais de 30 s

  // vídeo: descarrega para memória com progresso (rolagem sem pedidos de rede); ecrãs pequenos usam a versão leve
  const loadVideo = () => new Promise(done => {
    const vid = $('#vid');
    const small = matchMedia('(max-width: 700px)').matches;
    const src = vid && (slowNet && vid.dataset.tiny ? vid.dataset.tiny : small && vid.dataset.small ? vid.dataset.small : vid.dataset.src);
    if (!src) { bump('video', 1); return done(); }
    vid.preload = 'auto';
    const ready = () => { bump('video', 1); done(); };
    vid.addEventListener('loadeddata', ready, { once: true });
    vid.addEventListener('error', ready, { once: true });
    (async () => {
      try {
        const res = await fetch(src);
        if (!res.ok || !res.body) throw new Error('vídeo');
        const total = +res.headers.get('content-length') || 0;
        const reader = res.body.getReader();
        const chunks = [];
        let got = 0;
        for (;;) {
          const { done: end, value } = await reader.read();
          if (end) break;
          chunks.push(value); got += value.length;
          if (total) bump('video', (got / total) * 0.97);
        }
        vid.src = URL.createObjectURL(new Blob(chunks, { type: 'video/mp4' }));
      } catch { vid.src = src; }
      vid.load();
    })();
  });

  // imagens: pré-carrega todas (as da página e as da galeria) e conta o progresso
  const preloadImages = () => {
    const urls = [...new Set([
      ...$$('img[src]').map(i => i.currentSrc || i.src),
      ...$$('[data-img]').map(b => new URL(b.dataset.img, location.href).href)
    ])];
    if (!urls.length) { bump('imgs', 1); return Promise.resolve(); }
    let n = 0;
    return Promise.all(urls.map(u => new Promise(ok => {
      const im = new Image();
      im.onload = im.onerror = () => { bump('imgs', ++n / urls.length); ok(); };
      im.src = u;
    })));
  };
  // esqueleto individual em cada imagem até ela chegar
  const skeletonImages = () => $$('.card-s > img, .g img, .slide img, .rest-img img, .banner img, .bm-photo img').forEach(img => {
    const card = img.matches('.card-s > img');
    const host = img.parentElement;
    if (card) img.classList.add('skel-self'); else host.classList.add('skel');
    const ok = () => { img.classList.add('ok'); if (!card && host.querySelectorAll('img:not(.ok)').length === 0) host.classList.add('ok-all'); };
    if (img.complete && img.naturalWidth) ok();
    else { img.addEventListener('load', ok, { once: true }); img.addEventListener('error', ok, { once: true }); }
  });

  /* ---------- conteúdo vindo da administração ---------- */
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };
  const safeHref = h => (/^(#|tel:|https?:\/\/|mailto:)/.test(h) ? h : '#');

  const applyContent = ({ content, services, gallery }) => {
    $$('[data-k]').forEach(n => {
      const v = content[n.dataset.k];
      if (v == null) return;
      const k = +n.dataset.accent;
      if (k) {
        const w = v.trim().split(/\s+/);
        const cut = Math.max(0, w.length - k);
        n.replaceChildren(document.createTextNode(w.slice(0, cut).join(' ') + (cut ? ' ' : '')), el('span', 'acc', w.slice(cut).join(' ')));
      } else n.textContent = v;
    });
    const digits = (content.phone || '').replace(/\D/g, '');
    if (digits) {
      const full = content.phone.trim().startsWith('+') ? digits : '244' + digits;
      $$('[data-tel]').forEach(a => { a.href = 'tel:+' + full; });
      $$('[data-wa]').forEach(a => { a.href = 'https://wa.me/' + full + '?text=' + encodeURIComponent('Olá! Gostaria de saber mais sobre o Tinguita Paradise.'); });
    }

    if (services && services.length) {
      const box = $('#cards');
      box.replaceChildren(...services.map((s, i) => {
        const card = el('article', 'card-s rv' + (i % 4 ? ' d' + (i % 4) : ''));
        if (s.image) { const img = el('img'); img.src = lightSrc(s.image); img.alt = s.title; img.loading = 'lazy'; card.append(img); }
        const body = el('div', 'body');
        body.append(el('h3', null, s.title), el('p', null, s.text));
        const href = s.href === '#whatsapp' ? '#whatsapp' : safeHref(s.href);
        let btn;
        if (href === '#whatsapp') {
          btn = el('a', 'btn btn-sm', s.label || 'Desfrutar');
          btn.href = $('[data-wa]')?.href || '#';
          btn.target = '_blank'; btn.rel = 'noopener'; btn.dataset.wa = '';
        } else {
          btn = el('button', 'btn btn-sm', s.label || 'Reservar');
          btn.type = 'button';
          if (href === '#reservas' || href === '#') btn.dataset.open = 'reservas';
          else btn.addEventListener('click', () => (href.startsWith('#') ? $(href)?.scrollIntoView({ behavior: 'smooth' }) : (location.href = href)));
        }
        body.append(btn);
        card.append(body);
        return card;
      }));
    }
    if (gallery && gallery.length) {
      $('#gallery').replaceChildren(...gallery.map((g, i) => {
        const b = el('button', 'g rv' + (i % 4 ? ' d' + (i % 4) : ''));
        b.type = 'button'; b.dataset.img = lightSrc(g.src);
        const img = el('img'); img.src = lightSrc(g.src); img.alt = g.alt || ''; img.loading = 'lazy';
        b.append(img);
        return b;
      }));
    }
  };

  // Arranque rápido: usa o conteúdo guardado na visita anterior; a versão nova vem da rede (já em cache no servidor)
  // e fica guardada para a próxima visita. Na primeira visita espera no máximo 1,2 s pela rede.
  const CACHE_KEY = 'tg:public:v1';
  const loadContent = async () => {
    let cached = null;
    try { cached = JSON.parse(localStorage.getItem(CACHE_KEY)); } catch { /* sem armazenamento local */ }
    const fresh = (async () => {
      try {
        const data = await (window.__pub || fetch('/api/public').then(r => (r.ok ? r.json() : null)));
        if (!data) return null;
        try { localStorage.setItem(CACHE_KEY, JSON.stringify(data)); } catch { /* cheio ou bloqueado */ }
        return data;
      } catch { return null; }
    })();
    if (cached && cached.content) { applyContent(cached); return; }
    const data = await Promise.race([fresh, new Promise(ok => setTimeout(ok, 6000))]);
    if (data) applyContent(data);
  };

  const init = () => {
    window.__motionReady = true;
    const vid = $('#vid');
    const story = $('#story');
    const hint = $('#hint');
    const panels = $$('.panel');
    let current = 0;

    // divide os títulos em palavras e letras para a animação de entrada
    $$('[data-split],[data-type]').forEach(e => {
      const text = e.textContent.trim();
      e.setAttribute('aria-label', text);
      e.textContent = '';
      e.classList.add('is-split');
      let i = 0;
      text.split(' ').forEach((word, wi, all) => {
        const w = el('span', 'w');
        w.setAttribute('aria-hidden', 'true');
        [...word].forEach(ch => {
          const c = el('span', 'c', ch);
          c.style.setProperty('--i', i++);
          w.appendChild(c);
        });
        e.appendChild(w);
        if (wi < all.length - 1) { e.appendChild(document.createTextNode(' ')); i++; }
      });
    });

    // efeito de escrita: revela as letras uma a uma, como se fossem digitadas
    const typer = $('[data-type]');
    const typed = typer ? $$('.c', typer) : [];
    let typeTimer = null;
    const startTyping = () => {
      stopTyping();
      let n = 0;
      typeTimer = setInterval(() => {
        if (n < typed.length) typed[n++].classList.add('t');
        else { clearInterval(typeTimer); typer.classList.add('done'); }
      }, 70);
    };
    const stopTyping = () => {
      clearInterval(typeTimer);
      typed.forEach(c => c.classList.remove('t'));
      typer && typer.classList.remove('done');
    };

    // medidas guardadas: ler offsetTop/offsetHeight a cada quadro obrigaria o navegador a recalcular o layout
    let storyTop = 0, storyH = 0, vh = innerHeight;
    const measure = () => { storyTop = story.offsetTop; storyH = story.offsetHeight; vh = innerHeight; };
    measure();
    const progress = () => Math.min(1, Math.max(0, (scrollY - storyTop) / Math.max(1, storyH - vh)));

    const DUR = +vid.dataset.dur || 29.1;

    vid.addEventListener('loadedmetadata', () => vid.pause());
    // iOS/Safari só decodifica frames depois de uma tentativa de play
    addEventListener('touchstart', () => vid.play().then(() => vid.pause()).catch(() => {}), { once: true, passive: true });

    let cur = 0, lastT = performance.now(), running = true, lastHint = -1;
    function wake() { if (!running) { running = true; lastT = performance.now(); requestAnimationFrame(tick); } }
    function tick(now) {
      const dt = Math.min(0.1, Math.max(0.001, (now - lastT) / 1000));
      lastT = now;
      const dur = vid.duration || DUR;
      const want = progress() * (dur - 0.05);                 // segundo do vídeo que a rolagem pede
      // aproximação suave dependente do tempo (igual a 60 ou 120 Hz) com velocidade máxima:
      // um salto grande percorre as cenas de forma contínua em vez de saltar
      let step = (want - cur) * (1 - Math.exp(-dt * 8));
      const max = 9 * dt;
      step = Math.max(-max, Math.min(max, step));
      cur += step;
      if (Math.abs(want - cur) < 0.004) cur = want;
      if (vid.readyState >= 2 && !vid.seeking && Math.abs(vid.currentTime - cur) > 0.012) vid.currentTime = cur;

      const hv = want > 0.3 ? 0 : 1;
      if (hv !== lastHint) { hint.style.opacity = hv; lastHint = hv; }
      const booting = !window.__ready;                          // o título só começa a ser escrito quando o site está pronto
      panels.forEach(p => {
        const on = !booting && cur >= +p.dataset.from && cur <= +p.dataset.to;   // o texto acompanha o que se vê no ecrã
        if (on !== p.classList.contains('on')) {
          p.classList.toggle('on', on);
          if (typer && p.contains(typer)) on ? startTyping() : stopTyping();
        }
      });
      // sem movimento e sem esqueleto: o ciclo pára (poupa CPU e bateria) e a rolagem volta a acordá-lo
      if (cur === want && !vid.seeking && !booting && (vid.readyState >= 2 || !vid.src)) { running = false; return; }
      requestAnimationFrame(tick);
    }
    addEventListener('scroll', wake, { passive: true });
    addEventListener('resize', () => { measure(); wake(); });
    vid.addEventListener('loadeddata', wake);
    vid.addEventListener('seeked', wake);
    if ('ResizeObserver' in window) new ResizeObserver(() => { measure(); wake(); }).observe(story);
    requestAnimationFrame(tick);

    const nav = $('#nav');
    const onScroll = () => nav.classList.toggle('solid', scrollY > storyTop + storyH - vh);
    addEventListener('scroll', onScroll, { passive: true }); onScroll();

    // galeria ampliada
    const lb = $('#lightbox');
    $$('.g').forEach(b => b.addEventListener('click', () => {
      $('img', lb).src = b.dataset.img;
      lb.showModal();
    }));
    lb.addEventListener('click', e => { if (e.target === lb) lb.close(); });

    // luz ambiente que segue o cursor nas secções escuras
    if (matchMedia('(hover: hover) and (pointer: fine)').matches) {
      $$('.feats, .dark, .final, footer').forEach(sec => {
        let ev = null;
        sec.addEventListener('pointermove', e => {
          if (ev) { ev = e; return; }
          ev = e;
          requestAnimationFrame(() => {
            const r = sec.getBoundingClientRect();
            sec.style.setProperty('--mx', ev.clientX - r.left + 'px');
            sec.style.setProperty('--my', ev.clientY - r.top + 'px');
            ev = null;
          });
        }, { passive: true });
      });
    }

    // barra de progresso da página
    const bar = $('#progress');
    const prog = () => { bar.style.width = (scrollY / (document.documentElement.scrollHeight - innerHeight || 1)) * 100 + '%'; };
    addEventListener('scroll', prog, { passive: true }); prog();

    // sobre: carrossel fotográfico (automático, pausa ao interagir, teclado e leitores de ecrã)
    const sl = $('#aboutSlider');
    const slides = $$('.slide', sl);
    const dots = $$('.a2-dots button', sl);
    const live = $('.slides', sl);
    const reduce = matchMedia('(prefers-reduced-motion: reduce)');
    let si = 0, timer = null, paused = false;
    const show = (i, user) => {
      const n = (i + slides.length) % slides.length;
      if (n === si) return;
      const from = slides[si], to = slides[n];
      from.classList.remove('on'); from.classList.add('out'); from.setAttribute('aria-hidden', 'true');
      to.classList.remove('out'); to.classList.add('on'); to.removeAttribute('aria-hidden');
      setTimeout(() => from.classList.remove('out'), 1000);
      dots.forEach((d, k) => { d.classList.toggle('on', k === n); d.setAttribute('aria-selected', k === n); });
      si = n;
      live.setAttribute('aria-live', user ? 'polite' : 'off');
    };
    const stop = () => { clearInterval(timer); timer = null; };
    const play = () => { stop(); if (!reduce.matches && !paused && !document.hidden) timer = setInterval(() => show(si + 1), 6000); };
    dots.forEach((d, k) => d.addEventListener('click', () => { show(k, true); play(); }));
    sl.addEventListener('keydown', e => {
      if (e.key === 'ArrowRight') { show(si + 1, true); play(); e.preventDefault(); }
      else if (e.key === 'ArrowLeft') { show(si - 1, true); play(); e.preventDefault(); }
    });
    sl.addEventListener('mouseenter', () => { paused = true; stop(); });
    sl.addEventListener('mouseleave', () => { paused = false; play(); });
    sl.addEventListener('focusin', () => { paused = true; stop(); });
    sl.addEventListener('focusout', () => { paused = false; play(); });
    document.addEventListener('visibilitychange', play);
    reduce.addEventListener?.('change', play);
    play();

    /* ---------- sistema de movimento (micro 220 ms · conteúdo 650 ms · cinematográfico 1000 ms) ---------- */
    const root = document.documentElement;
    const motion = root.classList.contains('js') && 'IntersectionObserver' in window;
    $$('.rv, .card-s, .g, .ci li').forEach(e => e.classList.remove('rv', 'd1', 'd2', 'd3'));
    const wide = () => innerWidth >= 900;

    if (motion) {
      // títulos: revelação por palavras, com máscara
      const splitWords = (node, out) => {
        [...node.childNodes].forEach(ch => {
          if (ch.nodeType === 3) {
            const frag = document.createDocumentFragment();
            ch.textContent.split(/(\s+)/).forEach(part => {
              if (!part) return;
              if (/^\s+$/.test(part)) { frag.append(document.createTextNode(' ')); return; }
              const m = el('span', 'wm');
              m.setAttribute('aria-hidden', 'true');
              const w = el('span', 'wi', part);
              w.style.setProperty('--wd', (out.n++ * 70) + 'ms');
              m.append(w);
              frag.append(m);
            });
            ch.replaceWith(frag);
          } else if (ch.nodeType === 1) splitWords(ch, out);
        });
      };

      const todo = [];
      const mark = (list, kind, delay = 0, ry = 12) => list.forEach(e => {
        if (e.dataset.r || e.closest('.panel, dialog, header')) return;
        e.dataset.r = kind;
        e.style.setProperty('--dl', delay + 'ms');
        e.style.setProperty('--ry', ry + 'px');
        todo.push(e);
      });

      $$('.sec .big, .dark .big, .finale .big, .about2 h2').forEach(h => {
        if (h.dataset.r) return;
        const text = h.textContent.trim();
        splitWords(h, { n: 0 });
        h.setAttribute('aria-label', text);
        h.dataset.r = 'words';
        todo.push(h);
      });
      mark($$('.sec .tag, .dark .tag, .finale .tag, .a2-tag'), 'fade', 0, 8);
      mark($$('.para, .a2-para, .head .sub'), 'fade', 140, 12);
      mark($$('.sec .btn, .dark .btn, .finale .btn').filter(b => !b.closest('.card-s')), 'fade', 260, 12);
      mark($$('.about-photo'), 'fade', 0, 24);
      mark($$('.banner, .rest-img'), 'photo');
      $$('.card-s').forEach((c, k) => mark([c], 'card', wide() ? (k % 4) * 90 : 0));
      $$('.g').forEach((g, k) => mark([g], 'tile', wide() ? (k % 4) * 90 : 0));
      $$('.ci li').forEach((c, k) => mark([c], 'fade', wide() ? k * 100 : 0, 24));
      $$('.wave').forEach(w => { w.dataset.r = 'wave'; todo.push(w); });

      // dispara quando o elemento atinge cerca de 85-90 % da altura visível; uma única vez
      const io = new IntersectionObserver(es => es.forEach(e => {
        if (!e.isIntersecting) return;
        const t = e.target;
        io.unobserve(t);
        t.classList.add('in');
        setTimeout(() => { t.style.setProperty('--dl', '0ms'); t.classList.add('done'); }, 1600);
      }), { rootMargin: '0px 0px -12% 0px', threshold: 0 });
      todo.forEach(t => io.observe(t));

      // frase curta escrita uma única vez (typewriter), com o texto completo para leitores de ecrã
      const tw = $('.foot-brand p');
      if (tw && tw.textContent.trim()) {
        const full = tw.textContent.trim();
        tw.setAttribute('aria-label', full);
        const typed = el('span', 'tw-vis'), rest = el('span', 'tw-rest', full);
        typed.setAttribute('aria-hidden', 'true'); rest.setAttribute('aria-hidden', 'true');
        tw.replaceChildren(typed, rest);
        const tio = new IntersectionObserver(es => {
          if (!es[0].isIntersecting) return;
          tio.disconnect();
          let i = 0;
          const t = setInterval(() => {
            i++;
            typed.textContent = full.slice(0, i);
            rest.textContent = full.slice(i);
            if (i >= full.length) clearInterval(t);
          }, 45);
        }, { threshold: 0.6 });
        tio.observe(tw);
      }

      // parallax discreto (apenas computador, 10-12 px)
      const clamp1 = v => Math.max(-1, Math.min(1, v));
      const parImgs = $$('.rest-img > img');
      const fin = $('.finale');
      const runPar = () => {
        if (!wide()) return;
        const vh = innerHeight;
        parImgs.forEach(img => {
          const b = img.parentElement.getBoundingClientRect();
          if (b.bottom < 0 || b.top > vh) return;
          img.style.translate = '0 ' + (-clamp1((b.top + b.height / 2 - vh / 2) / (vh / 2 + b.height / 2)) * 10).toFixed(1) + 'px';
        });
        if (fin) {
          const b = fin.getBoundingClientRect();
          if (b.bottom > 0 && b.top < vh) fin.style.setProperty('--py', (-clamp1((b.top + b.height / 2 - vh / 2) / (vh / 2 + b.height / 2)) * 12).toFixed(1) + 'px');
        }
      };
      let pq = false;
      const askPar = () => { if (!pq) { pq = true; requestAnimationFrame(() => { pq = false; runPar(); }); } };
      addEventListener('scroll', askPar, { passive: true });
      addEventListener('resize', askPar);
      runPar();
    }

    // menu: destaca a secção visível
    const links = $$('.nav nav a');
    const targets = links.map(a => $(a.getAttribute('href')));
    const spy = () => {
      let cur = 0;
      targets.forEach((t, k) => { if (t && k > 0 && t.getBoundingClientRect().top < innerHeight * 0.4) cur = k; });
      links.forEach((a, k) => a.classList.toggle('on', k === cur));
    };
    let spyQ = false;
    addEventListener('scroll', () => { if (!spyQ) { spyQ = true; requestAnimationFrame(() => { spyQ = false; spy(); }); } }, { passive: true }); spy();

    // janelas de reserva e evento
    $$('[data-open]').forEach(a => a.addEventListener('click', e => {
      e.preventDefault();
      const d = document.getElementById(a.dataset.open);
      resetForm($('form', d));
      d.showModal();
    }));
    $$('[data-close]').forEach(b => b.addEventListener('click', () => b.closest('dialog').close()));
    // resumo do pedido para WhatsApp (o visitante também pode avisar a empresa diretamente)
    const fmtDay = d => (d ? d.split('-').reverse().join('/') : '-');
    const summary = (kind, o) => (kind === 'reservas'
      ? ['*Nova reserva de quarto*', 'Nome: ' + o.nome, 'Telefone: ' + o.telefone, 'Entrada: ' + fmtDay(o.checkin), 'Saída: ' + fmtDay(o.checkout), 'Hóspedes: ' + o.hospedes, o.mensagem && 'Mensagem: ' + o.mensagem]
      : ['*Novo pedido de evento*', 'Nome: ' + o.nome, 'Telefone: ' + o.telefone, o.email && 'E-mail: ' + o.email, o.tipo && 'Tipo: ' + o.tipo, o.data && 'Data prevista: ' + fmtDay(o.data), o.mensagem && 'Mensagem: ' + o.mensagem]
    ).filter(Boolean).join('\n');
    const companyNumber = () => ((($('.wa') || {}).href || '').match(/wa\.me\/(\d+)/) || [])[1] || '';
    function resetForm(f) {
      $('.msg', f).textContent = '';
      const w = $('.wa-send', f); if (w) w.hidden = true;
      const c = $('[data-close]', f); if (c) c.textContent = 'Cancelar';
      const g = $('button:not([type=button])', f); if (g) g.hidden = false;
    }

    $$('dialog form[data-api]').forEach(f => f.addEventListener('submit', async e => {
      e.preventDefault();
      const msg = $('.msg', f);
      const btn = $('button:not([type=button])', f);
      msg.className = 'msg'; msg.textContent = 'A enviar...'; btn.disabled = true;
      try {
        const data = Object.fromEntries(new FormData(f));
        const r = await fetch('/api/' + f.dataset.api, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data)
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || 'Não foi possível enviar.');
        msg.textContent = 'Pedido enviado. Entraremos em contacto em breve.';
        const num = companyNumber();
        const w = $('.wa-send', f);
        if (w && num) { w.href = 'https://wa.me/' + num + '?text=' + encodeURIComponent(summary(f.dataset.api, data)); w.hidden = false; }
        const c = $('[data-close]', f); if (c) c.textContent = 'Fechar';
        btn.hidden = true;
        f.reset();
      } catch (err) {
        msg.className = 'msg err';
        msg.textContent = err.message || 'Não foi possível enviar. Ligue-nos para reservar.';
      } finally { btn.disabled = false; }
    }));
  };

  // o vídeo e as fontes começam já; o conteúdo entra; depois as imagens; só então o esqueleto sai
  const videoP = loadVideo();
  const fontsP = Promise.race([document.fonts ? document.fonts.ready : Promise.resolve(), new Promise(ok => setTimeout(ok, 4000))]).then(() => bump('fonts', 1));
  loadContent().finally(() => {
    bump('content', 1);
    init();
    lightenStatic();
    skeletonImages();
    Promise.all([fontsP, preloadImages(), videoP]).then(finishBoot);
  });
})();
