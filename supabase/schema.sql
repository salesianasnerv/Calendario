-- ─── Calendario del curso · Administración ─────────────────────────────────
-- Se ejecuta en el Supabase común «Acceso Microsoft 365» (el del Control de baños), en SQL Editor.
-- Las cuentas de administración van a la lista común «permisos» (web = 'calendario'); «cal_admin» es una vista
-- sobre ella, como res_admin o pac_admin. Los documentos van a la tabla nueva «cal_documentos».
-- No cambia las reglas de las demás webs: solo añade reglas nuevas para las filas del calendario.
-- Se puede volver a ejecutar sin perder datos.

begin;

-- 1. 'calendario' como web válida en «permisos» (se añade a la lista que haya, sin tocar las demás)
do $$
declare def text;
begin
  select pg_get_constraintdef(oid) into def from pg_constraint
   where conrelid = 'permisos'::regclass and conname = 'permisos_web_check';
  if def is not null and def not like '%''calendario''%' then
    execute 'alter table permisos drop constraint permisos_web_check';
    execute 'alter table permisos add constraint permisos_web_check ' || replace(def, 'ARRAY[', 'ARRAY[''calendario''::text, ');
  end if;
end $$;

create or replace function cal_es_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select tiene_permiso('calendario')
      or (es_profesorado() and exists (select 1 from personal where email = email_actual() and activo and 'comision_pedagogica' = any(grupos_entra)))
$$;  -- también la Comisión Pedagógica (grupo de Microsoft 365, sincronizado cada noche)
grant execute on function cal_es_admin() to anon, authenticated;

-- 2. Reglas de «permisos» para las filas del calendario (se suman a las que ya hay)
drop policy if exists "calendario: ver permisos"   on permisos;
drop policy if exists "calendario: dar permiso"    on permisos;
drop policy if exists "calendario: quitar permiso" on permisos;
create policy "calendario: ver permisos" on permisos for select to authenticated
  using (web = 'calendario' and cal_es_admin());
create policy "calendario: dar permiso" on permisos for insert to authenticated
  with check (web = 'calendario' and cal_es_admin() and es_cuenta_colegio(email));
create policy "calendario: quitar permiso" on permisos for delete to authenticated
  using (web = 'calendario' and cal_es_admin() and email <> email_jwt());

-- 3. Vista «cal_admin» (se lee, se añade y se borra igual que una tabla)
create or replace view cal_admin with (security_invoker = true) as
  select email, creado, web from permisos where web = 'calendario' with cascaded check option;
alter view cal_admin alter column web set default 'calendario';
alter view cal_admin alter column creado set default now();
grant select, insert, delete on cal_admin to authenticated;
revoke all on cal_admin from anon;

-- 4. Enlaces a los documentos actualizados (calendario de cada curso, horas no lectivas de cada trimestre…)
create table if not exists cal_documentos (
  id         bigint generated always as identity primary key,
  tipo       text not null default 'otro' check (tipo in ('calendario', 'horas', 'otro')),
  titulo     text not null check (length(trim(titulo)) > 0),
  curso      text not null default '',
  enlace     text not null check (enlace ~* '^https?://'),
  notas      text not null default '',
  creado     timestamptz not null default now(),
  creado_por text not null default email_jwt()
);
alter table cal_documentos enable row level security;
drop policy if exists "ver documentos"       on cal_documentos;
drop policy if exists "gestionar documentos" on cal_documentos;
create policy "ver documentos"       on cal_documentos for select to authenticated using (cal_es_admin());
create policy "gestionar documentos" on cal_documentos for all    to authenticated
  using (cal_es_admin()) with check (cal_es_admin());
grant select, insert, update, delete on cal_documentos to authenticated;
revoke all on cal_documentos from anon;

-- 5. Primeras cuentas de administración (después se gestionan desde la web)
insert into permisos (email, web) values
  ('mangeles.chavez@salesianas.org', 'calendario'),
  ('administracionnervion@salesianas.org', 'calendario')
on conflict do nothing;

-- 6. Documentos de partida
insert into cal_documentos (tipo, titulo, curso, enlace, notas, creado_por)
select * from (values
  ('calendario', 'Calendario del curso (Word)', '2026-2027',
   'https://salesianas.sharepoint.com/:w:/s/E-NER/Comisionpedagogica/IQDO5KKwO-SWRKH9DHEX6jNaAVEkqT0b1dWZ5_aWuDWlkm4?e=5xK7cc',
   'Comisión pedagógica. Es el que lee la web (config.json).', ''),
  ('horas', 'Horas no lectivas · 1.er trimestre (PDF)', '2026-2027',
   'https://salesianas.sharepoint.com/:b:/s/E-NER/Claustro/IQDNqXTgzrtVQLsZtPBkRIJtASWLzlgQoh_vIFxHOYLHRbE?e=dawbFC',
   'Claustro. Pasado a horas-no-lectivas.json.', '')
) as v(tipo, titulo, curso, enlace, notas, creado_por)
where not exists (select 1 from cal_documentos);

commit;

notify pgrst, 'reload schema';
