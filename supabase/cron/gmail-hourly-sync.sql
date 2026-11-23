-- Gmail sync every 10 minutes for Nicholas Magi Real Estate.
-- The secret_key value must already exist in Supabase Vault.
-- Never put secret values in this file or in the repository.

do $project_url$
begin
  if not exists (select 1 from vault.secrets where name = 'project_url') then
    perform vault.create_secret(
      'https://hhircfmrtkgaybrougku.supabase.co',
      'project_url'
    );
  end if;
end
$project_url$;

-- Idempotent: create the named job once, then update it on subsequent runs.
do $gmail_job$
declare
  v_job_id bigint;
begin
  select jobid
    into v_job_id
    from cron.job
   where jobname = 'nmre-gmail-hourly-sync'
   limit 1;

  if v_job_id is null then
    perform cron.schedule(
      'nmre-gmail-hourly-sync',
      '*/10 * * * *',
      $job$
        select net.http_post(
          url := (
            select decrypted_secret
              from vault.decrypted_secrets
             where name = 'project_url'
          ) || '/functions/v1/nmre-gmail-scheduled',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'apikey', (
              select decrypted_secret
                from vault.decrypted_secrets
               where name = 'secret_key'
            )
          ),
          body := '{}'::jsonb,
          timeout_milliseconds := 30000
        ) as request_id;
      $job$
    );
  else
    perform cron.alter_job(
      v_job_id,
      schedule := '*/10 * * * *',
      command := $job$
        select net.http_post(
          url := (
            select decrypted_secret
              from vault.decrypted_secrets
             where name = 'project_url'
          ) || '/functions/v1/nmre-gmail-scheduled',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'apikey', (
              select decrypted_secret
                from vault.decrypted_secrets
               where name = 'secret_key'
            )
          ),
          body := '{}'::jsonb,
          timeout_milliseconds := 30000
        ) as request_id;
      $job$,
      active := true
    );
  end if;
end
$gmail_job$;
