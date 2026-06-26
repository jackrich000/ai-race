-- Migration 008: Lock down the rls_auto_enable() event-trigger function.
--
-- Background: the `ensure_rls` event trigger (below) fires on every CREATE TABLE
-- in the public schema and auto-enables Row Level Security on the new table. It
-- and its helper function were created ad-hoc via the SQL editor and never lived
-- in git; this migration records them so the database is reproducible.
--
-- The fix: the helper is SECURITY DEFINER and, by Postgres' default, had EXECUTE
-- granted to PUBLIC (and thus anon/authenticated), so it was callable through the
-- public REST API at /rest/v1/rpc/rls_auto_enable. Supabase's linter flags that
-- (lints 0028/0029). Revoking the public grant resolves both. The event trigger
-- still fires normally afterwards: event triggers invoke their function via the
-- trigger mechanism, which does not require an EXECUTE grant.
--
-- Applied via scripts/apply-migrations.mjs (npm run migrate), which wraps this in
-- a transaction.

-- 1. Canonical definition of the helper (captured from the live DB via
--    pg_get_functiondef). CREATE OR REPLACE preserves existing ownership/grants.
CREATE OR REPLACE FUNCTION public.rls_auto_enable()
 RETURNS event_trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$function$;

-- 2. The actual fix: remove public callability of this SECURITY DEFINER function.
REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM anon;
REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM authenticated;

-- 3. Record the event trigger that wires the helper to DDL events. Recreated
--    idempotently so this migration fully reconstructs the behaviour on a fresh DB.
DROP EVENT TRIGGER IF EXISTS ensure_rls;
CREATE EVENT TRIGGER ensure_rls ON ddl_command_end
  EXECUTE FUNCTION public.rls_auto_enable();
