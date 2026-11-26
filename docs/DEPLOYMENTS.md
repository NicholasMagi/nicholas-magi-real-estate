# Registro dei rilasci

Questo registro riporta commit sorgente e versioni distribuite. Non contiene chiavi, token o altri segreti.

## Rilasci verificati

| Data | Componente | Versione | Commit sorgente | Verifica |
|---|---|---:|---|---|
| 2026-11-26 | Frontend GitHub Pages | — | `f084623ac9f9` | CI `45855645175` superata; sito verificato online |
| 2026-11-26 | Supabase Edge Function `nmre-gmail-scheduled` | 69 | `f084623ac9f99f27f409610f6fc7c7c5fc367c57` | Deploy verificato; prima esecuzione pianificata HTTP 200 |

## Regola per i prossimi rilasci

A ogni distribuzione aggiungere una riga con:

- data e ora UTC;
- componente e ambiente;
- versione Edge Function, quando applicabile;
- SHA completo del commit sorgente;
- run CI associato;
- risultato del controllo successivo al deploy.

Per `nmre-gmail-scheduled`, mantenere `verify_jwt = false` coerente con la chiamata server-to-server: l'handler usa `withSupabase({ auth: "secret" })` per verificare la Secret API Key. La configurazione in `supabase/config.toml` governa i deploy effettuati con Supabase CLI; un deploy eseguito tramite Dashboard o connettore deve mantenere esplicitamente la stessa impostazione. Non riportare mai nel registro il valore della chiave.
