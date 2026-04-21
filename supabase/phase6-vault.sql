create or replace function public.get_runtime_secret(secret_name text)
returns text
language sql
security definer
set search_path = public, vault
as $$
  select decrypted_secret
  from vault.decrypted_secrets
  where name = secret_name
  order by updated_at desc nulls last, created_at desc
  limit 1;
$$;

revoke all on function public.get_runtime_secret(text) from public;
grant execute on function public.get_runtime_secret(text) to service_role;

create or replace function public.upsert_runtime_secret(
  secret_name text,
  secret_value text,
  secret_description text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  existing_id uuid;
begin
  select id
  into existing_id
  from vault.decrypted_secrets
  where name = secret_name
  order by updated_at desc nulls last, created_at desc
  limit 1;

  if existing_id is null then
    return vault.create_secret(secret_value, secret_name, coalesce(secret_description, ''));
  end if;

  perform vault.update_secret(existing_id, secret_value, secret_name, coalesce(secret_description, ''));
  return existing_id;
end;
$$;

revoke all on function public.upsert_runtime_secret(text, text, text) from public;
grant execute on function public.upsert_runtime_secret(text, text, text) to service_role;
