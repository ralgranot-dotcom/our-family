-- "המשפחה שלנו" — סכמת מסד הנתונים (שלב 1), בדיוק כפי שהורצה בפרויקט Supabase
-- כל הטבלאות בקידומת fam_ כדי שלא יתערבבו עם מערכת חוד החנית באותו פרויקט.
-- אחרי קובץ זה הורץ 002_fixes_and_cron.sql.

create table if not exists public.fam_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  login_id text not null,
  first_name text not null default '',
  last_name text not null default '',
  nickname text, phone text, email text, birthday date, family_role text, availability text, avatar_path text,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.fam_families (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 60),
  photo_path text,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);
create table if not exists public.fam_members (
  family_id uuid not null references public.fam_families(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner','admin','member','junior')),
  status text not null default 'pending' check (status in ('active','pending')),
  joined_at timestamptz not null default now(),
  primary key (family_id, user_id)
);
create index if not exists fam_members_user_idx on public.fam_members(user_id);
create table if not exists public.fam_invites (
  code text primary key,
  family_id uuid not null references public.fam_families(id) on delete cascade,
  created_by uuid not null references auth.users(id),
  requires_approval boolean not null default true,
  expires_at timestamptz not null,
  max_uses int not null default 20,
  uses int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists fam_invites_family_idx on public.fam_invites(family_id);
create table if not exists public.fam_events (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.fam_families(id) on delete cascade,
  created_by uuid not null references auth.users(id),
  title text not null check (length(trim(title)) between 1 and 80),
  event_type text not null default 'gathering',
  starts_at timestamptz not null,
  ends_at timestamptz,
  location text, address text, description text,
  desired_count int,
  rsvp_required boolean not null default true,
  rsvp_deadline timestamptz,
  allow_suggestions boolean not null default true,
  invite_all boolean not null default true,
  status text not null default 'active' check (status in ('active','cancelled')),
  last_reminder_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at is null or ends_at >= starts_at)
);
create index if not exists fam_events_family_start_idx on public.fam_events(family_id, starts_at);
create table if not exists public.fam_event_invitees (
  event_id uuid not null references public.fam_events(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  primary key (event_id, user_id)
);
create table if not exists public.fam_rsvps (
  event_id uuid not null references public.fam_events(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null check (status in ('yes','no','maybe')),
  guests int not null default 0 check (guests between 0 and 30),
  note text check (note is null or length(note) <= 200),
  updated_at timestamptz not null default now(),
  primary key (event_id, user_id)
);
create table if not exists public.fam_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  family_id uuid references public.fam_families(id) on delete cascade,
  event_id uuid references public.fam_events(id) on delete cascade,
  kind text not null, title text not null, body text,
  dedupe text unique,
  push_state text not null default 'pending' check (push_state in ('pending','sent','skipped')),
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists fam_notifications_user_idx on public.fam_notifications(user_id, created_at desc);
create index if not exists fam_notifications_push_idx on public.fam_notifications(push_state) where push_state = 'pending';
create table if not exists public.fam_push_subs (
  endpoint text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  p256dh text not null, auth text not null,
  created_at timestamptz not null default now()
);
create table if not exists public.fam_audit (
  id bigint generated always as identity primary key,
  family_id uuid references public.fam_families(id) on delete cascade,
  actor uuid, action text not null, details jsonb,
  at timestamptz not null default now()
);
create table if not exists public.fam_private_config (key text primary key, value text not null);

create or replace function public.fam_is_member(p_family uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from fam_members where family_id = p_family and user_id = auth.uid() and status = 'active');
$$;
create or replace function public.fam_role(p_family uuid) returns text
language sql stable security definer set search_path = public as $$
  select role from fam_members where family_id = p_family and user_id = auth.uid() and status = 'active';
$$;
create or replace function public.fam_is_admin(p_family uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.fam_role(p_family) in ('owner','admin'), false);
$$;
create or replace function public.fam_shares_family(p_other uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select p_other = auth.uid()
    or exists (select 1 from fam_members a join fam_members b on a.family_id = b.family_id
               where a.user_id = auth.uid() and a.status = 'active' and b.user_id = p_other and b.status = 'active')
    or exists (select 1 from fam_members a join fam_members b on a.family_id = b.family_id
               where a.user_id = auth.uid() and a.status = 'active' and a.role in ('owner','admin')
                 and b.user_id = p_other and b.status = 'pending');
$$;
create or replace function public.fam_can_see_event(p_event uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from fam_events e
    where e.id = p_event and public.fam_is_member(e.family_id)
      and (e.invite_all or e.created_by = auth.uid() or public.fam_is_admin(e.family_id)
           or exists (select 1 from fam_event_invitees i where i.event_id = e.id and i.user_id = auth.uid())));
$$;
create or replace function public.fam_can_manage_event(p_event uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from fam_events e where e.id = p_event and public.fam_is_member(e.family_id)
                 and (e.created_by = auth.uid() or public.fam_is_admin(e.family_id)));
$$;
create or replace function public.fam_can_rsvp(p_event uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from fam_events e where e.id = p_event and e.status = 'active'
                 and (e.rsvp_deadline is null or now() <= e.rsvp_deadline))
     and public.fam_can_see_event(p_event);
$$;
create or replace function public.fam_shares_family_path(p_name text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare v text := split_part(p_name, '/', 1);
begin
  if v !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return false; end if;
  return public.fam_shares_family(v::uuid);
end $$;

alter table public.fam_profiles enable row level security;
alter table public.fam_families enable row level security;
alter table public.fam_members enable row level security;
alter table public.fam_invites enable row level security;
alter table public.fam_events enable row level security;
alter table public.fam_event_invitees enable row level security;
alter table public.fam_rsvps enable row level security;
alter table public.fam_notifications enable row level security;
alter table public.fam_push_subs enable row level security;
alter table public.fam_audit enable row level security;
alter table public.fam_private_config enable row level security;

create policy fam_profiles_sel on public.fam_profiles for select to authenticated using (public.fam_shares_family(id));
create policy fam_profiles_ins on public.fam_profiles for insert to authenticated with check (id = auth.uid());
create policy fam_profiles_upd on public.fam_profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
create policy fam_families_sel on public.fam_families for select to authenticated
  using (exists (select 1 from fam_members m where m.family_id = fam_families.id and m.user_id = auth.uid()));
create policy fam_families_upd on public.fam_families for update to authenticated using (public.fam_is_admin(id)) with check (public.fam_is_admin(id));
create policy fam_members_sel on public.fam_members for select to authenticated using (user_id = auth.uid() or public.fam_is_member(family_id));
create policy fam_invites_sel on public.fam_invites for select to authenticated using (public.fam_is_admin(family_id));
create policy fam_invites_del on public.fam_invites for delete to authenticated using (public.fam_is_admin(family_id));
create policy fam_events_sel on public.fam_events for select to authenticated using (public.fam_can_see_event(id));
create policy fam_events_ins on public.fam_events for insert to authenticated
  with check (created_by = auth.uid() and public.fam_is_member(family_id) and public.fam_role(family_id) <> 'junior');
create policy fam_events_upd on public.fam_events for update to authenticated
  using (created_by = auth.uid() or public.fam_is_admin(family_id)) with check (created_by = auth.uid() or public.fam_is_admin(family_id));
create policy fam_events_del on public.fam_events for delete to authenticated using (created_by = auth.uid() or public.fam_is_admin(family_id));
create policy fam_inv_sel on public.fam_event_invitees for select to authenticated using (public.fam_can_see_event(event_id));
create policy fam_inv_ins on public.fam_event_invitees for insert to authenticated with check (public.fam_can_manage_event(event_id));
create policy fam_inv_del on public.fam_event_invitees for delete to authenticated using (public.fam_can_manage_event(event_id));
create policy fam_rsvps_sel on public.fam_rsvps for select to authenticated using (public.fam_can_see_event(event_id));
create policy fam_rsvps_ins on public.fam_rsvps for insert to authenticated with check (user_id = auth.uid() and public.fam_can_rsvp(event_id));
create policy fam_rsvps_upd on public.fam_rsvps for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid() and public.fam_can_rsvp(event_id));
create policy fam_notif_sel on public.fam_notifications for select to authenticated using (user_id = auth.uid());
create policy fam_notif_upd on public.fam_notifications for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy fam_notif_del on public.fam_notifications for delete to authenticated using (user_id = auth.uid());
create policy fam_push_all on public.fam_push_subs for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy fam_audit_sel on public.fam_audit for select to authenticated using (public.fam_is_admin(family_id));

create or replace function public.fam_events_guard() returns trigger language plpgsql set search_path = public as $$
begin new.family_id := old.family_id; new.created_by := old.created_by; new.updated_at := now(); return new; end $$;
create trigger fam_events_guard_trg before update on public.fam_events for each row execute function public.fam_events_guard();
create or replace function public.fam_profiles_touch() returns trigger language plpgsql set search_path = public as $$
begin new.updated_at := now(); new.login_id := old.login_id; return new; end $$;
create trigger fam_profiles_touch_trg before update on public.fam_profiles for each row execute function public.fam_profiles_touch();
create or replace function public.fam_rsvps_touch() returns trigger language plpgsql set search_path = public as $$
begin new.updated_at := now(); return new; end $$;
create trigger fam_rsvps_touch_trg before insert or update on public.fam_rsvps for each row execute function public.fam_rsvps_touch();

create or replace function public.fam_create_family(p_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'נדרשת התחברות'; end if;
  if length(trim(coalesce(p_name,''))) = 0 then raise exception 'יש להזין שם משפחה'; end if;
  if (select count(*) from fam_members where user_id = auth.uid() and role = 'owner') >= 10 then
    raise exception 'הגעת למספר המרבי של משפחות שאפשר להקים'; end if;
  insert into fam_families(name, created_by) values (trim(p_name), auth.uid()) returning id into v_id;
  insert into fam_members(family_id, user_id, role, status) values (v_id, auth.uid(), 'owner', 'active');
  insert into fam_audit(family_id, actor, action, details) values (v_id, auth.uid(), 'family_created', jsonb_build_object('name', trim(p_name)));
  return v_id;
end $$;

create or replace function public.fam_create_invite(p_family uuid, p_requires_approval boolean default true, p_days int default 7)
returns text language plpgsql security definer set search_path = public as $$
declare v_code text; v_alpha text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; i int;
begin
  if not public.fam_is_admin(p_family) then raise exception 'רק מנהל יכול ליצור הזמנה'; end if;
  loop
    v_code := '';
    for i in 1..8 loop
      v_code := v_code || substr(v_alpha, 1 + (get_byte(extensions.gen_random_bytes(1), 0) % 32), 1);
    end loop;
    exit when not exists (select 1 from fam_invites where code = v_code);
  end loop;
  insert into fam_invites(code, family_id, created_by, requires_approval, expires_at)
  values (v_code, p_family, auth.uid(), coalesce(p_requires_approval, true), now() + make_interval(days => greatest(1, least(coalesce(p_days,7), 30))));
  insert into fam_audit(family_id, actor, action, details) values (p_family, auth.uid(), 'invite_created', jsonb_build_object('requires_approval', p_requires_approval));
  return v_code;
end $$;

create or replace function public.fam_join_with_code(p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_inv fam_invites; v_status text; v_existing text; v_name text;
begin
  if auth.uid() is null then raise exception 'נדרשת התחברות'; end if;
  select * into v_inv from fam_invites where code = upper(regexp_replace(coalesce(p_code,''), '[^A-Za-z0-9]', '', 'g')) for update;
  if not found then raise exception 'קוד ההזמנה לא נמצא'; end if;
  if v_inv.expires_at < now() then raise exception 'תוקף קוד ההזמנה פג. בקש קוד חדש ממנהל המשפחה'; end if;
  if v_inv.uses >= v_inv.max_uses then raise exception 'קוד ההזמנה נוצל עד הסוף. בקש קוד חדש'; end if;
  select name into v_name from fam_families where id = v_inv.family_id;
  select status into v_existing from fam_members where family_id = v_inv.family_id and user_id = auth.uid();
  if v_existing is not null then
    return jsonb_build_object('family_id', v_inv.family_id, 'family_name', v_name, 'status', v_existing, 'already', true);
  end if;
  v_status := case when v_inv.requires_approval then 'pending' else 'active' end;
  insert into fam_members(family_id, user_id, role, status) values (v_inv.family_id, auth.uid(), 'member', v_status);
  update fam_invites set uses = uses + 1 where code = v_inv.code;
  insert into fam_audit(family_id, actor, action, details) values (v_inv.family_id, auth.uid(), 'joined_with_code', jsonb_build_object('status', v_status));
  return jsonb_build_object('family_id', v_inv.family_id, 'family_name', v_name, 'status', v_status, 'already', false);
end $$;

create or replace function public.fam_approve_member(p_family uuid, p_user uuid, p_approve boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.fam_is_admin(p_family) then raise exception 'רק מנהל יכול לאשר הצטרפות'; end if;
  if p_approve then
    update fam_members set status = 'active', joined_at = now() where family_id = p_family and user_id = p_user and status = 'pending';
  else
    delete from fam_members where family_id = p_family and user_id = p_user and status = 'pending';
  end if;
  if not found then raise exception 'הבקשה לא נמצאה'; end if;
  insert into fam_audit(family_id, actor, action, details) values (p_family, auth.uid(), case when p_approve then 'member_approved' else 'member_rejected' end, jsonb_build_object('user', p_user));
end $$;

create or replace function public.fam_set_role(p_family uuid, p_user uuid, p_role text) returns void
language plpgsql security definer set search_path = public as $$
declare v_target text;
begin
  if not public.fam_is_admin(p_family) then raise exception 'רק מנהל יכול לשנות הרשאות'; end if;
  if p_role not in ('admin','member','junior') then raise exception 'תפקיד לא תקין'; end if;
  select role into v_target from fam_members where family_id = p_family and user_id = p_user and status = 'active';
  if v_target is null then raise exception 'המשתתף לא נמצא'; end if;
  if v_target = 'owner' then raise exception 'אי אפשר לשנות את הרשאות המנהל הראשי'; end if;
  update fam_members set role = p_role where family_id = p_family and user_id = p_user;
  insert into fam_audit(family_id, actor, action, details) values (p_family, auth.uid(), 'role_changed', jsonb_build_object('user', p_user, 'from', v_target, 'to', p_role));
end $$;

create or replace function public.fam_remove_member(p_family uuid, p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_target text;
begin
  select role into v_target from fam_members where family_id = p_family and user_id = p_user;
  if v_target is null then raise exception 'המשתתף לא נמצא'; end if;
  if p_user = auth.uid() then
    if v_target = 'owner' then raise exception 'המנהל הראשי לא יכול לעזוב את המשפחה'; end if;
  else
    if not public.fam_is_admin(p_family) then raise exception 'רק מנהל יכול להסיר משתתפים'; end if;
    if v_target = 'owner' then raise exception 'אי אפשר להסיר את המנהל הראשי'; end if;
    if v_target = 'admin' and public.fam_role(p_family) <> 'owner' then raise exception 'רק המנהל הראשי יכול להסיר מנהל'; end if;
  end if;
  delete from fam_members where family_id = p_family and user_id = p_user;
  delete from fam_event_invitees i using fam_events e where i.event_id = e.id and e.family_id = p_family and i.user_id = p_user;
  insert into fam_audit(family_id, actor, action, details) values (p_family, auth.uid(), case when p_user = auth.uid() then 'member_left' else 'member_removed' end, jsonb_build_object('user', p_user));
end $$;

create or replace function public.fam_delete_my_data() returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'נדרשת התחברות'; end if;
  if exists (select 1 from fam_members m where m.user_id = auth.uid() and m.role = 'owner'
             and exists (select 1 from fam_members o where o.family_id = m.family_id and o.user_id <> auth.uid())) then
    raise exception 'אתה מנהל ראשי של משפחה שיש בה משתתפים נוספים. יש להסיר את המשתתפים לפני מחיקת החשבון';
  end if;
  delete from fam_families f where f.created_by = auth.uid()
    and not exists (select 1 from fam_members o where o.family_id = f.id and o.user_id <> auth.uid());
  delete from fam_members where user_id = auth.uid();
  delete from fam_rsvps where user_id = auth.uid();
  delete from fam_notifications where user_id = auth.uid();
  delete from fam_push_subs where user_id = auth.uid();
  delete from fam_profiles where id = auth.uid();
end $$;

grant execute on function public.fam_create_family(text) to authenticated;
grant execute on function public.fam_create_invite(uuid, boolean, int) to authenticated;
grant execute on function public.fam_join_with_code(text) to authenticated;
grant execute on function public.fam_approve_member(uuid, uuid, boolean) to authenticated;
grant execute on function public.fam_set_role(uuid, uuid, text) to authenticated;
grant execute on function public.fam_remove_member(uuid, uuid) to authenticated;
grant execute on function public.fam_delete_my_data() to authenticated;

alter table public.fam_events replica identity full;
alter table public.fam_rsvps replica identity full;
alter table public.fam_members replica identity full;
do $$ begin
  begin alter publication supabase_realtime add table public.fam_events; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.fam_rsvps; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.fam_members; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.fam_notifications; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.fam_profiles; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.fam_event_invitees; exception when duplicate_object then null; end;
end $$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('fam-media', 'fam-media', false, 2097152, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;
create policy fam_media_read on storage.objects for select to authenticated
  using (bucket_id = 'fam-media' and public.fam_shares_family_path(name));
create policy fam_media_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'fam-media' and (storage.foldername(name))[1] = auth.uid()::text);
create policy fam_media_update on storage.objects for update to authenticated
  using (bucket_id = 'fam-media' and (storage.foldername(name))[1] = auth.uid()::text);
create policy fam_media_delete on storage.objects for delete to authenticated
  using (bucket_id = 'fam-media' and (storage.foldername(name))[1] = auth.uid()::text);
