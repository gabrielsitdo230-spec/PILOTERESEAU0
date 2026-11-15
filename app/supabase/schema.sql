-- ============================================================
-- PILOTE RÉSEAU — Schéma Supabase / PostgreSQL (Étape 4)
-- À coller dans : Supabase Dashboard → SQL Editor → Run
-- Sécurité : RLS activée partout, un utilisateur ne voit QUE son workspace.
-- ============================================================

create extension if not exists "pgcrypto";

-- ---------- Types ----------
do $$ begin create type channel_type as enum ('whatsapp','facebook','instagram','tiktok'); exception when duplicate_object then null; end $$;
do $$ begin create type account_status as enum ('connected','expired','error'); exception when duplicate_object then null; end $$;
do $$ begin create type conv_status as enum ('open','human','closed','paused'); exception when duplicate_object then null; end $$;
do $$ begin create type msg_direction as enum ('in','out'); exception when duplicate_object then null; end $$;
do $$ begin create type msg_sender as enum ('contact','ai','human','system'); exception when duplicate_object then null; end $$;
do $$ begin create type plan_code as enum ('starter','standard','pro','premium','business'); exception when duplicate_object then null; end $$;

-- ---------- Tables ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text, phone text, country text, language text not null default 'fr',
  created_at timestamptz not null default now()
);

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.assistants (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  channel channel_type not null,
  mission text not null default 'repondre',
  instructions text not null default '',
  tone text, language text not null default 'fr',
  is_active boolean not null default true,
  handoff_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Jetons Meta CHIFFRÉS (AES-256-GCM côté serveur) — jamais en clair, jamais côté front
create table if not exists public.connected_accounts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  channel channel_type not null,
  external_id text not null,             -- phone_number_id WhatsApp / Page ID / IG ID
  display_name text,
  access_token_encrypted text not null,
  token_expires_at timestamptz,
  status account_status not null default 'connected',
  created_at timestamptz not null default now(),
  unique (channel, external_id)
);

create table if not exists public.knowledge_sources (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  assistant_id uuid references public.assistants(id) on delete set null,
  type text not null check (type in ('text','pdf','url','faq')),
  title text not null, content text not null default '',
  file_path text, status text not null default 'ready',
  created_at timestamptz not null default now()
);

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  assistant_id uuid references public.assistants(id) on delete set null,
  channel channel_type not null,
  external_conversation_id text,
  contact_external_id text not null,
  contact_name text, contact_phone text,
  status conv_status not null default 'open',
  assigned_to uuid references public.profiles(id),
  last_message_at timestamptz, last_inbound_at timestamptz, -- last_inbound_at sert à la fenêtre 24h Meta
  unread_count int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists idx_conv_workspace on public.conversations(workspace_id, last_message_at desc);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  direction msg_direction not null,
  sender msg_sender not null,
  content text not null,
  external_message_id text unique,       -- anti-doublon webhook
  credits_used int not null default 0,
  status text not null default 'sent',
  created_at timestamptz not null default now()
);
create index if not exists idx_msg_conv on public.messages(conversation_id, created_at);

create table if not exists public.plans (
  code plan_code primary key, name text not null,
  price_monthly numeric not null, currency text not null default 'USD',
  credits_included int not null, max_assistants int not null, features jsonb not null default '{}'
);
insert into public.plans(code,name,price_monthly,credits_included,max_assistants) values
  ('starter','Starter',2,500,1),('pro','Pro',10,3500,3),('business','Business',59,10000,99)
on conflict (code) do nothing;

create table if not exists public.credit_accounts (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  balance int not null default 0 check (balance >= 0),
  plan plan_code not null default 'starter',
  plan_expires_at timestamptz
);

create table if not exists public.credit_transactions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  amount int not null, type text not null, reference text,
  created_at timestamptz not null default now()
);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  provider text not null, provider_ref text unique,
  amount numeric not null, currency text not null, method text,
  status text not null default 'pending', credits_granted int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.handoff_alerts (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  reason text, notified_via text, is_read boolean not null default false,
  created_at timestamptz not null default now()
);

-- ---------- Débit de crédit ATOMIQUE (jamais négatif, pas de double débit) ----------
create or replace function public.consume_credit(p_workspace uuid)
returns boolean language plpgsql security definer as $$
declare v_balance int;
begin
  update public.credit_accounts set balance = balance - 1
   where workspace_id = p_workspace and balance > 0
  returning balance into v_balance;
  if not found then return false; end if;
  insert into public.credit_transactions(workspace_id, amount, type) values (p_workspace, -1, 'message_sent');
  return true;
end $$;

-- ---------- Row Level Security : chacun ne voit que SON workspace ----------
alter table public.profiles enable row level security;
alter table public.workspaces enable row level security;
alter table public.assistants enable row level security;
alter table public.connected_accounts enable row level security;
alter table public.knowledge_sources enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.credit_accounts enable row level security;
alter table public.credit_transactions enable row level security;
alter table public.payments enable row level security;
alter table public.handoff_alerts enable row level security;

create or replace function public.my_workspace_ids()
returns setof uuid language sql stable security definer as $$
  select id from public.workspaces where owner_id = auth.uid()
$$;

do $$
declare t text;
begin
  foreach t in array array['workspaces','assistants','connected_accounts','knowledge_sources','conversations','credit_accounts','credit_transactions','payments'] loop
    execute format('drop policy if exists %I_own on public.%I', t, t);
  end loop;
end $$;

create policy workspaces_own on public.workspaces
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy assistants_own on public.assistants
  for all using (workspace_id in (select public.my_workspace_ids())) with check (workspace_id in (select public.my_workspace_ids()));
create policy accounts_own on public.connected_accounts
  for all using (workspace_id in (select public.my_workspace_ids())) with check (workspace_id in (select public.my_workspace_ids()));
create policy knowledge_own on public.knowledge_sources
  for all using (workspace_id in (select public.my_workspace_ids())) with check (workspace_id in (select public.my_workspace_ids()));
create policy conversations_own on public.conversations
  for all using (workspace_id in (select public.my_workspace_ids())) with check (workspace_id in (select public.my_workspace_ids()));
create policy credits_own on public.credit_accounts
  for all using (workspace_id in (select public.my_workspace_ids())) with check (workspace_id in (select public.my_workspace_ids()));
create policy credit_tx_own on public.credit_transactions
  for all using (workspace_id in (select public.my_workspace_ids())) with check (workspace_id in (select public.my_workspace_ids()));
create policy payments_own on public.payments
  for all using (workspace_id in (select public.my_workspace_ids())) with check (workspace_id in (select public.my_workspace_ids()));

-- Messages et alertes : via la conversation parente
create policy messages_own on public.messages
  for all using (conversation_id in (select id from public.conversations where workspace_id in (select public.my_workspace_ids())))
  with check (conversation_id in (select id from public.conversations where workspace_id in (select public.my_workspace_ids())));
create policy handoff_own on public.handoff_alerts
  for all using (conversation_id in (select id from public.conversations where workspace_id in (select public.my_workspace_ids())))
  with check (conversation_id in (select id from public.conversations where workspace_id in (select public.my_workspace_ids())));

create policy profiles_own on public.profiles
  for all using (id = auth.uid()) with check (id = auth.uid());

-- Plans : lecture publique (affichage tarifs)
alter table public.plans enable row level security;
create policy plans_read on public.plans for select using (true);

-- Migration si la base existe déjà :
-- alter type channel_type add value if not exists 'tiktok';

-- Migration si la base existe deja (enum plans elargi) :
-- alter type plan_code add value if not exists 'standard';
-- alter type plan_code add value if not exists 'premium';
