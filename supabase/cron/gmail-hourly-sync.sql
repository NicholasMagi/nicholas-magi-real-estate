-- Eseguire solo DOPO aver creato in Supabase Vault il segreto:
-- name: secret_key
-- value: la Supabase Secret API key (sb_secret_...), mai la publishable key.
-- Non inserire la chiave direttamente in questo file o nel repository.
--
-- La funzione Edge nmre-gmail-scheduled accetta esclusivamente la Secret API key
-- predefinita (nome API key: default) tramite withSupabase({ auth: "secret" }).
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'project_url') then
    perform vault.create_secret(
      'https://hhircfmrtkgaybrougku.supabase.co',
      'project_url'
    );
  end if;
end
$$;

select cron.schedule(
  'nmre-gmail-hourly-sync',
  '15 * * * *',
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
