# Piano di sviluppo NMRE · versione aggiornata

Stato: **piano da approvare**. Nessuna funzionalità dei moduli A e B è stata
implementata. Ogni intervento verrà sviluppato su branch separato, verificato e
integrato solo dopo la Sua approvazione.

**Obiettivo commerciale guida:** individuare il maggior numero possibile di
annunci di privati, gestire ogni potenziale incarico e accompagnare il contatto
fino all'acquisizione.

**Metriche di successo proposte** (da misurare prima e dopo ogni fase):
- privati individuati a settimana, per fonte e per comune;
- tempo tra la pubblicazione dell'avviso e la comparsa in NMRE;
- quota di casi "da verificare" risolti entro 24 ore;
- annunci persi (scartati per errore) individuati nei controlli a campione;
- tempo dal primo avviso al primo contatto;
- conversione: contattato → appuntamento → valutazione → incarico.

---

## Fase 0 · P0 Sicurezza, schema e affidabilità

Dettaglio: `docs/proposte/P0-sicurezza-e-affidabilita.md`.

| # | Intervento | Dipendenze |
|---|---|---|
| P0.0 | Audit di produzione in sola lettura (`supabase/audit/p0_verifica_produzione_sola_lettura.sql` + controlli Dashboard) | — |
| P0.1 | Recupero password in app, rimozione della registrazione, registrazioni disattivate in Supabase | P0.0 |
| P0.2 | Controllo del titolare (`requireOwner`) su tutte le Edge Functions; validazione degli URL | P0.1 |
| P0.3 | Schema di produzione e `nmre-ai-assistant` nel repository; scansione segreti nel CI | P0.0 |
| P0.4 | Frequenza Gmail verificata e allineata (Push + cron di sicurezza) | P0.0 |
| P0.5 | Risoluzione sicura dei link di tracciamento | — |
| P0.6 | Decisione sul contenuto email conservato e caricamento leggero della coda | Sua decisione |
| P0.7 | CSP, dipendenze con versione fissata, MFA facoltativa | P0.1 |

---

## Fase 1 · P1 Velocità e basi tecniche (prerequisito per A e B)

| # | Intervento |
|---|---|
| P1.1 | Caricamenti iniziali in parallelo; liste con le sole colonne necessarie; dettagli caricati all'apertura |
| P1.2 | Aggiornamento della coda con Supabase Realtime (o polling differenziale per `updated_at`) al posto del ricaricamento completo ogni 60 s |
| P1.3 | Sincronizzazione Gmail con operazioni in blocco e concorrenza limitata |
| P1.4 | Collegamenti contatto ↔ annuncio proposti e confermati dall'utente, non scritti in automatico (`index.html:3613`) |
| P1.5 | Suddivisione di `index.html` in moduli con build leggera; routing nell'indirizzo e tasto Indietro |
| P1.6 | CI su tutte le funzioni e test end-to-end Playwright sui flussi principali |

---

## Modulo A · Motore di acquisizione

### A.0 Situazione attuale (verificata nel codice)
- Fonte principale: avvisi email di 8 portali tramite Gmail (Idealista, Immobiliare.it, Casa.it, Subito, Green-Acres, Gate-away, Trovacasa, Wikicasa).
- Connettore Immobiliare.it Insights predisposto ma bloccato finché non arriva l'autorizzazione scritta all'uso per acquisizione.
- Classificazione a regole: Privato / Agenzia / Da verificare, con registro dei venditori verificati.
- Deduplicazione per ID Gmail e chiave canonica dell'annuncio; storico notifiche e ribassi di prezzo.
- **Punti che fanno perdere opportunità:**
  - le email classificate "Agenzia" non vengono salvate affatto (`nmre-gmail-scheduled/index.ts:538`): un errore del classificatore elimina l'annuncio senza traccia;
  - le email che il riconoscimento non considera avvisi immobiliari portano a `scartato` anche i candidati già in coda, se non verificati manualmente (`index.ts:540-562`);
  - la deduplicazione funziona solo con URL di scheda riconoscibili: lo stesso immobile pubblicato su due portali resta doppio;
  - le esclusioni sono basate su parole chiave (es. "tribunale", "asta") e non sono rivedibili dall'interfaccia.

### A.1 Nessuna perdita automatica (priorità più alta del modulo)
- Le email classificate "Agenzia" vengono **salvate** con stato `agenzia_esclusa`, visibili in un filtro dedicato e recuperabili con un clic.
- Le email scartate come "non pertinenti" restano registrate con il motivo (`motivo_scarto`) e senza testo personale; nessun candidato già in coda passa a `scartato` senza una ragione registrata.
- Revisione a campione settimanale: NMRE propone 10 esclusioni casuali da confermare; gli errori diventano casi di test del classificatore.
- Ogni regola di esclusione ha un nome, un contatore e può essere disattivata.

