# nmre-subito-dry-run · Prova senza scritture di una singola email Subito

Analizza **una sola** email Subito di ricerca salvata e restituisce un rapporto. Per ogni
annuncio della pagina dei risultati indica:

- ID Subito, URL diretto, titolo, prezzo, comune, superficie e tipo di inserzionista;
- se l'annuncio è già nelle Opportunità o nell'Archivio;
- la decisione proposta: nuovo con certezza, novità non dimostrabile (con l'anteprima
  della scheda individuale «Da verificare») oppure nessuna proposta.

**Non salva nulla.** È una funzione separata da `nmre-gmail-scheduled`, che non viene
modificata: le funzioni condivise per Subito sono riusate così come sono.

## Garanzie

| Vincolo | Come è garantito | Test |
|---|---|---|
| Nessuna scrittura su Supabase | Il database passa solo da `readOnlyDb()`: per `annunci_candidati` e `annunci` esistono soltanto `select()` e i filtri di lettura, inviati in GET; `insert`, `update`, `upsert`, `delete` e qualsiasi altro metodo sollevano un errore. L'unica RPC ammessa (`nmre_get_gmail_tokens`) è inviata in GET: PostgREST la esegue in una transazione READ ONLY. Richiede che la funzione sia **STABLE** (migrazione `20261126200000_gmail_tokens_rpc_stable`, non applicata). Finché resta VOLATILE la chiamata in GET viene rifiutata e la prova si ferma con l'esito `token_non_leggibili_in_sola_lettura`: **non esiste un ripiego su POST** | `readonly_test.ts`, `index_guard_test.ts`; nei test di `dry_run_test.ts` il contatore delle scritture del database simulato resta 0 e le tabelle restano identiche |
| Nessuna modifica di annunci o dati manuali | Come sopra; gli annunci già presenti, anche scartati o con decisione manuale, vengono solo letti e segnalati | `dry_run_test.ts` («annunci già presenti») |
| Nessun avanzamento del cursore Gmail | Il cursore non viene né letto né scritto; non si usano la cronologia, il lock della sincronizzazione o il watch | `index_guard_test.ts` |
| Nessun salvataggio del token | Un token scaduto viene rinnovato solo in memoria; `nmre_save_gmail_tokens` non è raggiungibile | `readonly_test.ts`, `index_guard_test.ts` |
| Una sola email | Mittente `subito.it`, oggetto esatto e giorno (ora italiana) devono coincidere, con **esattamente una** corrispondenza tra al massimo 10 email elencate; altrimenti nessuna email viene elaborata | `dry_run_test.ts` («selezione») |
| Gmail in sola lettura | Solo GET verso il profilo, l'elenco e il singolo messaggio; modifica, cestino, etichette, cronologia e watch sono rifiutati | `readonly_test.ts` |
| Pagina Subito | Una sola richiesta GET, uguale a quella della sincronizzazione; CAPTCHA o blocchi danno «pagina non disponibile», senza nuovi tentativi | `dry_run_test.ts` («pagina protetta») |
| Nessuna notifica push | Nessuna riga viene inserita, quindi nessun trigger di notifica può attivarsi; il codice non usa le tabelle delle notifiche | `index_guard_test.ts` |
| Log | Un solo log, con esito e conteggi; il corpo dell'email e i token non compaiono né nei log né nel rapporto | `index_guard_test.ts`, `dry_run_test.ts` |
| Accesso | Solo la sessione del titolare (JWT con id = `NMRE_ALLOWED_USER_ID`). La verifica JWT della piattaforma resta attiva: nessuna voce in `supabase/config.toml` | `index_guard_test.ts` |

Se un confronto con Opportunità o Archivio non riesce, **nessun** annuncio viene proposto
(esito `confronto_non_riuscito`).

## Limiti noti

- La pagina dei risultati viene letta **al momento della prova**, non quando è arrivata
  l'email. Annunci rimossi o finiti nelle pagine successive non compaiono, e il rapporto
  lo segnala.
- Senza un'email precedente della stessa ricerca registrata in NMRE, la novità non è
  dimostrabile. In quel caso vengono proposti **tutti** gli annunci pubblicati prima
  dell'email: sulla pagina reale del 26/11 sono 30.
- Il registro dei venditori verificati non viene consultato: il tipo di inserzionista è
  quello indicato da Subito, più la classificazione del testo.

## Procedura operativa (solo dopo approvazione esplicita)

Ogni passo si ferma al primo esito diverso da quello atteso. Non leggere, copiare o
riportare valori di secret o token.

