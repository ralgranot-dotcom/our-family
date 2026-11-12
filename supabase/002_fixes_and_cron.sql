-- "המשפחה שלנו" — תיקונים ותזמון (הורץ אחרי 001)

-- 1) מדיניות צפייה באירוע: בדיקה ישירה על עמודות השורה (נדרש כדי שיצירת אירוע + קבלת המזהה שלו תעבוד)
alter policy fam_events_sel on public.fam_events using (
  public.fam_is_member(family_id) and (invite_all or created_by = auth.uid() or public.fam_is_admin(family_id)
    or exists (select 1 from public.fam_event_invitees i where i.event_id = fam_events.id and i.user_id = auth.uid())));

-- 2) דיווחי תקלות מהאפליקציה (כתיבה בלבד מהלקוח; קריאה רק דרך לוח הבקרה של Supabase)
create table if not exists public.fam_bug_reports (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete set null,
  text text not null check (length(text) between 1 and 2000),
  diag jsonb,
  created_at timestamptz not null default now()
);
alter table public.fam_bug_reports enable row level security;
create policy fam_bug_ins on public.fam_bug_reports for insert to authenticated with check (user_id = auth.uid());

-- 3) מפתח סודי לתזמון + משימה כל 10 דקות (תזכורות, ימי הולדת, התראות שנדחו בגלל שעות שקטות/שבת)
insert into public.fam_private_config(key, value) values ('cron_secret', encode(extensions.gen_random_bytes(24), 'hex')) on conflict (key) do nothing;
select cron.schedule('fam-reminders', '*/10 * * * *', $$
  select net.http_post(
    url := 'https://ddytetgcdygmufitgxeg.supabase.co/functions/v1/family-api',
    body := '{"action":"cron"}'::jsonb,
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',(select value from public.fam_private_config where key='cron_secret')),
    timeout_milliseconds := 30000);
$$);

-- 4) הקשחה: פונקציות fam_ נגישות רק למשתמשים מחוברים (לא לאורחים אנונימיים)
do $$ declare f record; begin
  for f in select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'fam\_%' and p.prosecdef loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop; end $$;
