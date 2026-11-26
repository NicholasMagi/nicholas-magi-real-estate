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
| Nessuna scrittura su Supabase | Il database passa solo da `readOnlyDb()`: per `annunci_candidati` e `annunci` esistono soltanto `select()` e i filtri di lettura; `insert`, `update`, `upsert`, `delete` e qualsiasi altro metodo sollevano un errore. L'unica RPC ammessa (`nmre_get_gmail_tokens`) è inviata in GET, quindi PostgREST la esegue in una transazione READ ONLY | `readonly_test.ts`, `index_guard_test.ts`; nei test di `dry_run_test.ts` il contatore delle scritture del database simulato resta 0 e le tabelle restano identiche |
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

## Procedura (solo dopo approvazione esplicita)

1. **Distribuzione della sola funzione di prova.** Non tocca `nmre-gmail-scheduled`.
   Senza `--no-verify-jwt`.

   ```bash
   supabase functions deploy nmre-subito-dry-run --project-ref <project-ref>
   ```

   Usa i secret già presenti nel progetto (`NMRE_ALLOWED_USER_ID`,
   `INTEGRATION_TOKEN_ENCRYPTION_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`):
   nessun secret nuovo o modificato.
2. **Esecuzione dall'app NMRE.** Accedi con il tuo account, apri gli strumenti per
   sviluppatori del browser, scheda Console, e incolla il codice qui sotto. Il token
   della sessione resta nel tuo browser.

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
   console.log(report.rapporto);
   report;
   ```

3. **Lettura del rapporto.**
   - `rapporto` è il testo leggibile.
   - `annunci` contiene l'elenco completo.
   - `garanzie` riporta le chiamate effettivamente eseguite: `scritture_database: 0`,
     solo `select` e RPC in GET, una pagina letta, cursore non toccato.
   - Se più email corrispondono, il rapporto elenca le loro intestazioni: ripeti la
     prova aggiungendo `message_id`.
4. **Rimozione della funzione di prova dopo l'uso** (facoltativa):

   ```bash
   supabase functions delete nmre-subito-dry-run --project-ref <project-ref>
   ```
