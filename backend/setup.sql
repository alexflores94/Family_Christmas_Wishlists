-- ============================================================================
-- Wishlist groups: database setup for Supabase (version 2)
--
-- FIRST-TIME INSTALL: edit the block marked "EDIT ME" (three settings), paste
-- this whole file into Supabase > SQL Editor, click Run.
--
-- UPGRADING from the single-family version: no edits needed. Paste the whole
-- file and Run. Your settings are kept, and the five family members, their
-- lists and their purchases are moved into a group called "Family Christmas"
-- (Alex is its admin). The old tables are kept, renamed legacy_*, as a backup.
--
-- Safe to run again. It never deletes anyone's list.
-- Keep this file private.
-- ============================================================================

create extension if not exists pg_net;

-- This script replaces the short-lived first version of the groups schema. If that
-- version was already installed, stop here instead of damaging its data.
do $guard$
begin
  if to_regclass('public.profiles') is not null
     and not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'id') then
    raise exception 'An earlier groups version is installed. Do not run this file yet; ask for the upgrade script.';
  end if;
end
$guard$;

-- ---------------------------------------------------------------------------
-- EDIT ME (first-time install only). Re-running never overwrites these once set.
--   site_url      the address of the published website, e.g. https://floreswishlists.vercel.app/
--   mailer_url    the web app address you get from the Google Apps Script step
--   mailer_secret the same secret you typed into that script
-- To change one later:  update public.app_settings set value = '...' where key = '...';
-- ---------------------------------------------------------------------------
create table if not exists public.app_settings (
  key   text primary key,
  value text not null
);
insert into public.app_settings (key, value) values
  ('site_url',      'https://YOUR-SITE-ADDRESS/'),
  ('mailer_url',    'PASTE-THE-APPS-SCRIPT-WEB-APP-URL-HERE'),
  ('mailer_secret', 'PASTE-THE-SECRET-HERE'),
  -- Groups archive themselves the day after their event date, counted in this time zone.
  ('timezone',      'America/Los_Angeles'),
  -- The one sign-in email that can open the Admin dashboard.
  ('owner_email',   'alexander.flores1030@gmail.com')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- Tables
-- People are identified by the email they sign in with (verified by the emailed code).
-- ---------------------------------------------------------------------------
-- Emails are used only to sign in. Everything the website reads is keyed by the private id,
-- and the email column cannot be read by signed-in users at all (see Permissions below).
create table if not exists public.profiles (
  id         uuid primary key default gen_random_uuid(),
  email      text not null unique check (email = lower(email)),
  name       text not null check (length(trim(name)) between 1 and 40),
  created_at timestamptz not null default now()
);

create table if not exists public.groups (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(trim(name)) between 1 and 60),
  event_date  date not null,
  item_min    int  not null default 3 check (item_min between 1 and 50),
  admin_id    uuid not null references public.profiles(id),
  created_at  timestamptz not null default now(),
  archived_at timestamptz
);
-- True when the group was archived because its event date passed (not by the admin).
alter table public.groups add column if not exists auto_archived boolean not null default false;
-- 'group' = people who each make a list for each other. 'registry' = a one-way wishlist: the admin writes the
-- lists (for kids, say) and everyone with the link can view them and pick gifts, but cannot make lists of their own.
alter table public.groups add column if not exists kind text not null default 'group';
-- 'secret_santa' = like a group, but nobody can read anyone else's list until the host draws names; then each
-- player can read (and buy from) only the one list they were given.
alter table public.groups drop constraint if exists groups_kind_check;
alter table public.groups add constraint groups_kind_check check (kind in ('group', 'registry', 'secret_santa'));
-- When the Secret Santa names were drawn (null until then). It cannot be undone.
alter table public.groups add column if not exists draw_at timestamptz;