### Passo 1 · Controllo iniziale della funzione dei token (sola lettura)
Supabase Dashboard → progetto NMRE → **SQL Editor** → **New query**. Incolla ed esegui
(**Run**): è una sola SELECT sul catalogo, senza scritture.

```sql
select p.provolatile as volatilita, p.prosecdef as security_definer, l.lanname as linguaggio,
       pg_get_userbyid(p.proowner) as proprietario, coalesce(p.proacl::text, '(predefiniti)') as permessi,
       coalesce(p.proconfig::text, '') as impostazioni, md5(p.prosrc) as impronta_corpo,
       p.prosrc ~* '\m(insert|update|delete|merge|truncate|call|copy|perform|execute|nextval|setval|set_config)\M' as contiene_scritture,
       btrim(regexp_replace(p.prosrc, '\s+', ' ', 'g')) ~* '^select\M' as inizia_con_select
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace join pg_language l on l.oid = p.prolang
 where n.nspname = 'public' and p.proname = 'nmre_get_gmail_tokens';
```

**Atteso:** una sola riga, con `volatilita = v`, `security_definer = true`,
`linguaggio = sql`, `contiene_scritture = false` e `inizia_con_select = true`.
**Annota** `proprietario`, `permessi`, `impostazioni` e `impronta_corpo`: serviranno al
passo 3.

### Passo 2 · Applicazione della sola migrazione (scrive solo la volatilità)
SQL Editor → **New query**. Incolla **l'intero contenuto** di
`supabase/migrations_pending/20261126200000_gmail_tokens_rpc_stable.sql`, preso dal ramo
della PR, ed esegui (**Run**). Non usare `supabase db push`: questo file non è in
`supabase/migrations/`.

- **Atteso:** l'avviso «public.nmre_get_gmail_tokens() ora è STABLE … corpo invariato»,
  oppure «è già STABLE: nessuna modifica».
- **In caso di errore** («nessuna modifica eseguita» o «Verifica finale non superata»):
  la transazione è annullata e nulla cambia. Fermarsi.
- La migrazione invia anche `notify pgrst, 'reload schema'`, perché PostgREST riconosca
  la nuova volatilità.

### Passo 3 · Verifica dopo la migrazione (sola lettura)
Rieseguire la query del passo 1.

**Atteso:** `volatilita = s`, mentre `security_definer`, `proprietario`, `permessi`,
`impostazioni` e `impronta_corpo` devono essere **identici** a quelli annotati.
Se una colonna è cambiata, eseguire il rollback
`supabase/rollback/20261126200000_gmail_tokens_rpc_stable.rollback.sql` e fermarsi.

### Passo 4 · Nome del secret `NMRE_ALLOWED_USER_ID` (sola lettura)
Dashboard → **Edge Functions** → **Secrets**: verificare che il nome compaia, senza
aprirne il valore. In alternativa, dalla riga di comando (mostra nomi e impronte, non i
valori):

```bash
supabase secrets list --project-ref <project-ref>
```

### Passo 5 · Distribuzione della sola funzione di prova
Dal ramo della PR, **senza** `--no-verify-jwt`, quindi con la verifica JWT della
piattaforma attiva. Distribuisce solo `nmre-subito-dry-run`: `nmre-gmail-scheduled` non
viene toccata.

```bash
git fetch origin claude/subito-dry-run && git checkout --detach origin/claude/subito-dry-run
```

```bash
supabase functions deploy nmre-subito-dry-run --project-ref <project-ref>
```

**Atteso** nella Dashboard → Edge Functions:
- `nmre-subito-dry-run` presente, con la verifica JWT **attiva**;
- `nmre-gmail-scheduled` ancora alla versione **69**.

### Passo 6 · Prova sull'email del 26/11/2026
Apri l'app NMRE con il tuo account. Apri gli strumenti per sviluppatori del browser,
scheda **Console**, e incolla il codice qui sotto. Il token della sessione resta nel tuo
browser e non viene stampato.

```js
const authKey = Object.keys(localStorage).find(k => /^sb-.*-auth-token$/.test(k));
const session = JSON.parse(localStorage.getItem(authKey));
const base = localStorage.getItem("nmre-supabase-url") || "https://hhircfmrtkgaybrougku.supabase.co";
const apikey = localStorage.getItem("nmre-supabase-publishable-key") || "sb_publishable_qc33hhZz6qfftoQzG-Vyiw_p2cNYsuO";
const res = await fetch(base.replace(/\/$/, "") + "/functions/v1/nmre-subito-dry-run", {
  method: "POST",
  headers: { Authorization: "Bearer " + session.access_token, apikey, "Content-Type": "application/json" },
  body: JSON.stringify({ subject: "Appartamenti a Ancona e provincia ha 3 nuovi annunci per te", received_on: "2026-11-26" })
});
const report = await res.json();
console.log("HTTP", res.status, "esito:", report.esito);
console.log(report.rapporto);
console.log("Scritture sul database:", report.garanzie?.scritture_database);
console.assert(report.garanzie?.scritture_database === 0, "ATTENZIONE: scritture_database diverso da 0");
report;
```