### A.2 Classificazione Privato / Agenzia / Incerto
- Punteggio composto: segnali del testo (regole attuali), registro venditori, ricorrenza dello stesso inserzionista su più annunci (molti annunci = probabile agenzia), presenza di marchi immobiliari, formato del recapito.
- Tre esiti con soglie configurabili; "Incerto" non viene mai scartato.
- Ogni correzione manuale aggiorna il registro venditori e viene usata come esempio di verifica per le nuove versioni del parser.
- Versionamento delle regole e rielaborazione controllata dei candidati in coda (già presente come meccanismo, da estendere).

### A.3 Ampliamento progressivo delle fonti
Ordine proposto, solo con canali autorizzati:
1. **Copertura degli avvisi esistenti**: elenco guidato delle ricerche salvate per portale × comune × tipologia, con indicatore "comune coperto / non coperto" (le ricerche si creano sul portale, NMRE verifica che gli avvisi arrivino).
2. Altri portali che inviano avvisi email riconoscibili (da valutare caso per caso, con le loro condizioni d'uso).
3. API ufficiali: Immobiliare.it Insights (dopo autorizzazione scritta), Idealista Search API (dopo rilascio della chiave e della documentazione).
4. Inserimento rapido manuale da link o da telefono (condivisione dal browser del telefono verso NMRE).
5. Segnalazioni da rete personale (passaparola, cartelli "vendesi"): scheda veloce con foto e posizione.

Esclusi per scelta: scraping, aggiramento di login o CAPTCHA, contatti automatici agli inserzionisti.

### A.4 Deduplicazione e identità dell'immobile
- Chiave canonica per portale (già presente) + **impronta dell'immobile**: comune, tipologia, superficie (±5%), locali, fascia di prezzo, indirizzo se disponibile.
- I possibili doppioni tra portali vengono **proposti** per l'unione, mai uniti in automatico; l'unione conserva tutte le fonti e gli URL.
- Una scheda "Opportunità" unica raccoglie tutti gli avvisi e i portali in cui compare lo stesso immobile.

### A.5 Monitoraggio prezzi e storico
- Storico prezzi per opportunità (non solo per notifica), con grafico e calo cumulato dalla prima pubblicazione.
- Segnali commerciali: ribasso recente, permanenza lunga sul mercato, ripubblicazione dopo un periodo di assenza, passaggio da privato ad agenzia.
- Notifica push sui ribassi degli annunci privati non ancora contattati.

### A.6 Coda di lavoro e priorità
- Una sola coda "Da lavorare oggi" ordinata per priorità commerciale (privato certo, freschezza, ribasso, zona di interesse, completezza dei dati).
- Azioni rapide: "Privato, archivia e chiama", "Agenzia", "Incerto, ricontrolla", "Non pertinente".
- Monitor di copertura: fonti attive, ultima email ricevuta per fonte, comuni senza avvisi.

### A.7 Dati e schema (indicativo, da progettare in dettaglio)
- `opportunita` (immobile unico) ↔ `annunci_candidati` / `annunci` (fonti) ↔ `annunci_candidati_notifiche` (eventi).
- `motivo_scarto`, `stato` esteso (`agenzia_esclusa`, `non_pertinente`, `incerto`).
- Tabella regole di esclusione con contatori.

---

## Modulo B · CRM commerciale

### B.0 Situazione attuale (verificata nel codice)
- Esistono: contatti (`nmre_contacts`), immobili (`nmre_properties`), collegamenti immobile-contatto (`nmre_property_contacts`), appuntamenti (`nmre_appointments`), interazioni con esito strutturato (`nmre_contact_interactions`, `annunci_interazioni`), campi di qualificazione sugli annunci (motivazione, tempistiche, altre agenzie, prezzo trattabile), obiettivi commerciali, Centro telefonate, messaggio WhatsApp precompilato.
- **Limite principale: il percorso commerciale è frammentato in tre stati diversi**:
  - `annunci.stato_contatto`;
  - lo stato del contatto in `nmre_contacts` (da contattare, contattato, interessato, cliente…);
  - lo stato dell'immobile in `nmre_properties` (incarico, in vendita, proposta, venduto…).

  Manca una pipeline unica dall'annuncio all'incarico.
- Obiezioni ed esigenze sono in parte testo libero; i richiami esistono, ma l'invio automatico dei promemoria lato server è da verificare (🔎).

### B.1 Pipeline unica fino all'incarico
Fasi proposte (configurabili):
`Nuovo` → `Da contattare` → `Contattato` → `Interessato` → `Appuntamento fissato` → `Valutazione fatta` → `Proposta di incarico` → `Incarico acquisito` / `Perso (motivo)`.

- Un'unica entità "Trattativa di acquisizione" collega opportunità, proprietario/i e immobile.
- Passaggi di fase registrati con data e autore: storico completo e tempi per fase.
- Motivi di perdita strutturati (già con agenzia, prezzo irrealistico, non vende più, non raggiungibile…).
- Vista Kanban e vista elenco con filtri.

### B.2 Proprietari e immobili
- Scheda proprietario unica: recapiti, più immobili, ruoli (proprietario, comproprietario, referente), consenso al trattamento dei dati e base giuridica.
- Scheda immobile: dati tecnici, posizione, documenti, foto, collegamento alle fonti dell'annuncio e alla valutazione OMI.
- Rilevamento di contatti doppi (stesso telefono o email) con unione proposta.

### B.3 Telefonate e conversazioni
- Registro rapido dopo ogni chiamata: esito, durata, sintesi, prossimo passo, data del richiamo, **in meno di 15 secondi** dal telefono.
- Storico unificato per proprietario (telefonate, WhatsApp, email, incontri, note) in ordine cronologico.
- Script di chiamata e risposte alle obiezioni contestuali alla fase.

### B.4 Note, obiezioni, esigenze e motivazioni
- Campi strutturati: motivazione alla vendita, tempistiche, prezzo atteso vs. valutazione, presenza di altre agenzie, obiezioni (elenco con frequenza), esigenze (acquisto successivo, urgenza, vincoli familiari).
- Punteggio di "maturità dell'incarico" calcolato da questi campi, spiegato e non presentato come probabilità.

### B.5 Promemoria e richiami automatici
- Ogni esito che lo richiede propone automaticamente il prossimo richiamo (es. "Nessuna risposta" → richiamo tra 1 giorno, poi 3, poi 7).
- Promemoria push generati **lato server** (job pianificato), rispettando fascia di silenzio e preferenze già esistenti.
- Elenco "richiami scaduti" sempre in cima alla Panoramica.

### B.6 Agenda e appuntamenti
- Agenda giorno/settimana con visite, valutazioni e firme.
- Esportazione o sincronizzazione con Google Calendar (da valutare: richiederebbe un nuovo permesso OAuth, quindi decisione separata).
- Promemoria prima dell'appuntamento e richiesta dell'esito dopo.

### B.7 Monitoraggio fino all'acquisizione
- Cruscotto conversioni per fase, per fonte e per comune; tempo medio per fase; motivi di perdita.
- Confronto con gli obiettivi commerciali già presenti (`nmre_sales_goals`).

### B.8 Assistente (NMRE Intelligence / "NOVA")
- Da definire con Lei: nome, ruolo e limiti. Proposta: assistente in sola lettura che prepara la giornata (chi chiamare e perché), riassume lo storico prima di una telefonata e suggerisce le risposte alle obiezioni; nessuna azione automatica senza conferma.
- Prerequisito: esportazione e revisione della funzione `nmre-ai-assistant` (P0.3).

---

## Ordine complessivo proposto

| Ordine | Blocco | Motivo |
|---|---|---|
| 1 | P0.0 → P0.7 | Sicurezza e affidabilità prima di aggiungere funzioni |
| 2 | **A.1** Nessuna perdita automatica | Massimo impatto sul numero di privati individuati, basso sforzo |
| 3 | P1.1–P1.4 | Velocità percepita e dati coerenti |
| 4 | **B.1** Pipeline unica + **B.3** registro rapido delle chiamate | Cuore del lavoro quotidiano |
| 5 | **A.2** Classificazione migliorata + **A.6** coda unica | Meno tempo per opportunità |
| 6 | **B.5** Richiami automatici lato server + **B.6** agenda | Nessun contatto dimenticato |
| 7 | **A.4** Deduplicazione tra portali + **A.5** storico prezzi per opportunità | Qualità dei dati |
| 8 | **A.3** Nuove fonti (copertura avvisi → API ufficiali) | Crescita del volume |
| 9 | **B.2**, **B.4**, **B.7**, **B.8** | Completamento CRM e analisi |
| 10 | P1.5–P1.6 | Manutenibilità a lungo termine (può procedere in parallelo) |

Ogni blocco verrà presentato con: file coinvolti, modifiche allo schema (sempre
additive, senza cancellazioni), rischi, test e piano di ritorno indietro, prima
di qualsiasi implementazione.
