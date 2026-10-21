-- Tinguita Paradise: esquema da base de dados (Supabase / PostgreSQL)
-- Seguro para executar várias vezes (idempotente).

-- ---------- conteúdo público do site ----------
create table if not exists public.site_content (
  key        text primary key,
  value      text not null default '',
  updated_at timestamptz not null default now()
);

create table if not exists public.services (
  id       text primary key,
  position int  not null default 0,
  title    text not null default '',
  text     text not null default '',
  image    text not null default '',
  label    text not null default '',
  href     text not null default ''
);

create table if not exists public.gallery (
  id       text primary key,
  position int  not null default 0,
  src      text not null,
  alt      text not null default ''
);

-- ---------- pedidos dos visitantes ----------
create table if not exists public.reservations (
  id         text primary key,
  created_at timestamptz not null default now(),
  status     text not null default 'nova' check (status in ('nova', 'confirmada', 'cancelada')),
  nome       text not null check (char_length(nome) between 1 and 100),
  telefone   text not null check (char_length(telefone) between 1 and 30),
  email      text not null default '' check (char_length(email) <= 120),
  mensagem   text not null default '' check (char_length(mensagem) <= 1000),
  checkin    date not null,
  checkout   date not null,
  hospedes   int  not null default 1 check (hospedes between 1 and 20)
);

create table if not exists public.events (
  id         text primary key,
  created_at timestamptz not null default now(),
  status     text not null default 'nova' check (status in ('nova', 'confirmada', 'cancelada')),
  nome       text not null check (char_length(nome) between 1 and 100),
  telefone   text not null check (char_length(telefone) between 1 and 30),
  email      text not null default '' check (char_length(email) <= 120),
  mensagem   text not null default '' check (char_length(mensagem) <= 1000),
  tipo       text not null default '' check (char_length(tipo) <= 40),
  data       date
);

-- ---------- acesso à administração (uma única conta) ----------
create table if not exists public.admin_user (
  id       int primary key default 1 check (id = 1),
  username text not null,
  salt     text not null,
  hash     text not null
);

create index if not exists reservations_created_idx on public.reservations (created_at desc);
create index if not exists events_created_idx       on public.events (created_at desc);
create index if not exists services_position_idx    on public.services (position);
create index if not exists gallery_position_idx     on public.gallery (position);

-- ---------- segurança ao nível das linhas (RLS) ----------
alter table public.site_content  enable row level security;
alter table public.services      enable row level security;
alter table public.gallery       enable row level security;
alter table public.reservations  enable row level security;
alter table public.events        enable row level security;
alter table public.admin_user    enable row level security;

-- o conteúdo do site é público para leitura (chave anon/publishable)
drop policy if exists "leitura publica" on public.site_content;
create policy "leitura publica" on public.site_content for select to anon, authenticated using (true);
drop policy if exists "leitura publica" on public.services;
create policy "leitura publica" on public.services     for select to anon, authenticated using (true);
drop policy if exists "leitura publica" on public.gallery;
create policy "leitura publica" on public.gallery      for select to anon, authenticated using (true);

-- reservas, eventos e a conta de administração: sem políticas para anon/authenticated.
-- Só o servidor (ligação direta como "postgres") lê e escreve nessas tabelas.
revoke all on public.reservations, public.events, public.admin_user from anon, authenticated;
-- ninguém na API pública escreve conteúdo
revoke insert, update, delete, truncate on public.site_content, public.services, public.gallery from anon, authenticated;

-- aviso no WhatsApp: indica se a empresa foi avisada do pedido
alter table public.reservations add column if not exists notified boolean not null default false;
alter table public.events       add column if not exists notified boolean not null default false;
