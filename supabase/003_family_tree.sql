-- "המשפחה שלנו" — עץ משפחה (גרסה 1.1.0)
-- כל בן משפחה פעיל יכול להוסיף את עצמו ואת הדורות הקודמים.
-- פרטים אישיים של אדם בעץ: רק מי שהוסיף אותו, האדם עצמו (אם קושר אליו) או מנהל.
-- קשרים (אבא/אמא/בן או בת זוג): כל בן משפחה יכול לחבר — כדי שכולם יבנו את העץ יחד.

create table if not exists public.fam_tree_people (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.fam_families(id) on delete cascade,
  first_name text not null check (length(trim(first_name)) between 1 and 40),
  last_name text check (last_name is null or length(last_name) <= 40),
  maiden_name text check (maiden_name is null or length(maiden_name) <= 40),
  gender text check (gender is null or gender in ('male','female')),
  birth_date date,
  death_date date,
  is_deceased boolean not null default false,
  birth_place text check (birth_place is null or length(birth_place) <= 80),
  bio text check (bio is null or length(bio) <= 1000),
  photo_path text,
  linked_user_id uuid references auth.users(id) on delete set null,
  father_id uuid references public.fam_tree_people(id) on delete set null,
  mother_id uuid references public.fam_tree_people(id) on delete set null,
  spouse_id uuid references public.fam_tree_people(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (death_date is null or birth_date is null or death_date >= birth_date),
  unique (family_id, linked_user_id)
);
create index if not exists fam_tree_family_idx on public.fam_tree_people(family_id);
create index if not exists fam_tree_father_idx on public.fam_tree_people(father_id);
create index if not exists fam_tree_mother_idx on public.fam_tree_people(mother_id);

-- בדיקות תקינות לפני שמירה
create or replace function public.fam_tree_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_priv boolean;
begin
  if tg_op = 'UPDATE' then
    new.family_id := old.family_id;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    v_priv := old.created_by = auth.uid() or old.linked_user_id = auth.uid() or public.fam_is_admin(old.family_id);
    if auth.uid() is not null and not coalesce(v_priv, false) then
      -- משתמש רגיל יכול לשנות כאן רק קשרים, ולסמן "זה אני" אם הכרטיס עוד לא שייך לאף אחד
      if (new.first_name, new.last_name, new.maiden_name, new.gender, new.birth_date, new.death_date, new.is_deceased, new.birth_place, new.bio, new.photo_path)
         is distinct from
         (old.first_name, old.last_name, old.maiden_name, old.gender, old.birth_date, old.death_date, old.is_deceased, old.birth_place, old.bio, old.photo_path) then
        raise exception 'רק מי שהוסיף את האדם הזה, האדם עצמו או מנהל יכולים לשנות את פרטיו';
      end if;
    end if;
    if auth.uid() is not null and new.linked_user_id is distinct from old.linked_user_id then
      if not (
        (old.linked_user_id is null and new.linked_user_id = auth.uid())
        or (new.linked_user_id is null and (old.linked_user_id = auth.uid() or public.fam_is_admin(old.family_id)))
      ) then
        raise exception 'אפשר לסמן "זה אני" רק עבור עצמך';
      end if;
    end if;
  end if;
  new.updated_at := now();
  if new.father_id = new.id or new.mother_id = new.id or new.spouse_id = new.id then
    raise exception 'אדם לא יכול להיות מקושר לעצמו';
  end if;
  if new.father_id is not null and not exists (select 1 from fam_tree_people p where p.id = new.father_id and p.family_id = new.family_id) then
    raise exception 'האב חייב להיות מאותה משפחה'; end if;
  if new.mother_id is not null and not exists (select 1 from fam_tree_people p where p.id = new.mother_id and p.family_id = new.family_id) then
    raise exception 'האם חייבת להיות מאותה משפחה'; end if;
  if new.spouse_id is not null and not exists (select 1 from fam_tree_people p where p.id = new.spouse_id and p.family_id = new.family_id) then
    raise exception 'בן/בת הזוג חייבים להיות מאותה משפחה'; end if;
  -- מניעת מעגל: אדם לא יכול להיות אב קדמון של עצמו
  if (new.father_id is not null or new.mother_id is not null) and tg_op = 'UPDATE' and exists (
    with recursive anc(id) as (
      select x from unnest(array[new.father_id, new.mother_id]) x where x is not null
      union
      select unnest(array[p.father_id, p.mother_id]) from fam_tree_people p join anc on p.id = anc.id
    ) select 1 from anc where id = new.id) then
    raise exception 'הקשר הזה יוצר מעגל בעץ (אדם לא יכול להיות הורה של אחד מהוריו)';
  end if;
  return new;
end $$;
create trigger fam_tree_guard_trg before insert or update on public.fam_tree_people
  for each row execute function public.fam_tree_guard();

-- בן/בת זוג תמיד הדדי
create or replace function public.fam_tree_spouse_sync() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if pg_trigger_depth() > 3 then return null; end if;
  if tg_op = 'UPDATE' and old.spouse_id is not null and old.spouse_id is distinct from new.spouse_id then
    update fam_tree_people set spouse_id = null where id = old.spouse_id and spouse_id = new.id;
  end if;
  if new.spouse_id is not null then
    update fam_tree_people set spouse_id = null where spouse_id = new.spouse_id and id <> new.id;
    update fam_tree_people set spouse_id = new.id where id = new.spouse_id and spouse_id is distinct from new.id;
  end if;
  return null;
end $$;
create trigger fam_tree_spouse_trg after insert or update of spouse_id on public.fam_tree_people
  for each row execute function public.fam_tree_spouse_sync();

alter table public.fam_tree_people enable row level security;
create policy fam_tree_sel on public.fam_tree_people for select to authenticated
  using (public.fam_is_member(family_id));
create policy fam_tree_ins on public.fam_tree_people for insert to authenticated
  with check (public.fam_is_member(family_id) and created_by = auth.uid() and (linked_user_id is null or linked_user_id = auth.uid()));
create policy fam_tree_upd on public.fam_tree_people for update to authenticated
  using (public.fam_is_member(family_id)) with check (public.fam_is_member(family_id));
create policy fam_tree_del on public.fam_tree_people for delete to authenticated
  using (public.fam_is_member(family_id) and (created_by = auth.uid() or public.fam_is_admin(family_id)));

revoke execute on function public.fam_tree_guard() from public, anon;
revoke execute on function public.fam_tree_spouse_sync() from public, anon;

do $$ begin
  begin alter publication supabase_realtime add table public.fam_tree_people; exception when duplicate_object then null; end;
end $$;
