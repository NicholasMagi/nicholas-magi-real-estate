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

Dettaglio: `docs/proposte/P0-sicurezza-e-affidabilita.md` (versione 2, con gli
esiti delle verifiche di produzione del 25/11/2026).

Esiti già verificati in produzione: RLS attiva su tutte le tabelle `public`;
tabelle `private` inaccessibili ai ruoli client (gli avvisi degli advisor su di
esse non sono rischi effettivi); archiviazione automatica SECURITY INVOKER;
`nmre-ai-assistant` v14 attiva e limitata al titolare; job Gmail ogni minuto con
16 errori su circa 2.223 sincronizzazioni in 48 ore; protezione password
compromesse disattivata; nessun bucket Storage. Ancora da verificare:
"Allow new users to sign up".

| # | Intervento | Dipendenze |
|---|---|---|
| P0.0 | Audit v2 in sola lettura (indicatori e categorie, nessun testo sensibile) + punti aperti O1–O8 | — |
| P0.1 | Import e versionamento di `nmre-ai-assistant` v14; allineamento codice distribuito ↔ repository per tutte le funzioni | P0.0 |
| P0.2 | Recupero password in app, rimozione della registrazione, verifica/disattivazione di "Allow new users to sign up", protezione password compromesse | P0.0 |
| P0.3 | Controllo del titolare (`requireOwner`) su `nmre-push-send`, `nmre-search-engine`, `nmre-candidate-enrich`; validazione degli URL | P0.2 |
| P0.4 | Gmail: monitor corretto (oggi i contatori 24h sono sottostimati), analisi dei 16 errori, ritentativi, uscita anticipata, frequenza decisa in base a Gmail Push | P0.0 |
| P0.5 | Risoluzione sicura dei link di tracciamento | — |
| P0.6 | Decisione sul contenuto email conservato e caricamento leggero della coda | Sua decisione |
| P0.7 | Schema di produzione nel repository (solo schema) e scansione segreti nel CI | P0.0 |
| P0.8 | CSP, dipendenze con versione fissata, MFA facoltativa | P0.2 |

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
- Prerequisito: import e revisione della funzione `nmre-ai-assistant` v14 (P0.1).
- I documenti del modulo B.9 sono **esclusi** per impostazione predefinita dal contesto inviato all'assistente.

### B.9 Documentazione immobiliare

**Obiettivo:** sapere in ogni momento, per ogni immobile, quali documenti
servono, quali sono arrivati e quali mancano, così da arrivare
all'appuntamento e alla proposta di incarico con la pratica in ordine.

Situazione attuale: 🟢 Supabase Storage non ha bucket; ✅ nel codice non esiste
alcuna gestione documentale. Il modulo parte da zero.

#### B.9.1 Checklist documentale personalizzabile
- Ogni immobile ha la propria checklist, generata da un **modello** e poi modificabile (aggiungere, togliere, rinominare, cambiare livello).
- Ogni voce ha un **livello**:
  - **Necessario**: senza di esso la pratica non procede;
  - **Consigliato**: utile per valutazione e trattativa;
  - **Dipende dal caso**: attivato da condizioni dell'immobile o del proprietario (es. eredità, mutuo in corso, condominio, terreno, società proprietaria).