-- The join link code. Only the group's admin can read it.
create table if not exists public.group_invites (
  group_id   uuid primary key references public.groups(id) on delete cascade,
  code       text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.group_members (
  group_id  uuid not null references public.groups(id) on delete cascade,
  member_id uuid not null references public.profiles(id),
  joined_at timestamptz not null default now(),
  primary key (group_id, member_id)
);
-- In a registry, the people the lists are FOR are stored as members flagged is_recipient. They are placeholders
-- (a name, no real email) and can never sign in.
alter table public.group_members add column if not exists is_recipient boolean not null default false;
-- In a normal group, a member can also make lists for other people (their kids, say). Those are placeholder
-- members flagged is_recipient, and managed_by is the member who made and edits the list.
alter table public.group_members add column if not exists managed_by uuid references public.profiles(id);

create table if not exists public.wish_lists (
  group_id     uuid not null,
  owner        uuid not null,
  submitted_at timestamptz,
  updated_at   timestamptz not null default now(),
  -- when the group was emailed about this list (used for lists made for someone else)
  notified_at  timestamptz,
  primary key (group_id, owner),
  foreign key (group_id, owner) references public.group_members(group_id, member_id) on delete cascade
);
alter table public.wish_lists add column if not exists notified_at timestamptz;
-- When the group was last emailed that this (already shared) list changed. Used to avoid sending an email per edit.
alter table public.wish_lists add column if not exists update_notified_at timestamptz;

create table if not exists public.wish_items (
  id          uuid primary key default gen_random_uuid(),
  group_id    uuid not null,
  owner       uuid not null,
  name        text not null check (length(trim(name)) > 0 and length(name) <= 80),
  description text not null check (length(trim(description)) > 0 and length(description) <= 300),
  link        text check (link is null or (link ~* '^https?://' and length(link) <= 2000)),
  price       text check (price is null or length(price) <= 60),
  price_as_of text check (price_as_of is null or length(price_as_of) <= 30),
  -- How many the owner would like. NULL means unlimited.
  quantity    int  default 1 check (quantity is null or quantity between 1 and 9999),
  position    int  not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  foreign key (group_id, owner) references public.group_members(group_id, member_id) on delete cascade
);
-- A photo of the item (an https address), filled in from the item's link when possible.
alter table public.wish_items add column if not exists image_url text;
do $$ begin
  alter table public.wish_items add constraint wish_items_image_url_check
    check (image_url is null or (image_url ~* '^https://' and length(image_url) <= 2000));
exception when duplicate_object then null; end $$;
create index if not exists wish_items_owner_idx on public.wish_items(group_id, owner, position);

-- Who has picked up an item. An item with quantity > 1 can have several claimers.
-- The list's owner can never read these rows (see policies).
create table if not exists public.claims (
  item_id    uuid not null references public.wish_items(id) on delete cascade,
  buyer      uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  primary key (item_id, buyer)
);

-- What a shopper paid for an item they claimed. Private to that shopper: nobody else,
-- including the list's owner and the other shoppers, can read it.
create table if not exists public.claim_prices (
  item_id    uuid not null,
  buyer      uuid not null,
  amount     numeric(10, 2) not null check (amount >= 0 and amount < 10000000),
  updated_at timestamptz not null default now(),
  primary key (item_id, buyer),
  foreign key (item_id, buyer) references public.claims(item_id, buyer) on delete cascade
);

-- A shopper's own notes about something they picked: a note, a tracking link, and whether it has arrived.
-- Private to that shopper, like the price.
create table if not exists public.claim_details (
  item_id      uuid not null,
  buyer        uuid not null,
  note         text check (note is null or length(note) <= 300),
  tracking_url text check (tracking_url is null or (tracking_url ~* '^https?://' and length(tracking_url) <= 2000)),
  arrived      boolean not null default false,
  updated_at   timestamptz not null default now(),
  primary key (item_id, buyer),
  foreign key (item_id, buyer) references public.claims(item_id, buyer) on delete cascade
);

-- The Secret Santa draw: who buys for whom. Each player can read only their own row. The host cannot read
-- these rows, so the host plays too without knowing who has whom.
create table if not exists public.santa_assignments (
  group_id   uuid not null,
  giver      uuid not null,
  receiver   uuid not null,
  created_at timestamptz not null default now(),
  primary key (group_id, giver),
  unique (group_id, receiver),
  check (giver <> receiver),
  foreign key (group_id, giver)    references public.group_members(group_id, member_id) on delete cascade,
  foreign key (group_id, receiver) references public.group_members(group_id, member_id) on delete cascade
);

-- Something a shopper bought for another member that is NOT on that person's list, with the same private
-- management details as a normal purchase. Only the shopper can see these, never the person they are for.
create table if not exists public.extra_purchases (
  id           uuid primary key default gen_random_uuid(),
  group_id     uuid not null,
  buyer        uuid not null,
  recipient    uuid not null,
  name         text not null check (length(trim(name)) between 1 and 80),
  link         text check (link is null or (link ~* '^https?://' and length(link) <= 2000)),
  price        numeric(10, 2) check (price is null or (price >= 0 and price < 10000000)),
  note         text check (note is null or length(note) <= 300),
  tracking_url text check (tracking_url is null or (tracking_url ~* '^https?://' and length(tracking_url) <= 2000)),
  arrived      boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  check (buyer <> recipient),
  foreign key (group_id, buyer)     references public.group_members(group_id, member_id) on delete cascade,
  foreign key (group_id, recipient) references public.group_members(group_id, member_id) on delete cascade
);
create index if not exists extra_purchases_buyer_idx on public.extra_purchases(group_id, buyer);

-- A short "about me" note at the top of a list (hobbies, interests, things not to buy). Up to 1000 characters.
create table if not exists public.list_about (
  group_id   uuid not null,
  owner      uuid not null,
  about      text not null check (char_length(about) between 1 and 1000),
  updated_at timestamptz not null default now(),
  primary key (group_id, owner),
  foreign key (group_id, owner) references public.group_members(group_id, member_id) on delete cascade
);

-- Suggestions and bug reports. Nobody can read this table directly; the app owner reads it through owner_feedback().
create table if not exists public.feedback (
  id          uuid primary key default gen_random_uuid(),
  author      uuid not null references public.profiles(id) on delete cascade,
  kind        text not null check (kind in ('suggestion', 'bug')),
  message     text not null check (char_length(message) between 1 and 1000),
  created_at  timestamptz not null default now(),
  resolved_at timestamptz
);
create index if not exists feedback_created_idx on public.feedback(created_at desc);

-- ---------------------------------------------------------------------------
-- Who is signed in, and what can they do?
-- ---------------------------------------------------------------------------
create or replace function public.me()
returns text
language sql stable security definer
set search_path = public, pg_temp
as $$
  select nullif(lower(coalesce(auth.jwt() ->> 'email', '')), '')
$$;

-- Your private member id (null until you have chosen a name).
create or replace function public.my_id()
returns uuid
language sql stable security definer
set search_path = public, pg_temp
as $$
  select id from public.profiles where email = public.me()
$$;

create or replace function public.my_profile()
returns table (id uuid, name text)
language sql stable security definer
set search_path = public, pg_temp
as $$
  select p.id, p.name from public.profiles p where p.email = public.me()
$$;

-- Today's date in the group time zone (app_settings.timezone), so an event on the 25th stays open all day on the 25th.
create or replace function public.today_local()
returns date
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare tz text;
begin
  select value into tz from public.app_settings where key = 'timezone';
  begin
    return (now() at time zone coalesce(tz, 'America/Los_Angeles'))::date;
  exception when others then
    return (now() at time zone 'America/Los_Angeles')::date;
  end;
end
$$;

create or replace function public.is_member(p_group uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from public.group_members where group_id = p_group and member_id = public.my_id())
$$;

create or replace function public.is_admin(p_group uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from public.groups where id = p_group and admin_id = public.my_id())
$$;

create or replace function public.group_open(p_group uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  -- Closed once archived, and also the moment the event date has passed, even before the archive sweep records it.
  select exists (select 1 from public.groups
                 where id = p_group and archived_at is null and event_date >= public.today_local())
$$;

create or replace function public.list_submitted(p_group uuid, p_owner uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from public.wish_lists where group_id = p_group and owner = p_owner and submitted_at is not null)
$$;

create or replace function public.wish_owner(p_item uuid)
returns uuid
language sql stable security definer
set search_path = public, pg_temp
as $$
  select owner from public.wish_items where id = p_item
$$;

create or replace function public.item_group(p_item uuid)
returns uuid
language sql stable security definer
set search_path = public, pg_temp
as $$
  select group_id from public.wish_items where id = p_item
$$;

-- True when p_id is you, or someone who shares at least one group with you.
create or replace function public.shares_group(p_id uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select p_id = public.my_id() or exists (
    select 1 from public.group_members a
    join public.group_members b on a.group_id = b.group_id
    where a.member_id = public.my_id() and b.member_id = p_id)
$$;

-- Which lists can I read? My own (drafts too). In a group or wishlist: any submitted list. In a Secret Santa: only the
-- one list I was given in the draw.
create or replace function public.can_view_list(p_group uuid, p_owner uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select public.is_member(p_group) and (
    p_owner = public.my_id()
    or case (select kind from public.groups where id = p_group)
         when 'secret_santa' then exists (select 1 from public.santa_assignments a
                                          where a.group_id = p_group and a.giver = public.my_id() and a.receiver = p_owner)
                                  and public.list_submitted(p_group, p_owner)
         else public.list_submitted(p_group, p_owner)
       end)
$$;

-- Who can I record an outside-the-list purchase for? Any other member (a wishlist: its lists; a Secret Santa: only the
-- person I was given).
create or replace function public.can_shop_for(p_group uuid, p_recipient uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select public.is_member(p_group) and p_recipient <> public.my_id()
     and exists (select 1 from public.group_members m where m.group_id = p_group and m.member_id = p_recipient)
     and case (select kind from public.groups where id = p_group)
           when 'secret_santa' then exists (select 1 from public.santa_assignments a
                                            where a.group_id = p_group and a.giver = public.my_id() and a.receiver = p_recipient)
           when 'registry' then exists (select 1 from public.group_members m where m.group_id = p_group and m.member_id = p_recipient and m.is_recipient)
           else true
         end
$$;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end
$$;

drop trigger if exists extra_purchases_touch on public.extra_purchases;
create trigger extra_purchases_touch before update on public.extra_purchases
  for each row execute function public.touch_updated_at();

-- Keep one person from filling the table.
create or replace function public.guard_extra_purchase()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if (select count(*) from public.extra_purchases where group_id = new.group_id and buyer = new.buyer) >= 200 then
    raise exception 'You can track up to 200 extra purchases in one group';
  end if;
  return new;
end
$$;
drop trigger if exists extra_purchases_guard on public.extra_purchases;
create trigger extra_purchases_guard before insert on public.extra_purchases
  for each row execute function public.guard_extra_purchase();

-- ---------------------------------------------------------------------------
-- Item rules
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

drop trigger if exists wish_items_touch on public.wish_items;
create trigger wish_items_touch before update on public.wish_items
  for each row execute function public.touch_item();

-- Who may add, change or remove the items on a list:
--   a normal group: the list's owner, or the member who made a list for someone else;
--   a registry: only the admin, and only on a recipient's list.
create or replace function public.can_edit_items(p_group uuid, p_owner uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select public.group_open(p_group) and exists (
    select 1 from public.groups g
    where g.id = p_group and (
      (g.kind = 'group' and public.is_member(p_group) and (
          p_owner = public.my_id()
          or exists (select 1 from public.group_members m
                     where m.group_id = p_group and m.member_id = p_owner and m.is_recipient and m.managed_by = public.my_id())))
      or (g.kind = 'secret_santa' and public.is_member(p_group) and p_owner = public.my_id())
      or (g.kind = 'registry' and g.admin_id = public.my_id()
          and exists (select 1 from public.group_members m where m.group_id = p_group and m.member_id = p_owner and m.is_recipient))
    ))
$$;

-- A submitted list may never drop below the group's minimum.
create or replace function public.guard_item_delete()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare v_min int;
begin
  select item_min into v_min from public.groups where id = old.group_id and kind in ('group', 'secret_santa');
  if v_min is not null
     and public.list_submitted(old.group_id, old.owner)
     and not exists (select 1 from public.group_members m where m.group_id = old.group_id and m.member_id = old.owner and m.is_recipient)
     and (select count(*) from public.wish_items where group_id = old.group_id and owner = old.owner) <= v_min then
    raise exception 'A submitted list needs at least % items. Add another item first, then remove this one.', v_min;
  end if;
  return old;
end
$$;

drop trigger if exists wish_items_guard_delete on public.wish_items;
create trigger wish_items_guard_delete before delete on public.wish_items
  for each row execute function public.guard_item_delete();

-- An item can be claimed by as many people as its quantity allows (unlimited = no cap).
create or replace function public.guard_claim()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_qty   int;
  v_found boolean;
begin
  select quantity, true into v_qty, v_found from public.wish_items where id = new.item_id for update;
  if not coalesce(v_found, false) then
    raise exception 'That item no longer exists';
  end if;
  if not public.group_open(public.item_group(new.item_id)) then
    raise exception 'This group is archived, so nothing can be changed';
  end if;
  if v_qty is not null and (select count(*) from public.claims where item_id = new.item_id) >= v_qty then
    raise exception 'That item has already been fully claimed';
  end if;
  return new;
end
$$;

drop trigger if exists claims_guard on public.claims;
create trigger claims_guard before insert on public.claims
  for each row execute function public.guard_claim();

-- ---------------------------------------------------------------------------
-- Email (sent through the Google Apps Script web app)
-- ---------------------------------------------------------------------------
create or replace function public.esc(p text)
returns text
language sql immutable
as $$
  select replace(replace(replace(replace(coalesce(p, ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), '"', '&quot;')
$$;

create or replace function public.send_mail(p_to text[], p_subject text, p_html text)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_url    text;
  v_secret text;
  i        int;
begin
  select value into v_url    from public.app_settings where key = 'mailer_url';
  select value into v_secret from public.app_settings where key = 'mailer_secret';
  if v_url is null or v_url not like 'http%' or coalesce(array_length(p_to, 1), 0) = 0 then
    return;
  end if;
  -- The mailer script accepts 10 recipients per call.
  for i in 1 .. array_length(p_to, 1) by 10 loop
    perform net.http_post(
      url     := v_url,
      body    := jsonb_build_object('secret', v_secret, 'to', to_jsonb(p_to[i : i + 9]),
                                    'subject', left(replace(p_subject, E'\n', ' '), 200), 'html', p_html),
      headers := jsonb_build_object('Content-Type', 'application/json')
    );
  end loop;
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
  -- p_heading and p_body must already be escaped by the caller.
  return format(
    '<div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:0 auto;border:1px solid #d5e3d7;border-radius:14px;overflow:hidden">'
    || '<div style="background:#134a32;color:#ffffff;padding:18px 22px;font-size:20px">%s</div>'
    || '<div style="padding:20px 22px;color:#14261b;font-size:15px;line-height:1.5">'
    || '<p style="margin:0 0 18px">%s</p>'
    || '<p style="margin:0"><a href="%s" style="background:#176a43;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:8px;display:inline-block">%s</a></p>'
    || '</div></div>',
    p_heading, p_body, public.esc(coalesce(v_site, '#')), public.esc(p_button));
end
$$;

create or replace function public.notify_submitted(p_group uuid, p_owner uuid)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_who   text;
  v_group text;
  v_kind  text;
  v_n     int;
  v_to    text[];
begin
  select name into v_who   from public.profiles where id = p_owner;
  select name, kind into v_group, v_kind from public.groups where id = p_group;
  select count(*) into v_n from public.wish_items where group_id = p_group and owner = p_owner;
  if v_kind = 'secret_santa' then
    -- Nobody can read anyone else's list in a Secret Santa, so only the host hears about it.
    select array_agg(p.email) into v_to
      from public.groups g join public.profiles p on p.id = g.admin_id
     where g.id = p_group and g.admin_id <> p_owner;
    perform public.send_mail(
      v_to,
      coalesce(v_who, 'Someone') || ' shared a list in ' || coalesce(v_group, 'your Secret Santa'),
      public.mail_html(
        public.esc(coalesce(v_who, 'Someone')) || ' shared a list',
        public.esc(coalesce(v_who, 'Someone')) || ' just submitted a list with ' || v_n || case when v_n = 1 then ' item' else ' items' end
          || ' in ' || public.esc(coalesce(v_group, 'your Secret Santa')) || '. When everyone you need has shared, you can draw the names.',
        'Open the Secret Santa')
    );
    return;
  end if;
  select array_agg(p.email order by p.email) into v_to from public.group_members m join public.profiles p on p.id = m.member_id where m.group_id = p_group and m.member_id <> p_owner and not m.is_recipient;
  perform public.send_mail(
    v_to,
    coalesce(v_who, 'Someone') || ' shared a wishlist in ' || coalesce(v_group, 'your group'),
    public.mail_html(
      public.esc(coalesce(v_who, 'Someone')) || ' shared a list',
      public.esc(coalesce(v_who, 'Someone')) || ' just submitted a wishlist with ' || v_n || case when v_n = 1 then ' item' else ' items' end
        || ' in ' || public.esc(coalesce(v_group, 'your group')) || '. Open it to see what they would like, and mark anything you buy so nobody doubles up.',
      'Open the wishlist')
  );
end
$$;

-- Email the group about a list someone made for another person (a child, say). Real members only, not the author.
create or replace function public.notify_child_list(p_group uuid, p_member uuid, p_author uuid)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_author text; v_for text; v_group text; v_n int; v_to text[];
begin
  select name into v_author from public.profiles where id = p_author;
  select name into v_for    from public.profiles where id = p_member;
  select name into v_group  from public.groups   where id = p_group;
  select count(*) into v_n from public.wish_items where group_id = p_group and owner = p_member;
  select array_agg(p.email order by p.email) into v_to
    from public.group_members m join public.profiles p on p.id = m.member_id
   where m.group_id = p_group and m.member_id <> p_author and not m.is_recipient;
  perform public.send_mail(
    v_to,
    coalesce(v_author, 'Someone') || ' shared a wishlist for ' || coalesce(v_for, 'someone') || ' in ' || coalesce(v_group, 'your group'),
    public.mail_html(
      public.esc(coalesce(v_author, 'Someone')) || ' shared a list for ' || public.esc(coalesce(v_for, 'someone')),
      public.esc(coalesce(v_author, 'Someone')) || ' just shared a wishlist for ' || public.esc(coalesce(v_for, 'someone')) || ' with ' || v_n
        || case when v_n = 1 then ' item' else ' items' end || ' in ' || public.esc(coalesce(v_group, 'your group'))
        || '. Open it to see what they would like, and mark anything you buy so nobody doubles up.',
      'Open the wishlist')
  );
end
$$;

-- ---------------------------------------------------------------------------
-- Actions the website calls. Each one checks the rules itself.
-- ---------------------------------------------------------------------------
create or replace function public.set_profile(p_name text)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare m text := public.me();
begin
  if m is null then raise exception 'Not authenticated'; end if;
  if length(trim(coalesce(p_name, ''))) not between 1 and 40 then
    raise exception 'Enter a name up to 40 characters';
  end if;
  insert into public.profiles (email, name) values (m, trim(p_name))
  on conflict (email) do update set name = excluded.name;
end
$$;

create or replace function public.create_group(p_name text, p_event date, p_min int)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  m uuid := public.my_id();
  g uuid;
begin
  if public.me() is null then raise exception 'Not authenticated'; end if;
  if m is null then raise exception 'Add your name first'; end if;
  if length(trim(coalesce(p_name, ''))) not between 1 and 60 then raise exception 'Enter a group name up to 60 characters'; end if;
  if p_event is null then raise exception 'Choose the event date'; end if;
  if p_event < public.today_local() then raise exception 'The event date has already passed. Choose a date that is today or later'; end if;
  if p_min is null or p_min not between 1 and 50 then raise exception 'The item minimum must be between 1 and 50'; end if;

  insert into public.groups (name, event_date, item_min, admin_id)
  values (trim(p_name), p_event, p_min, m) returning id into g;
  insert into public.group_members (group_id, member_id) values (g, m);
  insert into public.group_invites (group_id, code) values (g, substr(replace(gen_random_uuid()::text, '-', ''), 1, 24));
  return g;
end
$$;

-- Everything the dashboard shows, one row per group you are in.
drop function if exists public.my_groups();   -- its columns changed (added admin_name, kind, drawn)
create or replace function public.my_groups()
returns table (
  group_id uuid, name text, event_date date, created_at timestamptz, archived_at timestamptz,
  is_admin boolean, item_min int, member_count int, left_to_shop int, list_submitted boolean, admin_name text, kind text,
  drawn boolean
)
language sql stable security definer
set search_path = public, pg_temp
as $$
  select g.id, g.name, g.event_date, g.created_at, g.archived_at,
         g.admin_id = public.my_id(), g.item_min,
         -- in a registry "members" counts the lists (the people the wishes are for)
         (select count(*)::int from public.group_members x where x.group_id = g.id and ((g.kind <> 'registry') <> x.is_recipient)),
         case when g.kind = 'secret_santa' then
           -- one person to shop for, once the names are drawn
           (select count(*)::int from public.santa_assignments a
             where a.group_id = g.id and a.giver = public.my_id()
               and not exists (select 1 from public.claims c join public.wish_items i on i.id = c.item_id
                               where i.group_id = g.id and i.owner = a.receiver and c.buyer = public.my_id())
               and not exists (select 1 from public.extra_purchases e
                               where e.group_id = g.id and e.buyer = public.my_id() and e.recipient = a.receiver))
         else
           (select count(*)::int from public.group_members x
             where x.group_id = g.id and x.member_id <> public.my_id() and (g.kind = 'group' or x.is_recipient)
               and (not x.is_recipient or exists (select 1 from public.wish_items w where w.group_id = g.id and w.owner = x.member_id))
               and not exists (select 1 from public.claims c join public.wish_items i on i.id = c.item_id
                               where i.group_id = g.id and i.owner = x.member_id and c.buyer = public.my_id())
               and not exists (select 1 from public.extra_purchases e
                               where e.group_id = g.id and e.buyer = public.my_id() and e.recipient = x.member_id))
         end,
         (g.kind = 'registry' or public.list_submitted(g.id, public.my_id())),
         (select p.name from public.profiles p where p.id = g.admin_id),
         g.kind,
         g.draw_at is not null
  from public.groups g
  join public.group_members gm on gm.group_id = g.id and gm.member_id = public.my_id()
  order by (g.archived_at is not null), g.event_date, g.name
$$;

-- What a join link points to. Safe to call before signing in; it reveals only the group's name and date.
drop function if exists public.preview_invite(text);
create or replace function public.preview_invite(p_code text)
returns table (group_name text, event_date date, archived boolean, member_count int, kind text, drawn boolean)
language sql stable security definer
set search_path = public, pg_temp
as $$
  select g.name, g.event_date, (g.archived_at is not null or g.event_date < public.today_local()),
         (select count(*)::int from public.group_members x where x.group_id = g.id and ((g.kind <> 'registry') <> x.is_recipient)),
         g.kind, g.draw_at is not null
  from public.group_invites i join public.groups g on g.id = i.group_id
  where i.code = p_code
$$;

create or replace function public.join_group(p_code text)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  m  uuid := public.my_id();
  g  uuid;
  ar timestamptz;
begin
  if public.me() is null then raise exception 'Not authenticated'; end if;
  if m is null then raise exception 'Add your name first'; end if;
  select i.group_id, case when gr.event_date < public.today_local() then coalesce(gr.archived_at, now()) else gr.archived_at end into g, ar
  from public.group_invites i join public.groups gr on gr.id = i.group_id
  where i.code = p_code;
  if g is null then raise exception 'This invite link is not valid any more'; end if;
  if exists (select 1 from public.group_members where group_id = g and member_id = m) then return g; end if;
  if ar is not null then raise exception 'This group is archived and closed to new members'; end if;
  if exists (select 1 from public.groups where id = g and kind = 'secret_santa' and draw_at is not null) then
    raise exception 'The names have already been drawn for this Secret Santa, so it is closed to new players';
  end if;
  insert into public.group_members (group_id, member_id) values (g, m);
  return g;
end
$$;

-- Admin only. Makes a new link and turns the old one off.
create or replace function public.generate_invite(p_group uuid)
returns text
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare c text := substr(replace(gen_random_uuid()::text, '-', ''), 1, 24);
begin
  if not public.is_admin(p_group) then raise exception 'Only the group admin can do that'; end if;
  insert into public.group_invites (group_id, code) values (p_group, c)
  on conflict (group_id) do update set code = excluded.code, created_at = now();
  return c;
end
$$;

-- Admin only. An archived group is frozen: no new members, no lists added or edited, nothing claimed or released.
-- The admin can reopen it, unless the event date has passed (move the date forward first).
create or replace function public.set_group_archived(p_group uuid, p_archived boolean)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_admin(p_group) then raise exception 'Only the group admin can do that'; end if;
  if p_archived then
    update public.groups set archived_at = coalesce(archived_at, now()) where id = p_group;
  else
    if exists (select 1 from public.groups where id = p_group and event_date < public.today_local()) then
      raise exception 'The event date has passed. Change the event date to a day that is today or later to reopen this group';
    end if;
    update public.groups set archived_at = null, auto_archived = false where id = p_group;
  end if;
end
$$;

-- Archives every group whose event date has passed. The website calls this whenever it loads, so no scheduler is needed.
create or replace function public.sweep_archives()
returns void
language sql security definer
set search_path = public, pg_temp
as $$
  update public.groups set archived_at = now(), auto_archived = true
  where archived_at is null and event_date < public.today_local()
$$;

-- Admin only. Rename the group or move the event date. An archived group is frozen, except that a group which
-- archived itself because its date passed is reopened by giving it a new date.
create or replace function public.edit_group(p_group uuid, p_name text, p_event date)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare g public.groups;
begin
  if not public.is_admin(p_group) then raise exception 'Only the group admin can do that'; end if;
  if length(trim(coalesce(p_name, ''))) not between 1 and 60 then raise exception 'Enter a group name up to 60 characters'; end if;
  if p_event is null then raise exception 'Choose the event date'; end if;
  if p_event < public.today_local() then raise exception 'The event date has already passed. Choose a date that is today or later'; end if;
  select * into g from public.groups where id = p_group for update;
  if g.archived_at is not null and not g.auto_archived and g.event_date >= public.today_local() then
    raise exception 'This group is archived. Reopen it before making changes';
  end if;
  update public.groups
     set name = trim(p_name), event_date = p_event, archived_at = null, auto_archived = false
   where id = p_group;
end
$$;

-- Admin only. Takes someone out of the group and deletes their list and everything they picked.
-- They can rejoin only with a valid invite link (make a new link to lock the old one).
-- Internal: deletes a placeholder list, its items, and everything picked on it. Not callable from the website.
create or replace function public.drop_list(p_group uuid, p_member uuid)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  delete from public.wish_lists where group_id = p_group and owner = p_member;
  delete from public.wish_items where group_id = p_group and owner = p_member;
  delete from public.group_members where group_id = p_group and member_id = p_member and is_recipient;
  delete from public.profiles where id = p_member and email like '%@lists.invalid';
end
$$;

create or replace function public.remove_member(p_group uuid, p_member uuid)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare r record;
begin
  if not public.is_admin(p_group) then raise exception 'Only the group admin can do that'; end if;
  if not public.group_open(p_group) then raise exception 'This group is archived, so members can no longer be removed'; end if;
  if p_member = public.my_id() then raise exception 'You are the admin, so you can''t remove yourself'; end if;
  if exists (select 1 from public.santa_assignments a where a.group_id = p_group and (a.giver = p_member or a.receiver = p_member)) then
    raise exception 'The names have been drawn, so players in the draw can no longer be removed';
  end if;
  if not exists (select 1 from public.group_members where group_id = p_group and member_id = p_member) then
    raise exception 'That person is not in this group';
  end if;
  -- Lists they made for other people go with them.
  for r in select member_id from public.group_members where group_id = p_group and managed_by = p_member loop
    perform public.drop_list(p_group, r.member_id);
  end loop;
  -- Un-submit first so the minimum-items rule lets their items go.
  delete from public.wish_lists where group_id = p_group and owner = p_member;
  delete from public.wish_items where group_id = p_group and owner = p_member;
  -- Release whatever they had picked for others, so those items open up again.
  delete from public.claims c using public.wish_items i
   where c.item_id = i.id and i.group_id = p_group and c.buyer = p_member;
  delete from public.group_members where group_id = p_group and member_id = p_member;
  -- A wishlist's placeholder person has no other use once their list is gone.
  delete from public.profiles where id = p_member and email like '%@lists.invalid';
end
$$;

-- Admin only. Makes a one-way wishlist: an event name, a date, and the first person a list is for.
create or replace function public.create_registry(p_name text, p_event date, p_for text)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  m uuid := public.my_id();
  g uuid;
begin
  if public.me() is null then raise exception 'Not authenticated'; end if;
  if m is null then raise exception 'Add your name first'; end if;
  if length(trim(coalesce(p_name, ''))) not between 1 and 60 then raise exception 'Enter an event name up to 60 characters'; end if;
  if p_event is null then raise exception 'Choose the event date'; end if;
  if p_event < public.today_local() then raise exception 'The event date has already passed. Choose a date that is today or later'; end if;
  if length(trim(coalesce(p_for, ''))) not between 1 and 40 then raise exception 'Enter the name of the person the list is for, up to 40 characters'; end if;

  insert into public.groups (name, event_date, item_min, admin_id, kind)
  values (trim(p_name), p_event, 1, m, 'registry') returning id into g;
  insert into public.group_members (group_id, member_id) values (g, m);
  insert into public.group_invites (group_id, code) values (g, substr(replace(gen_random_uuid()::text, '-', ''), 1, 24));
  perform public.add_list(g, p_for);
  return g;
end
$$;

-- Admin only. Adds another person's list to a wishlist. Returns that list's id.
create or replace function public.add_list(p_group uuid, p_name text)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare r uuid;
begin
  if not public.is_admin(p_group) then raise exception 'Only the group admin can do that'; end if;
  if not exists (select 1 from public.groups where id = p_group and kind = 'registry') then raise exception 'Lists can only be added to a wishlist'; end if;
  if not public.group_open(p_group) then raise exception 'This group is archived, so lists can no longer be added'; end if;
  if length(trim(coalesce(p_name, ''))) not between 1 and 40 then raise exception 'Enter the name of the person the list is for, up to 40 characters'; end if;
  if (select count(*) from public.group_members where group_id = p_group and is_recipient) >= 50 then raise exception 'A wishlist can have up to 50 lists'; end if;
  insert into public.profiles (email, name)
  values ('list-' || gen_random_uuid()::text || '@lists.invalid', trim(p_name)) returning id into r;
  insert into public.group_members (group_id, member_id, is_recipient) values (p_group, r, true);
  insert into public.wish_lists (group_id, owner, submitted_at) values (p_group, r, now());
  return r;
end
$$;

-- Renames the person a list is for. The wishlist admin can rename any list in a wishlist; in a normal group,
-- the member who made a list for someone can rename it.
create or replace function public.rename_list(p_group uuid, p_member uuid, p_name text)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if not public.group_open(p_group) then raise exception 'This group is archived, so lists can no longer be changed'; end if;
  if length(trim(coalesce(p_name, ''))) not between 1 and 40 then raise exception 'Enter the name of the person the list is for, up to 40 characters'; end if;
  update public.profiles set name = trim(p_name)
   where id = p_member and exists (
     select 1 from public.group_members m join public.groups g on g.id = m.group_id
     where m.group_id = p_group and m.member_id = p_member and m.is_recipient
       and (m.managed_by = public.my_id() or (g.kind = 'registry' and g.admin_id = public.my_id())));
  if not found then raise exception 'That list is not yours to change'; end if;
end
$$;

-- Any member of a normal group can make a list for someone else (a child, say). They can view and edit it,
-- and anything they buy from it is marked as bought by them.
create or replace function public.add_child_list(p_group uuid, p_name text)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare r uuid; m uuid := public.my_id();
begin
  if m is null or not public.is_member(p_group) then raise exception 'You are not in this group'; end if;
  if not exists (select 1 from public.groups where id = p_group and kind = 'group') then raise exception 'Lists for other people can only be added in a group'; end if;
  if not public.group_open(p_group) then raise exception 'This group is archived, so lists can no longer be added'; end if;
  if length(trim(coalesce(p_name, ''))) not between 1 and 40 then raise exception 'Enter the name of the person the list is for, up to 40 characters'; end if;
  if (select count(*) from public.group_members where group_id = p_group and managed_by = m) >= 20 then raise exception 'You can make up to 20 lists for other people in one group'; end if;
  insert into public.profiles (email, name)
  values ('list-' || gen_random_uuid()::text || '@lists.invalid', trim(p_name)) returning id into r;
  insert into public.group_members (group_id, member_id, is_recipient, managed_by) values (p_group, r, true, m);
  insert into public.wish_lists (group_id, owner, submitted_at) values (p_group, r, now());
  return r;
end
$$;

-- Called after the author saves items on a list they made for someone else. The first time the list has
-- items, the rest of the group is emailed once. Returns true when an email went out.
create or replace function public.announce_child_list(p_group uuid, p_member uuid)
returns boolean
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare m uuid := public.my_id();
begin
  if m is null or not exists (select 1 from public.group_members x
                              where x.group_id = p_group and x.member_id = p_member and x.is_recipient and x.managed_by = m) then
    raise exception 'That list is not yours to change';
  end if;
  if not public.group_open(p_group) then raise exception 'This group is archived, so lists are closed'; end if;
  if not exists (select 1 from public.wish_items where group_id = p_group and owner = p_member) then return false; end if;
  update public.wish_lists set notified_at = now()
   where group_id = p_group and owner = p_member and notified_at is null;
  if not found then return false; end if;
  perform public.notify_child_list(p_group, p_member, m);
  return true;
end
$$;

-- Deletes a list made for someone else, with everything on it. Only the member who made it (or the group admin).
create or replace function public.delete_child_list(p_group uuid, p_member uuid)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if not public.group_open(p_group) then raise exception 'This group is archived, so lists can no longer be deleted'; end if;
  if not exists (select 1 from public.group_members m
                 where m.group_id = p_group and m.member_id = p_member and m.is_recipient
                   and (m.managed_by = public.my_id() or public.is_admin(p_group))) then
    raise exception 'That list is not yours to change';
  end if;
  perform public.drop_list(p_group, p_member);
end
$$;

create or replace function public.submit_list(p_group uuid)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  m          uuid := public.my_id();
  n          int;
  v_min      int;
  first_time boolean;
begin
  if m is null or not public.is_member(p_group) then
    raise exception 'You are not in this group';
  end if;
  if not public.group_open(p_group) then
    raise exception 'This group is archived, so lists are closed';
  end if;
  if exists (select 1 from public.groups where id = p_group and kind = 'registry') then
    raise exception 'Lists in a wishlist are written by its admin';
  end if;

  select item_min into v_min from public.groups where id = p_group;
  if exists (select 1 from public.groups where id = p_group and kind = 'secret_santa' and draw_at is not null)
     and not public.list_submitted(p_group, m) then
    raise exception 'The names have already been drawn, so new lists can no longer be added';
  end if;
  select count(*) into n from public.wish_items where group_id = p_group and owner = m;
  if n < v_min then
    raise exception 'Add at least % items before submitting', v_min;
  end if;

  select (submitted_at is null) into first_time from public.wish_lists where group_id = p_group and owner = m;

  insert into public.wish_lists (group_id, owner, submitted_at, updated_at)
  values (p_group, m, now(), now())
  on conflict (group_id, owner) do update
    set submitted_at = coalesce(public.wish_lists.submitted_at, now()),
        updated_at   = now();

  if coalesce(first_time, true) then
    perform public.notify_submitted(p_group, m);
  end if;
end
$$;

-- Anyone can make a Secret Santa. The host is its admin.
create or replace function public.create_secret_santa(p_name text, p_event date, p_min int)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  m uuid := public.my_id();
  g uuid;
begin
  if public.me() is null then raise exception 'Not authenticated'; end if;
  if m is null then raise exception 'Add your name first'; end if;
  if length(trim(coalesce(p_name, ''))) not between 1 and 60 then raise exception 'Enter a name up to 60 characters'; end if;
  if p_event is null then raise exception 'Choose the event date'; end if;
  if p_event < public.today_local() then raise exception 'The event date has already passed. Choose a date that is today or later'; end if;
  if p_min is null or p_min not between 1 and 50 then raise exception 'The item minimum must be between 1 and 50'; end if;

  insert into public.groups (name, event_date, item_min, admin_id, kind)
  values (trim(p_name), p_event, p_min, m, 'secret_santa') returning id into g;
  insert into public.group_members (group_id, member_id) values (g, m);
  insert into public.group_invites (group_id, code) values (g, substr(replace(gen_random_uuid()::text, '-', ''), 1, 24));
  return g;
end
$$;

-- Host only, once, and it cannot be undone. Everyone who has shared a list is in the draw. Each of them is given exactly
-- one other player's list at random, nobody gets their own, and every list is given to exactly one person. The host
-- is told how many were drawn but never who has whom. Each player is emailed their own pick.
create or replace function public.start_secret_santa(p_group uuid)
returns int
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  g        public.groups;
  ids      uuid[];
  n        int;
  i        int;
  v_to     text;
  v_name   text;
begin
  if not public.is_admin(p_group) then raise exception 'Only the host can do that'; end if;
  select * into g from public.groups where id = p_group for update;
  if g.kind <> 'secret_santa' then raise exception 'That is not a Secret Santa'; end if;
  if g.draw_at is not null then raise exception 'The names have already been drawn'; end if;
  if not public.group_open(p_group) then raise exception 'This Secret Santa is archived, so the names can no longer be drawn'; end if;

  select array_agg(m.member_id order by gen_random_uuid()) into ids
    from public.group_members m
   where m.group_id = p_group and not m.is_recipient and public.list_submitted(p_group, m.member_id);
  n := coalesce(array_length(ids, 1), 0);
  if n < 3 then raise exception 'At least 3 players need to share a list before the names can be drawn'; end if;

  -- A random order, then each person gives to the next one in the circle: nobody gets their own list.
  for i in 1 .. n loop
    insert into public.santa_assignments (group_id, giver, receiver) values (p_group, ids[i], ids[i % n + 1]);
  end loop;
  update public.groups set draw_at = now() where id = p_group;

  for i in 1 .. n loop
    select p.email into v_to from public.profiles p where p.id = ids[i];
    select p.name  into v_name from public.profiles p where p.id = ids[i % n + 1];
    perform public.send_mail(
      array[v_to],
      'Your Secret Santa pick in ' || g.name,
      public.mail_html(
        'The names have been drawn',
        'You are buying for <b>' || public.esc(v_name) || '</b> in ' || public.esc(g.name) || '. Open their list to see what they would love, and keep it a secret.',
        'Open the Secret Santa')
    );
  end loop;
  return n;
end
$$;

-- Saves (or clears) the about-me note on a list. 1000 characters at most.
create or replace function public.set_list_about(p_group uuid, p_owner uuid, p_about text)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare v text := trim(coalesce(p_about, ''));
begin
  if not public.can_edit_items(p_group, p_owner) then raise exception 'That list is not yours to change, or the group is archived'; end if;
  if char_length(v) > 1000 then raise exception 'Keep this to 1000 characters or fewer'; end if;
  if v = '' then
    delete from public.list_about where group_id = p_group and owner = p_owner;
  else
    insert into public.list_about (group_id, owner, about) values (p_group, p_owner, v)
    on conflict (group_id, owner) do update set about = excluded.about, updated_at = now();
  end if;
end
$$;

-- Called after someone saves changes to a list that is already shared. Emails the people who can see that list (at most
-- once every 30 minutes per list, so a string of small edits is one email). Returns true when an email went out.
--   group / wishlist: everyone except the person who made the change
--   Secret Santa:     only the player who was given that list, and only after the draw
create or replace function public.announce_list_update(p_group uuid, p_owner uuid, p_added int, p_changed int, p_removed int, p_about boolean)
returns boolean
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  m        uuid := public.my_id();
  g        public.groups;
  v_for    text; v_actor text;
  v_to     text[];
  a int := least(greatest(coalesce(p_added, 0), 0), 1000);
  c int := least(greatest(coalesce(p_changed, 0), 0), 1000);
  r int := least(greatest(coalesce(p_removed, 0), 0), 1000);
  v_bits   text[] := '{}';
  v_what   text;
  v_tag    text;
begin
  if m is null or not public.can_edit_items(p_group, p_owner) then raise exception 'That list is not yours to change'; end if;
  if not public.list_submitted(p_group, p_owner) then return false; end if;
  if a + c + r = 0 and not coalesce(p_about, false) then return false; end if;

  select * into g from public.groups where id = p_group;
  select name into v_for   from public.profiles where id = p_owner;
  select name into v_actor from public.profiles where id = m;
  if g.kind = 'secret_santa' then
    select array_agg(p.email) into v_to from public.santa_assignments sa join public.profiles p on p.id = sa.giver
     where sa.group_id = p_group and sa.receiver = p_owner;
  else
    select array_agg(p.email order by p.email) into v_to
      from public.group_members x join public.profiles p on p.id = x.member_id
     where x.group_id = p_group and x.member_id <> m and not x.is_recipient;
  end if;
  if coalesce(array_length(v_to, 1), 0) = 0 then return false; end if;   -- nobody to tell (and the 30 minutes aren't used up)

  update public.wish_lists set update_notified_at = now()
   where group_id = p_group and owner = p_owner
     and (update_notified_at is null or update_notified_at < now() - interval '30 minutes');
  if not found then return false; end if;
  if a > 0 then v_bits := v_bits || (a || ' added')::text; end if;
  if c > 0 then v_bits := v_bits || (c || ' changed')::text; end if;
  if r > 0 then v_bits := v_bits || (r || ' removed')::text; end if;
  if coalesce(p_about, false) then v_bits := v_bits || 'the about note updated'::text; end if;
  v_what := array_to_string(v_bits, ', ');
  v_tag := case when p_owner = m then public.esc(coalesce(v_actor, 'Someone')) || ' updated their list'
                else public.esc(coalesce(v_actor, 'Someone')) || ' updated the list for ' || public.esc(coalesce(v_for, 'someone')) end;
  perform public.send_mail(
    v_to,
    case when p_owner = m then coalesce(v_actor, 'Someone') || ' updated their wishlist in ' || g.name
         else coalesce(v_actor, 'Someone') || ' updated the wishlist for ' || coalesce(v_for, 'someone') || ' in ' || g.name end,
    public.mail_html(
      v_tag,
      v_tag || ' in ' || public.esc(g.name) || ' (' || public.esc(v_what) || '). Open it to see what changed.',
      'Open the wishlist')
  );
  return true;
end
$$;

-- Suggestions and bug reports from signed-in people.
create or replace function public.submit_feedback(p_kind text, p_message text)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare m uuid := public.my_id(); v text := trim(coalesce(p_message, ''));
begin
  if m is null then raise exception 'Not authenticated'; end if;
  if p_kind not in ('suggestion', 'bug') then raise exception 'Choose suggestion or bug'; end if;
  if char_length(v) = 0 then raise exception 'Write a few words first'; end if;
  if char_length(v) > 1000 then raise exception 'Keep it to 1000 characters or fewer'; end if;
  if (select count(*) from public.feedback where author = m and created_at > now() - interval '1 day') >= 10 then
    raise exception 'You have sent a lot of feedback today. Please try again tomorrow';
  end if;
  insert into public.feedback (author, kind, message) values (m, p_kind, v);
end
$$;

-- Owner only: every piece of feedback, open ones first.
create or replace function public.owner_feedback()
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_owner() then raise exception 'Not allowed'; end if;
  return coalesce((select jsonb_agg(x order by (x->>'resolved_at') is not null, x->>'created_at' desc) from (
    select jsonb_build_object('id', f.id, 'kind', f.kind, 'message', f.message, 'created_at', f.created_at,
                              'resolved_at', f.resolved_at, 'author_name', p.name, 'author_email', p.email) as x
      from public.feedback f left join public.profiles p on p.id = f.author
     order by f.created_at desc limit 500) q), '[]'::jsonb);
end
$$;

create or replace function public.owner_set_feedback(p_id uuid, p_resolved boolean)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_owner() then raise exception 'Not allowed'; end if;
  update public.feedback set resolved_at = case when p_resolved then coalesce(resolved_at, now()) else null end where id = p_id;
  if not found then raise exception 'That feedback no longer exists'; end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Owner dashboard: totals, daily charts and every wishlist. Only the sign-in email in
-- app_settings.owner_email can call these (checked inside the function, not just in the website).
-- ---------------------------------------------------------------------------
create or replace function public.is_owner()
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select public.me() is not null
     and exists (select 1 from public.app_settings
                 where key = 'owner_email' and value like '%@%' and lower(trim(value)) = public.me())
$$;

create or replace function public.owner_dashboard(p_days int default 30)
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  v_days  int := least(greatest(coalesce(p_days, 30), 7), 365);
  v_today date := public.today_local();
  v_out   jsonb;
begin
  if not public.is_owner() then
    raise exception 'Not allowed';
  end if;
  with
  firsts as (   -- when each list was started: its first item
    select group_id, owner, min(created_at) as started from public.wish_items group by group_id, owner
  ),
  days as (select d::date as day from generate_series(v_today - (v_days - 1), v_today, interval '1 day') d),
  u as (select (created_at at time zone (select value from public.app_settings where key = 'timezone'))::date as day, count(*) n from public.profiles where email not like '%@lists.invalid' group by 1),
  g as (select (created_at at time zone (select value from public.app_settings where key = 'timezone'))::date as day, count(*) n from public.groups group by 1),
  l as (select (started at time zone (select value from public.app_settings where key = 'timezone'))::date as day, count(*) n from firsts group by 1)
  select jsonb_build_object(
    'totals', jsonb_build_object(
      'users',      (select count(*) from public.profiles where email not like '%@lists.invalid'),
      'groups',     (select count(*) from public.groups where kind = 'group'),
      'wishlists',  (select count(*) from public.groups where kind = 'registry'),
      'santas',     (select count(*) from public.groups where kind = 'secret_santa'),
      'open_feedback', (select count(*) from public.feedback where resolved_at is null),
      'lists',      (select count(*) from firsts),
      'lists_shared', (select count(*) from public.wish_lists where submitted_at is not null),
      'items',      (select count(*) from public.wish_items),
      'purchases',  (select count(*) from public.claims)),
    'daily', coalesce((select jsonb_agg(jsonb_build_object(
        'day', days.day, 'users', coalesce(u.n, 0), 'groups', coalesce(g.n, 0), 'lists', coalesce(l.n, 0)) order by days.day)
      from days left join u using (day) left join g using (day) left join l using (day)), '[]'::jsonb),
    'groups', coalesce((select jsonb_agg(x order by x.created_at desc) from (
        select gr.id, gr.name, gr.kind, gr.event_date, gr.created_at, gr.archived_at is not null as archived,
               cr.name as created_by,
               (select count(*) from public.group_members m where m.group_id = gr.id and not m.is_recipient) as members,
               (select count(*) from public.wish_lists wl where wl.group_id = gr.id) as lists,
               (select count(*) from public.wish_items i where i.group_id = gr.id) as items
          from public.groups gr
          join public.profiles cr on cr.id = gr.admin_id
         limit 1000) x), '[]'::jsonb)
  ) into v_out;
  return v_out;
end
$$;

-- Read-only look inside one group for the owner: every list and its items. No emails, no
-- purchases (only how many of an item have been picked), and nothing here can change data.
create or replace function public.owner_group_view(p_group uuid)
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  v_out jsonb;
begin
  if not public.is_owner() then
    raise exception 'Not allowed';
  end if;
  -- In a Secret Santa the lists are private, so only who is in it and who has shared is shown, never the items.
  select jsonb_build_object(
    'group', jsonb_build_object('id', gr.id, 'name', gr.name, 'kind', gr.kind, 'event_date', gr.event_date,
              'created_at', gr.created_at, 'archived', gr.archived_at is not null, 'created_by', cr.name,
              'drawn', gr.draw_at is not null,
              'members', (select count(*) from public.group_members m where m.group_id = gr.id and not m.is_recipient)),
    'lists', coalesce((select jsonb_agg(l order by l.owner_name) from (
        select o.name as owner_name, m.is_recipient as for_someone_else, mb.name as managed_by,
               wl.submitted_at is not null as shared,
               (select count(*) from public.wish_items i where i.group_id = wl.group_id and i.owner = wl.owner) as item_count,
               case when gr.kind = 'secret_santa' then '[]'::jsonb else coalesce((select jsonb_agg(jsonb_build_object(
                    'name', i.name, 'description', i.description, 'link', i.link, 'image_url', i.image_url,
                    'price', i.price, 'quantity', i.quantity,
                    'picked', (select count(*) from public.claims c where c.item_id = i.id)) order by i.position, i.created_at)
                  from public.wish_items i where i.group_id = wl.group_id and i.owner = wl.owner), '[]'::jsonb) end as items,
               (select la.about from public.list_about la where la.group_id = wl.group_id and la.owner = wl.owner and gr.kind <> 'secret_santa') as about
          from public.wish_lists wl
          join public.group_members m on m.group_id = wl.group_id and m.member_id = wl.owner
          join public.profiles o on o.id = wl.owner
          left join public.profiles mb on mb.id = m.managed_by
         where wl.group_id = gr.id) l), '[]'::jsonb))
  into v_out
  from public.groups gr join public.profiles cr on cr.id = gr.admin_id
  where gr.id = p_group;
  if v_out is null then raise exception 'That group does not exist'; end if;
  return v_out;
end
$$;

-- ---------------------------------------------------------------------------
-- Access rules (row level security). This is what keeps claims hidden from
-- the person whose list they are on: the database itself refuses to return them.
-- ---------------------------------------------------------------------------
alter table public.app_settings  enable row level security;
alter table public.profiles      enable row level security;
alter table public.groups        enable row level security;
alter table public.group_invites enable row level security;
alter table public.group_members enable row level security;
alter table public.wish_lists    enable row level security;
alter table public.wish_items    enable row level security;
alter table public.claims        enable row level security;
alter table public.claim_prices  enable row level security;

drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles
  for select to authenticated using (public.shares_group(id));

drop policy if exists groups_read on public.groups;
create policy groups_read on public.groups
  for select to authenticated using (public.is_member(id));

drop policy if exists invites_read on public.group_invites;
create policy invites_read on public.group_invites
  for select to authenticated using (public.is_admin(group_id));

drop policy if exists members_read on public.group_members;
create policy members_read on public.group_members
  for select to authenticated using (public.is_member(group_id));

drop policy if exists lists_read on public.wish_lists;
create policy lists_read on public.wish_lists
  for select to authenticated using (public.is_member(group_id));

-- You always see your own items (drafts included). Others see them only after they submit.
drop policy if exists items_read on public.wish_items;
create policy items_read on public.wish_items
  for select to authenticated
  using (public.can_view_list(group_id, owner));

-- Adding and editing items stops when the group is archived.
drop policy if exists items_insert on public.wish_items;
create policy items_insert on public.wish_items
  for insert to authenticated
  with check (public.can_edit_items(group_id, owner));

drop policy if exists items_update on public.wish_items;
create policy items_update on public.wish_items
  for update to authenticated
  using (public.can_edit_items(group_id, owner))
  with check (public.can_edit_items(group_id, owner));

drop policy if exists items_delete on public.wish_items;
create policy items_delete on public.wish_items
  for delete to authenticated using (public.can_edit_items(group_id, owner));

-- Claims: never visible to the owner of the item, nobody can claim their own wishes,
-- and nothing can be claimed or released once the group is archived.
drop policy if exists claims_read on public.claims;
create policy claims_read on public.claims
  for select to authenticated
  using (public.wish_owner(item_id) <> public.my_id()
         and public.can_view_list(public.item_group(item_id), public.wish_owner(item_id)));

drop policy if exists claims_insert on public.claims;
create policy claims_insert on public.claims
  for insert to authenticated
  with check (
    buyer = public.my_id()
    and public.group_open(public.item_group(item_id))
    and public.wish_owner(item_id) <> public.my_id()
    and public.can_view_list(public.item_group(item_id), public.wish_owner(item_id))
  );

drop policy if exists claims_delete on public.claims;
create policy claims_delete on public.claims
  for delete to authenticated using (buyer = public.my_id() and public.group_open(public.item_group(item_id)));

-- Prices paid: only the shopper who paid can see or change them, and not once the group is archived.
drop policy if exists prices_read on public.claim_prices;
create policy prices_read on public.claim_prices
  for select to authenticated using (buyer = public.my_id());

drop policy if exists prices_insert on public.claim_prices;
create policy prices_insert on public.claim_prices
  for insert to authenticated
  with check (buyer = public.my_id() and public.group_open(public.item_group(item_id)));

drop policy if exists prices_update on public.claim_prices;
create policy prices_update on public.claim_prices
  for update to authenticated
  using (buyer = public.my_id() and public.group_open(public.item_group(item_id)))
  with check (buyer = public.my_id() and public.group_open(public.item_group(item_id)));

drop policy if exists prices_delete on public.claim_prices;
create policy prices_delete on public.claim_prices
  for delete to authenticated
  using (buyer = public.my_id() and public.group_open(public.item_group(item_id)));

-- Secret Santa: each person can read only their own row (who they are buying for). Nobody can write directly.
alter table public.santa_assignments enable row level security;
drop policy if exists santa_read on public.santa_assignments;
create policy santa_read on public.santa_assignments
  for select to authenticated using (giver = public.my_id());

-- Purchases outside someone's list: private to the shopper.
alter table public.extra_purchases enable row level security;
drop policy if exists extra_read on public.extra_purchases;
create policy extra_read on public.extra_purchases
  for select to authenticated using (buyer = public.my_id());
drop policy if exists extra_insert on public.extra_purchases;
create policy extra_insert on public.extra_purchases
  for insert to authenticated
  with check (buyer = public.my_id() and public.group_open(group_id) and public.can_shop_for(group_id, recipient));
drop policy if exists extra_update on public.extra_purchases;
create policy extra_update on public.extra_purchases
  for update to authenticated
  using (buyer = public.my_id() and public.group_open(group_id))
  with check (buyer = public.my_id() and public.group_open(group_id) and public.can_shop_for(group_id, recipient));
drop policy if exists extra_delete on public.extra_purchases;
create policy extra_delete on public.extra_purchases
  for delete to authenticated using (buyer = public.my_id() and public.group_open(group_id));

-- About-me notes are readable by exactly the people who can read that list. Written through set_list_about().
alter table public.list_about enable row level security;
drop policy if exists about_read on public.list_about;
create policy about_read on public.list_about
  for select to authenticated using (public.can_view_list(group_id, owner));

-- Feedback has no policies on purpose: only the functions above can touch it.
alter table public.feedback enable row level security;

-- Notes, tracking links and arrival: same rules as prices.
alter table public.claim_details enable row level security;
drop policy if exists details_read on public.claim_details;
create policy details_read on public.claim_details
  for select to authenticated using (buyer = public.my_id());
drop policy if exists details_insert on public.claim_details;
create policy details_insert on public.claim_details
  for insert to authenticated
  with check (buyer = public.my_id() and public.group_open(public.item_group(item_id)));
drop policy if exists details_update on public.claim_details;
create policy details_update on public.claim_details
  for update to authenticated
  using (buyer = public.my_id() and public.group_open(public.item_group(item_id)))
  with check (buyer = public.my_id() and public.group_open(public.item_group(item_id)));
drop policy if exists details_delete on public.claim_details;
create policy details_delete on public.claim_details
  for delete to authenticated
  using (buyer = public.my_id() and public.group_open(public.item_group(item_id)));

-- ---------------------------------------------------------------------------
-- Upgrade from the single-family version (runs once, only if the old tables exist)
-- ---------------------------------------------------------------------------
do $upgrade$
declare
  v_group uuid;
  v_admin uuid;
  v_today date := (now() at time zone 'America/Los_Angeles')::date;
  v_year  int;
  r       record;
begin
  if to_regclass('public.member_emails') is null or to_regclass('public.legacy_member_emails') is not null then
    return;
  end if;

  v_year := extract(year from v_today)::int;
  if v_today > make_date(v_year, 12, 25) then v_year := v_year + 1; end if;

  insert into public.profiles (email, name)
  select lower(me.email), m.name from public.member_emails me join public.members m on m.key = me.key
  on conflict (email) do nothing;

  select p.id into v_admin
  from public.member_emails me join public.members m on m.key = me.key
  join public.profiles p on p.email = lower(me.email)
  order by (me.key = 'alex') desc, m.sort limit 1;

  if v_admin is not null then
    insert into public.groups (name, event_date, item_min, admin_id)
    values ('Family Christmas', make_date(v_year, 12, 25), 3, v_admin) returning id into v_group;

    insert into public.group_members (group_id, member_id)
    select v_group, p.id from public.member_emails me join public.profiles p on p.email = lower(me.email);

    insert into public.group_invites (group_id, code)
    values (v_group, substr(replace(gen_random_uuid()::text, '-', ''), 1, 24));

    insert into public.wish_lists (group_id, owner, submitted_at, updated_at)
    select v_group, p.id, l.submitted_at, l.updated_at
    from public.lists l join public.member_emails me on me.key = l.owner
    join public.profiles p on p.email = lower(me.email);

    insert into public.wish_items (id, group_id, owner, name, description, link, price, price_as_of, quantity, position, created_at, updated_at)
    select i.id, v_group, p.id, i.name, i.description, i.link, i.price, i.price_as_of, 1, i.position, i.created_at, i.updated_at
    from public.items i join public.member_emails me on me.key = i.owner
    join public.profiles p on p.email = lower(me.email);

    insert into public.claims (item_id, buyer, created_at)
    select pu.item_id, pr.id, pu.created_at
    from public.purchases pu join public.member_emails me on me.key = pu.buyer
    join public.profiles pr on pr.email = lower(me.email);
  end if;

  -- Retire the old tables (kept as a backup) and the rules that pointed at them.
  for r in select schemaname, tablename, policyname from pg_policies
           where schemaname = 'public' and tablename in ('members', 'member_emails', 'lists', 'items', 'purchases') loop
    execute format('drop policy %I on %I.%I', r.policyname, r.schemaname, r.tablename);
  end loop;
  drop trigger if exists items_guard_delete on public.items;
  drop trigger if exists items_touch on public.items;
  alter table public.purchases     rename to legacy_purchases;
  alter table public.items         rename to legacy_items;
  alter table public.lists         rename to legacy_lists;
  alter table public.member_emails rename to legacy_member_emails;
  alter table public.members       rename to legacy_members;
  drop function if exists public.submit_list();
  drop function if exists public.notify_submitted(text);
  drop function if exists public.list_submitted(text);
  drop function if exists public.item_owner(uuid);
end
$upgrade$;

-- Anyone with the invite link can now create an account, so the old family-only gate goes away.
drop trigger if exists only_family_signups on auth.users;
drop function if exists public.only_family_signups();

-- ---------------------------------------------------------------------------
-- Permissions: signed-in people get only what the rules above allow.
-- ---------------------------------------------------------------------------
grant usage on schema public to authenticated, anon;

revoke all on all tables in schema public from anon, authenticated;
grant select on public.groups, public.group_invites, public.group_members, public.wish_lists to authenticated;
-- Signed-in users can read only the id and name of people they share a group with. Never the email.
grant select (id, name) on public.profiles to authenticated;
grant select, insert, update, delete on public.wish_items to authenticated;
grant select, insert, delete on public.claims to authenticated;
grant select, insert, update, delete on public.claim_prices to authenticated;
grant select, insert, update, delete on public.claim_details to authenticated;
grant select on public.santa_assignments, public.list_about to authenticated;
grant select, insert, update, delete on public.extra_purchases to authenticated;

revoke all on all functions in schema public from public, anon, authenticated;
grant execute on function
  public.me(), public.my_id(), public.my_profile(), public.is_member(uuid), public.is_admin(uuid), public.group_open(uuid),
  public.list_submitted(uuid, uuid), public.wish_owner(uuid), public.item_group(uuid), public.shares_group(uuid),
  public.set_profile(text), public.create_group(text, date, int), public.my_groups(),
  public.join_group(text), public.generate_invite(uuid), public.set_group_archived(uuid, boolean), public.submit_list(uuid),
  public.today_local(), public.sweep_archives(), public.edit_group(uuid, text, date), public.remove_member(uuid, uuid),
  public.can_edit_items(uuid, uuid), public.create_registry(text, date, text), public.add_list(uuid, text), public.rename_list(uuid, uuid, text),
  public.add_child_list(uuid, text), public.delete_child_list(uuid, uuid), public.announce_child_list(uuid, uuid),
  public.is_owner(), public.owner_dashboard(int), public.owner_group_view(uuid),
  public.can_view_list(uuid, uuid), public.can_shop_for(uuid, uuid), public.create_secret_santa(text, date, int), public.start_secret_santa(uuid),
  public.set_list_about(uuid, uuid, text), public.announce_list_update(uuid, uuid, int, int, int, boolean),
  public.submit_feedback(text, text), public.owner_feedback(), public.owner_set_feedback(uuid, boolean)
  to authenticated;
grant execute on function public.preview_invite(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Reminder emails are no longer sent. Switch off the daily job if an earlier version scheduled it.
-- ---------------------------------------------------------------------------
do $unschedule$
begin
  perform cron.unschedule('wishlist-daily-reminders');
exception when others then
  null;  -- nothing was scheduled
end
$unschedule$;
drop function if exists public.send_reminders(date);
