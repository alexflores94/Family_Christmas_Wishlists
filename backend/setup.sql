-- ============================================================================
-- Family Christmas Wishlist: database setup for Supabase
--
-- How to use: edit the two blocks marked "EDIT ME" (the family emails and the
-- three settings), paste this whole file into Supabase > SQL Editor, click Run.
-- It is safe to run again later. Re-running replaces the rules, emails and
-- schedule. It never deletes anyone's list.
--
-- Keep this file private. It holds the family's email addresses.
-- ============================================================================

create extension if not exists pg_net;
create extension if not exists pg_cron;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table if not exists public.members (
  key  text primary key,
  name text not null,
  sort int  not null
);

create table if not exists public.member_emails (
  key   text primary key references public.members(key) on delete cascade,
  email text not null unique
);

create table if not exists public.app_settings (
  key   text primary key,
  value text not null
);

create table if not exists public.lists (
  owner        text primary key references public.members(key) on delete cascade,
  submitted_at timestamptz,
  updated_at   timestamptz not null default now()
);

create table if not exists public.items (
  id           uuid primary key default gen_random_uuid(),
  owner        text not null references public.members(key) on delete cascade,
  name         text not null check (length(trim(name)) > 0 and length(name) <= 80),
  description  text not null check (length(trim(description)) > 0 and length(description) <= 300),
  link         text check (link is null or (link ~* '^https?://' and length(link) <= 2000)),
  price        text check (price is null or length(price) <= 60),
  price_as_of  text check (price_as_of is null or length(price_as_of) <= 30),
  position     int  not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists items_owner_idx on public.items(owner, position);

-- One buyer per item. The list's owner can never read these rows (see policies).
create table if not exists public.purchases (
  item_id    uuid primary key references public.items(id) on delete cascade,
  buyer      text not null references public.members(key) on delete cascade,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- EDIT ME 1 of 2: the family and the email each person signs in with.
-- Keep the keys (alex, jorge, ...) exactly as they are. Change only the emails.
-- ---------------------------------------------------------------------------
insert into public.members (key, name, sort) values
  ('alex',    'Alex',    1),
  ('jorge',   'Jorge',   2),
  ('brianne', 'Brianne', 3),
  ('mom',     'Mom',     4),
  ('dad',     'Dad',     5)
on conflict (key) do update set name = excluded.name, sort = excluded.sort;

insert into public.member_emails (key, email) values
  ('alex',    lower('PUT-ALEX-EMAIL-HERE@example.com')),
  ('jorge',   lower('PUT-JORGE-EMAIL-HERE@example.com')),
  ('brianne', lower('PUT-BRIANNE-EMAIL-HERE@example.com')),
  ('mom',     lower('PUT-MOM-EMAIL-HERE@example.com')),
  ('dad',     lower('PUT-DAD-EMAIL-HERE@example.com'))
on conflict (key) do update set email = excluded.email;

-- ---------------------------------------------------------------------------
-- EDIT ME 2 of 2: three settings.
--   site_url      the address of the published website (GitHub Pages)
--   mailer_url    the web app address you get from the Google Apps Script step
--   mailer_secret the same secret you typed into that script
-- ---------------------------------------------------------------------------
insert into public.app_settings (key, value) values
  ('site_url',      'https://YOUR-USERNAME.github.io/YOUR-REPO/'),
  ('mailer_url',    'PASTE-THE-APPS-SCRIPT-WEB-APP-URL-HERE'),
  ('mailer_secret', 'PASTE-THE-SECRET-HERE')
on conflict (key) do update set value = excluded.value;

-- ---------------------------------------------------------------------------
-- Who is signed in? Maps the login email to a family member key.
-- ---------------------------------------------------------------------------
create or replace function public.me()
returns text
language sql stable security definer
set search_path = public, pg_temp
as $$
  select key from public.member_emails
  where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  limit 1
$$;

create or replace function public.item_owner(p_item uuid)
returns text
language sql stable security definer
set search_path = public, pg_temp
as $$
  select owner from public.items where id = p_item
$$;

create or replace function public.list_submitted(p_owner text)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from public.lists where owner = p_owner and submitted_at is not null)
$$;

-- ---------------------------------------------------------------------------
-- Only the five family emails can create an account (so strangers never get a code).
-- ---------------------------------------------------------------------------
create or replace function public.only_family_signups()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (select 1 from public.member_emails where lower(email) = lower(new.email)) then
    raise exception 'This email is not on the family list';
  end if;
  return new;
end
$$;

drop trigger if exists only_family_signups on auth.users;
create trigger only_family_signups
  before insert on auth.users
  for each row execute function public.only_family_signups();

-- ---------------------------------------------------------------------------
-- List rules
-- ---------------------------------------------------------------------------
create or replace function public.touch_item()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end
$$;

drop trigger if exists items_touch on public.items;
create trigger items_touch before update on public.items
  for each row execute function public.touch_item();

-- A submitted list may never drop below 3 items.
create or replace function public.guard_item_delete()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if public.list_submitted(old.owner)
     and (select count(*) from public.items where owner = old.owner) <= 3 then
    raise exception 'A submitted list needs at least 3 items. Add another item first, then remove this one.';
  end if;
  return old;
end
$$;

drop trigger if exists items_guard_delete on public.items;
create trigger items_guard_delete before delete on public.items
  for each row execute function public.guard_item_delete();

-- ---------------------------------------------------------------------------
-- Email (sent through the Google Apps Script web app)
-- ---------------------------------------------------------------------------
create or replace function public.send_mail(p_to text[], p_subject text, p_html text)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_url    text;
  v_secret text;
begin
  select value into v_url    from public.app_settings where key = 'mailer_url';
  select value into v_secret from public.app_settings where key = 'mailer_secret';
  if v_url is null or v_url not like 'http%' or coalesce(array_length(p_to, 1), 0) = 0 then
    return;
  end if;
  perform net.http_post(
    url     := v_url,
    body    := jsonb_build_object('secret', v_secret, 'to', to_jsonb(p_to), 'subject', p_subject, 'html', p_html),
    headers := jsonb_build_object('Content-Type', 'application/json')
  );
exception when others then
  -- A failed email must never block a list from being saved.
  raise warning 'send_mail failed: %', sqlerrm;
end
$$;

create or replace function public.mail_html(p_heading text, p_body text, p_button text)
returns text
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare v_site text;
begin
  select value into v_site from public.app_settings where key = 'site_url';
  return format(
    '<div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:0 auto;border:1px solid #d5e3d7;border-radius:14px;overflow:hidden">'
    || '<div style="background:#134a32;color:#ffffff;padding:18px 22px;font-size:20px">%s</div>'
    || '<div style="padding:20px 22px;color:#14261b;font-size:15px;line-height:1.5">'
    || '<p style="margin:0 0 18px">%s</p>'
    || '<p style="margin:0"><a href="%s" style="background:#176a43;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:8px;display:inline-block">%s</a></p>'
    || '</div></div>',
    p_heading, p_body, coalesce(v_site, '#'), p_button);
end
$$;

create or replace function public.notify_submitted(p_owner text)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_name text;
  v_n    int;
  v_to   text[];
begin
  select name into v_name from public.members where key = p_owner;
  select count(*) into v_n from public.items where owner = p_owner;
  select array_agg(email order by key) into v_to from public.member_emails where key <> p_owner;
  perform public.send_mail(
    v_to,
    v_name || ' shared their Christmas wishlist',
    public.mail_html(
      v_name || ' shared a list',
      v_name || ' just submitted a wishlist with ' || v_n || case when v_n = 1 then ' item. ' else ' items. ' end
        || 'Open it to see what they would like, and mark anything you buy so nobody doubles up.',
      'Open the wishlist')
  );
end
$$;

-- Runs every morning. Sends a reminder only every 3rd day, from Thanksgiving
-- through the day before Christmas, and only to people who have not submitted.
create or replace function public.send_reminders(p_today date default null)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  d         date := coalesce(p_today, (now() at time zone 'America/Los_Angeles')::date);
  y         int  := extract(year from coalesce(p_today, (now() at time zone 'America/Los_Angeles')::date))::int;
  nov1      date;
  thanks    date;
  christmas date;
  v_to      text[];
  v_in      int;
  v_all     int;
begin
  nov1      := make_date(y, 11, 1);
  thanks    := nov1 + ((4 - extract(dow from nov1)::int + 7) % 7) + 21;  -- 4th Thursday of November
  christmas := make_date(y, 12, 25);

  if d < thanks or d >= christmas then return; end if;
  if (d - thanks) % 3 <> 0 then return; end if;

  select array_agg(me.email order by me.key) into v_to
  from public.member_emails me
  where not exists (
    select 1 from public.lists l where l.owner = me.key and l.submitted_at is not null
  );
  if v_to is null then return; end if;

  select count(*) into v_in  from public.lists where submitted_at is not null;
  select count(*) into v_all from public.members;

  perform public.send_mail(
    v_to,
    'Reminder: add your Christmas wishlist',
    public.mail_html(
      'Your wishlist is not in yet',
      v_in || ' of ' || v_all || ' family lists are in, and Christmas is ' || (christmas - d)
        || ' days away. Add at least 3 things you would love and submit your list so the family can start shopping.',
      'Add my wishlist')
  );
end
$$;

-- ---------------------------------------------------------------------------
-- Submitting a list. The browser calls this; it checks the rules, then emails the family.
-- ---------------------------------------------------------------------------
create or replace function public.submit_list()
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  m          text := public.me();
  n          int;
  first_time boolean;
begin
  if m is null then
    raise exception 'This email is not on the family list';
  end if;

  select count(*) into n from public.items where owner = m;
  if n < 3 then
    raise exception 'Add at least 3 items before submitting';
  end if;

  select (submitted_at is null) into first_time from public.lists where owner = m;

  insert into public.lists (owner, submitted_at, updated_at)
  values (m, now(), now())
  on conflict (owner) do update
    set submitted_at = coalesce(public.lists.submitted_at, now()),
        updated_at   = now();

  if coalesce(first_time, true) then
    perform public.notify_submitted(m);
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Access rules (row level security). This is what keeps purchases hidden from
-- the person whose list they are on: the database itself refuses to return them.
-- ---------------------------------------------------------------------------
alter table public.members       enable row level security;
alter table public.member_emails enable row level security;
alter table public.app_settings  enable row level security;
alter table public.lists         enable row level security;
alter table public.items         enable row level security;
alter table public.purchases     enable row level security;

drop policy if exists members_read on public.members;
create policy members_read on public.members
  for select to authenticated using (public.me() is not null);

drop policy if exists lists_read on public.lists;
create policy lists_read on public.lists
  for select to authenticated using (public.me() is not null);

-- You always see your own items (drafts included). Others see them only after you submit.
drop policy if exists items_read on public.items;
create policy items_read on public.items
  for select to authenticated
  using (public.me() is not null and (owner = public.me() or public.list_submitted(owner)));

drop policy if exists items_insert on public.items;
create policy items_insert on public.items
  for insert to authenticated with check (owner = public.me());

drop policy if exists items_update on public.items;
create policy items_update on public.items
  for update to authenticated using (owner = public.me()) with check (owner = public.me());

drop policy if exists items_delete on public.items;
create policy items_delete on public.items
  for delete to authenticated using (owner = public.me());

-- Purchases: never visible to the owner of the item, and nobody can mark their own gifts.
drop policy if exists purchases_read on public.purchases;
create policy purchases_read on public.purchases
  for select to authenticated
  using (public.me() is not null and public.item_owner(item_id) <> public.me());

drop policy if exists purchases_insert on public.purchases;
create policy purchases_insert on public.purchases
  for insert to authenticated
  with check (
    buyer = public.me()
    and public.item_owner(item_id) <> public.me()
    and public.list_submitted(public.item_owner(item_id))
  );

drop policy if exists purchases_delete on public.purchases;
create policy purchases_delete on public.purchases
  for delete to authenticated using (buyer = public.me());

-- ---------------------------------------------------------------------------
-- Permissions: signed-in family members get only what the rules above allow.
-- ---------------------------------------------------------------------------
grant usage on schema public to authenticated;

revoke all on all tables in schema public from anon, authenticated;
grant select on public.members, public.lists to authenticated;
grant select, insert, update, delete on public.items to authenticated;
grant select, insert, delete on public.purchases to authenticated;

revoke all on all functions in schema public from public, anon, authenticated;
grant execute on function public.me(), public.item_owner(uuid), public.list_submitted(text), public.submit_list() to authenticated;

-- ---------------------------------------------------------------------------
-- Daily schedule: 9:00 AM Pacific (17:00 UTC) every day. The function itself
-- decides whether today is a reminder day.
-- ---------------------------------------------------------------------------
select cron.schedule('wishlist-daily-reminders', '0 17 * * *', 'select public.send_reminders();');
