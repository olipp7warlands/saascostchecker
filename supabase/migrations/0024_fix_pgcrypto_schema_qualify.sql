-- Diagnóstico no destructivo: en qué esquema vive pgcrypto (gen_random_bytes/
-- digest) en este proyecto. 0023 los llamaba sin calificar bajo
-- `set search_path = ''`, lo que falló en remoto ("function gen_random_bytes
-- (integer) does not exist") — Supabase no siempre instala pgcrypto en
-- `public`. Este bloque solo informa, no modifica nada; el fix real
-- (funciones recreadas con el esquema correcto) va en la migración
-- siguiente, una vez confirmado el esquema.
do $$
declare
  v_schema text;
begin
  select n.nspname into v_schema
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where p.proname = 'gen_random_bytes'
  limit 1;

  raise notice 'gen_random_bytes vive en el esquema: %', coalesce(v_schema, '(no encontrado)');
end;
$$;