- Le voci "Dipende dal caso" si attivano rispondendo a poche domande nella scheda (C'è un mutuo? È un'eredità? È in condominio?…), con la possibilità di forzarle a mano.
- **Stati** di ogni voce: `da_richiedere` → `ricevuto` → `da_verificare` → `verificato`, oppure `non_necessario` (con motivo obbligatorio).
- Per ogni voce: a chi è stato richiesto (contatto collegato), data di richiesta, scadenza attesa, note, data di verifica, data di scadenza del documento (es. validità dell'attestato energetico).
- Indicatore di completezza nella scheda immobile: "Necessari verificati 6/9 · Consigliati 2/5".

**Modello iniziale proposto** (vendita residenziale; da validare con il Suo notaio o tecnico di fiducia, non costituisce consulenza legale):

| Livello | Documenti |
|---|---|
| Necessario | Documento d'identità e codice fiscale dei proprietari · Atto di provenienza · Visura catastale aggiornata · Planimetria catastale · Attestato di prestazione energetica (APE) |
| Consigliato | Titoli edilizi e verifica di conformità urbanistica · Certificato o segnalazione di agibilità · Dichiarazioni di conformità degli impianti · Ultime spese condominiali, regolamento e verbali recenti · Fotografie e planimetria quotata |
| Dipende dal caso | Dichiarazione di successione e accettazione dell'eredità (eredità) · Contratto di mutuo e conteggio estintivo (mutuo in corso) · Certificato di destinazione urbanistica (terreni) · Procura (vendita tramite procuratore) · Documenti societari (proprietario società) · Provvedimenti di separazione/divorzio (se incidono sulla proprietà) · Contratto di locazione in essere (immobile locato) |

#### B.9.2 Caricamento e archivio privato
- Caricamento diretto di **PDF, immagini e scansioni** dalla scheda immobile, anche dal telefono (fotocamera o file).
- Tipi ammessi: `application/pdf`, `image/jpeg`, `image/png`, `image/heic`, `image/webp`, `image/tiff`; dimensione massima proposta 25 MB per file (configurabile sul bucket).
- **Bucket Supabase Storage privato** `nmre-documenti` (`public = false`), da creare solo con approvazione.
- Percorso dei file senza dati personali: `{owner_id}/{property_id}/{voce_id}/{versione}-{uuid}.{estensione}`. Il nome originale del file è salvato solo nei metadati.
- Caricamento con la sessione del titolare (le policy Storage si applicano), con ripresa per i file grandi.

#### B.9.3 Metadati e versioni
- Per ogni file: nome originale, tipo, dimensione, impronta SHA-256 (rileva i doppioni), data e ora di caricamento, autore, note, numero di versione, versione corrente sì/no.
- Un nuovo caricamento sulla stessa voce crea una **nuova versione**; le precedenti restano consultabili.
- Eliminazione **logica** (`deleted_at`): il file resta in Storage finché non viene deciso diversamente, in coerenza con la regola di non cancellare dati.

#### B.9.4 Visualizzazione e download sicuri
- Anteprima e download tramite **URL firmati temporanei** (`createSignedUrl`, scadenza proposta 2 minuti), generati al clic e mai salvati nel database o nei log.
- Nessun URL pubblico, nessuna condivisione esterna in questa fase; un'eventuale condivisione con notaio o tecnico sarà una funzione separata, con scadenza e revoca.

#### B.9.5 Collegamento alla scheda immobile
- Nuova scheda **Documenti** dentro "Immobili e incarichi", con checklist, file e storico.
- Integrazione con la pipeline (B.1): prima di passare a "Proposta di incarico" NMRE mostra i documenti necessari mancanti (avviso, non blocco).
- Collegamento con i contatti (B.2): ogni richiesta di documento indica a quale proprietario è stata fatta.

#### B.9.6 Sicurezza: RLS e Storage
- Tabelle con `owner_id` e chiavi esterne composte `(owner_id, property_id)`, come in `nmre_property_contacts`: un documento non può essere collegato a un immobile di un altro utente.
- RLS su tutte le nuove tabelle: select/insert/update/delete solo con `auth.uid() = owner_id`; nessun privilegio ad `anon`.
- Policy su `storage.objects` per il solo bucket `nmre-documenti`: lettura, inserimento, aggiornamento ed eliminazione consentiti solo se `(storage.foldername(name))[1] = auth.uid()::text`; nessuna policy per `anon`.
- Se verrà approvata la difesa in profondità (A11 della proposta P0), le stesse policy richiederanno anche che l'utente sia nell'elenco degli autorizzati.
- I documenti contengono dati personali (documenti d'identità): esclusi dall'assistente AI, dalle esportazioni CSV/Excel e dalle notifiche push (che riportano solo "Documento mancante: APE · Via …").
- Politica di conservazione da decidere con Lei (per esempio: conservazione fino a X anni dalla chiusura della pratica), con elenco dei documenti in scadenza di conservazione; nessuna cancellazione automatica.

#### B.9.7 Promemoria
- Job giornaliero lato server che genera notifiche (nuova categoria "Documentazione" nelle preferenze esistenti, con fascia di silenzio):
  - voci `da_richiedere` oltre la scadenza attesa;
  - voci `ricevuto` / `da_verificare` non verificate dopo N giorni;
  - documenti in scadenza entro 30 giorni (es. APE) o da aggiornare (es. visura più vecchia di 6 mesi, soglia configurabile);
  - appuntamento entro 48 ore con documenti necessari mancanti.
- Riepilogo nella Panoramica: "Documenti mancanti per gli appuntamenti di questa settimana".

#### B.9.8 Dati (indicativo, solo migrazioni additive)
| Tabella | Contenuto |
|---|---|
| `nmre_document_types` | Catalogo dei tipi: codice, nome, livello predefinito, condizione di attivazione, validità in mesi; voci di sistema + voci personalizzate del titolare |
| `nmre_document_templates` / `_items` | Modelli di checklist (es. "Vendita residenziale", "Terreno") |
| `nmre_property_document_items` | Voce di checklist per immobile: tipo o nome libero, livello, stato, contatto, date, note, motivo di "non necessario" |
| `nmre_property_document_files` | Versioni dei file: percorso Storage, metadati, impronta, versione, corrente, `deleted_at` |
| `nmre_property_document_events` | Storico dei cambi di stato (chi, quando, da → a) |

#### B.9.9 Test necessari
- RLS: con un secondo utente di prova, nessuna lettura, scrittura o elenco di voci e file del titolare; `anon` respinto.
- Storage: il secondo utente non può caricare nella cartella del titolare, né scaricare o elencarne i file; un URL firmato scaduto viene rifiutato; percorsi con `..` o cartelle di altri utenti rifiutati.
- Tipi e dimensioni: file oltre il limite o di tipo non ammesso rifiutati dal bucket.
- Versioni: due caricamenti sulla stessa voce producono versione 1 e 2, con una sola corrente.
- Promemoria: dati di prova con scadenze passate generano una sola notifica per voce e rispettano la fascia di silenzio.
- Interfaccia (Playwright): caricamento da telefono emulato, anteprima PDF e immagine, avanzamento degli stati, indicatore di completezza.

#### B.9.10 Dipendenze e rilascio
- Prerequisiti: P0.2–P0.3 (accesso limitato al titolare), scheda immobile del CRM (B.2).
- Rilascio in due fasi: (1) checklist, stati, caricamento, versioni e URL firmati; (2) promemoria, modelli multipli, integrazione con pipeline e appuntamenti.
- Creazione del bucket, delle policy Storage e delle tabelle **solo dopo approvazione**, prima su un progetto di prova o in locale (`supabase start`).

---

## Ordine complessivo proposto

| Ordine | Blocco | Motivo |
|---|---|---|
| 1 | P0.0 → P0.8 | Sicurezza e affidabilità prima di aggiungere funzioni |
| 2 | **A.1** Nessuna perdita automatica | Massimo impatto sul numero di privati individuati, basso sforzo |
| 3 | P1.1–P1.4 | Velocità percepita e dati coerenti |
| 4 | **B.1** Pipeline unica + **B.3** registro rapido delle chiamate | Cuore del lavoro quotidiano |
| 5 | **A.2** Classificazione migliorata + **A.6** coda unica | Meno tempo per opportunità |
| 6 | **B.5** Richiami automatici lato server + **B.6** agenda | Nessun contatto dimenticato |
| 7 | **B.2** Schede proprietario/immobile + **B.9** Documentazione immobiliare (fase 1) | Pratica in ordine prima dell'incarico; B.9 richiede la scheda immobile di B.2 |
| 8 | **A.4** Deduplicazione tra portali + **A.5** storico prezzi per opportunità | Qualità dei dati |
| 9 | **A.3** Nuove fonti (copertura avvisi → API ufficiali) | Crescita del volume |
| 10 | **B.9** fase 2 (promemoria, modelli, integrazione pipeline), **B.4**, **B.7**, **B.8** | Completamento CRM e analisi |
| 11 | P1.5–P1.6 | Manutenibilità a lungo termine (può procedere in parallelo) |

Ogni blocco verrà presentato con: file coinvolti, modifiche allo schema (sempre
additive, senza cancellazioni), rischi, test e piano di ritorno indietro, prima
di qualsiasi implementazione.