### Passo 7 · Verifica del risultato
**Attesi:**
- `garanzie.scritture_database = 0`;
- `garanzie.rpc_in_sola_lettura = ["nmre_get_gmail_tokens"]`;
- `garanzie.pagine_subito_lette` pari a 0 o 1;
- `garanzie.cursore_gmail = "non letto né modificato"`;
- `garanzie.chiamate_gmail` contiene solo `profile`, `messages` e `messages/<id>`.

**Come leggere l'esito:**

| Esito | Significato | Cosa fare |
|---|---|---|
| `novita_non_dimostrabile` o `novita_dimostrata` | Prova completata | Leggere `rapporto` e `annunci` |
| `email_non_individuata` | 0 o più email corrispondenti | `candidati_email` elenca le intestazioni; ripetere con `message_id` |
| `pagina_non_disponibile` | Subito ha bloccato la pagina o non ha risposto | Nessun aggiramento; riprovare più tardi |
| `token_non_leggibili_in_sola_lettura` | La funzione dei token non è (ancora) STABLE per PostgREST | Ricontrollare il passo 3; attendere un minuto per il ricaricamento dello schema |
| `confronto_non_riuscito` | Una lettura di Opportunità o Archivio non è riuscita | Nessuna proposta valida: riprovare |

### Passo 7-bis · Prova dell'intera ricerca (modalità `intera_ricerca`, senza scritture)
Richiede la funzione distribuita dal ramo della PR #80 (`ale/nmre-release-integration`), che contiene
questa modalità. Stessa Console del passo 6, con un solo campo in più nel corpo:

```js
const authKey = Object.keys(localStorage).find(k => /^sb-.*-auth-token$/.test(k));
const session = JSON.parse(localStorage.getItem(authKey));
const base = localStorage.getItem("nmre-supabase-url");
const apikey = localStorage.getItem("nmre-supabase-publishable-key");
const res = await fetch(base.replace(/\/$/, "") + "/functions/v1/nmre-subito-dry-run", {
  method: "POST",
  headers: { Authorization: "Bearer " + session.access_token, apikey, "Content-Type": "application/json" },
  body: JSON.stringify({ subject: "Appartamenti a Ancona e provincia ha 3 nuovi annunci per te", received_on: "2026-11-26", modalita: "intera_ricerca" })
});
const report = await res.json();
console.log("HTTP", res.status, "esito:", report.esito);
console.log(report.rapporto);
console.assert(report.garanzie?.scritture_database === 0, "ATTENZIONE: scritture_database diverso da 0");
report;
```

La funzione legge al massimo 10 pagine, con una pausa di 1,5 s tra l'una e l'altra.

**Attesi:**
- `garanzie.scritture_database = 0`;
- `garanzie.pagine_subito_lette` uguale a `lettura.pagine_lette` più le eventuali richieste non riuscite;
- `lettura.richieste` con l'esito HTTP di ogni pagina.

**Come leggere l'esito:**

| Esito | Significato |
|---|---|
| `ricerca_letta_completa` | Tutte le pagine dichiarate da Subito lette: **verifica riuscita** |
| `ricerca_letta_in_parte` | Lettura fermata. `lettura.motivo` dice perché: pagina successiva bloccata, numero di pagina non confermato o limite di pagine |
| `ricerca_non_disponibile` | La prima pagina è bloccata (per esempio HTTP 403). L'acquisizione automatica non può funzionare da Supabase |

Il rapporto indica anche:
- quante schede verrebbero create;
- quante sono già nelle Opportunità o nell'Archivio;
- la classificazione degli inserzionisti;
- le notifiche previste, singole o una riepilogativa.

### Passo 8 · Dopo la prova
Facoltativo: rimozione della funzione di prova.

```bash
supabase functions delete nmre-subito-dry-run --project-ref <project-ref>
```

La migrazione STABLE può restare. Il suo rollback è
`supabase/rollback/20261126200000_gmail_tokens_rpc_stable.rollback.sql`.

Dopo un'applicazione manuale dal SQL Editor, la versione potrebbe non risultare in
`supabase_migrations.schema_migrations`. Il riallineamento del repository (spostamento
del file in `supabase/migrations/`) va fatto in una PR separata, come per le protezioni
dei trigger (rapporto A1 §16).
