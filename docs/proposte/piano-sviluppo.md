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
esse non sono rischi effettivi); archiviazione automatica SECURITY INVOKER con
permessi corretti per `authenticated` e `service_role` (resta da osservare un
caso end-to-end); `nmre-ai-assistant` v14 attiva e limitata al titolare; job
Gmail ogni minuto; 16 errori in 48 ore, di cui 15 in un unico episodio del 24/11
sulla versione 49, probabilmente superato dalle versioni 65–67 ma con causa non
accertata; protezione password compromesse disattivata; nessun bucket Storage.
Ancora da verificare: "Allow new users to sign up".

| # | Intervento | Dipendenze |
|---|---|---|
| P0.0 | Audit v2 in sola lettura (indicatori e categorie, nessun testo sensibile) + punti aperti O1–O8 | — |
| P0.1 | Import e versionamento di `nmre-ai-assistant` v14; allineamento codice distribuito ↔ repository per tutte le funzioni | P0.0 |
| P0.2 | Recupero password in app, rimozione della registrazione, verifica/disattivazione di "Allow new users to sign up", protezione password compromesse | P0.0 |
| P0.3 | Controllo del titolare (`requireOwner`) su `nmre-push-send`, `nmre-search-engine`, `nmre-candidate-enrich`; validazione degli URL | P0.2 |
| P0.4 | Gmail: monitor corretto (oggi i contatori 24h sono sottostimati), chiusura dell'analisi dell'episodio del 24/11 (O9), errori diagnostici con SQLSTATE, regola "migrazione prima della funzione", ritentativi, uscita anticipata, frequenza decisa in base a Gmail Push | P0.0 |
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

### A.0-bis Audit prioritario del motore di acquisizione

**Priorità:** massima per l'obiettivo commerciale. Precede A.1 e A.2: nessuna
regola di classificazione o di scarto verrà modificata prima di avere i risultati.
L'audit è interamente in **sola lettura**.

**Principio:** i numeri non dimostrano che gli elementi scartati o da verificare
siano privati. L'audit serve a stabilirlo con dati e campioni, non a presumerlo.

#### Risultati verificati il 25/11 (AQ2, AQ4, AQ9)
| Query | Esito |
|---|---|
| AQ2 | 104 scartati: 63 "Da verificare" manuali o storici non determinabili; 14 "Da verificare" con lo stesso URL di uno scarto precedente (D2 o D4); 11 "Da verificare" probabilmente scartati dalla sincronizzazione (D1); 16 "Agenzia" manuali (D3) |
| AQ4 | Nessun segnale esplicito di privato o proprietario negli 88 "Da verificare" scartati; un solo riferimento a forma societaria; due casi Casa.it con la parola "privato", non sufficienti per cambiare la classificazione |
| AQ9 | 508 notifiche, 508 "Da verificare", 0 privati, 0 agenzie escluse, 59 inserimenti, 449 aggiornamenti, 0 scarti e 0 archiviazioni automatiche |

**Analisi completa, punti di perdita, patch e procedura di recupero:**
`docs/proposte/A1-nessuna-opportunita-persa.md`.

#### Dati verificati in produzione (48 ore, prima serie)
| Indicatore | Valore |
|---|---|
| Annunci rilevati nelle sincronizzazioni riuscite | 671 |
| Da verificare | 508 (59 inserimenti + 449 aggiornamenti) |
| Privati riconosciuti automaticamente | **0** |
| Archiviazioni automatiche | **0** |

| Stato attuale dei candidati (tipo venditore / stato) | Numero |
|---|---|
| Da verificare / Scartato | 88 (di cui 42 creati nelle ultime 48 ore) · valore della rilevazione del 25/11/2026 (AQ1/AQ2), da rileggere: cambia nel tempo |
| Agenzia / Scartato | 16 |
| Da verificare / Confermato | 3 |
| Privato / Confermato (verifica manuale) | 1 |

#### Lettura dei contatori (cautele)
- I contatori di `nmre_gmail_sync_runs` sono **somme per esecuzione**, quindi
  **eventi** e non annunci distinti: un messaggio rielaborato (per esempio per
  l'aggiornamento della versione del parser) viene contato di nuovo.
- ~~Circa 163 notifiche escluse come agenzia~~: **stima non confermata**. AQ9
  (25/11) riporta 508 notifiche immobiliari, tutte "Da verificare", e **0 escluse
  come agenzia**. La stima è ritirata.
- ✅ Restano invece **non misurate** le email escluse dal filtro avvisi prima del
  salvataggio, che non lasciano traccia: vedi L1–L7 in
  `docs/proposte/A1-nessuna-opportunita-persa.md` e la query AQ10.
- ✅ Zero archiviazioni automatiche discendono **meccanicamente** da zero privati
  riconosciuti: l'archiviazione automatica parte solo per le righe `Privato`
  (`index.ts:858`). Non è un secondo problema indipendente.
- ✅ Il prevalere degli aggiornamenti (449) sugli inserimenti (59) è coerente con
  avvisi ripetuti sullo stesso annuncio (stessa `listing_key`) e con le
  rielaborazioni per versione (`index.ts:486-506`). ⚠️ Possibile anomalia da
  controllare: quando un candidato storico condivide la `listing_key` con un altro,
  il codice aggiorna solo `deduplication_version` del candidato storico
  (`index.ts:749-755`); se la sua `data_extraction_version` resta sotto 6, il
  filtro di rielaborazione (`index.ts:503-504`) lo ripropone a ogni ciclo. Va
  misurato (AQ6), non presunto.

#### Percorsi del codice che producono lo stato "Scartato" (verificati ✅)
| ID | Percorso | Dove | Cosa scrive | Conferma utente | Motivo registrato |
|---|---|---|---|---|---|
| D1 | Sincronizzazione: email rielaborata **non trattenuta** (non riconosciuta come avviso immobiliare, oppure classificata Agenzia, anche tramite registro venditori) | `nmre-gmail-scheduled/index.ts:540-562` | `stato = scartato`, azzera `notification_sender` ed `email_subject`; **non cambia `tipo_venditore`**; solo se `seller_manual_override = false` | No | No |
| D2 | Interfaccia, **automatico a ogni caricamento della coda** (ogni 60 s ad app aperta): ogni candidato `da_verificare` con lo stesso URL canonico di un candidato già scartato diventa scartato e viene nascosto | `index.html:5034-5069` | `stato = scartato` | No | No |
| D3 | Interfaccia: classificazione manuale "Agenzia" | `index.html:5233-5243` | `tipo_venditore = Agenzia`, override manuale, `stato = scartato` | Sì (azione) | Testo di evidenza |
| D4 | Interfaccia: "Scarta" manuale, esteso alle copie con lo stesso URL canonico | `index.html:5365-5383` | `stato = scartato` | Sì (`confirm`) | No |
| D5 | Operazioni storiche fuori dal codice attuale (es. email di benvenuto marcate come scartate, `docs/property-map-and-subito.md`) e versioni precedenti delle funzioni | — | — | — | No |

**Deduzioni dal codice (da confermare con i dati ⚠️)**
- *Agenzia / Scartato (16)*: nel codice attuale l'unico percorso che scrive
  `tipo_venditore = Agenzia` su un candidato è **D3 (manuale)**; la
  sincronizzazione non salva mai le righe di agenzia. Questi 16 sono quindi
  probabilmente classificazioni manuali, o eredità di versioni precedenti.
- *Da verificare / Scartato (88)*: possono derivare da **D1, D2 o D4**, non da D3.
  D1 si riconosce perché azzera mittente e oggetto; D2 e D4 non sono
  distinguibili dai dati, perché entrambi aggiornano solo stato e data.
- *I 42 creati nelle ultime 48 ore*: un candidato appena creato può diventare
  scartato automaticamente solo con D1 (stessa email rielaborata con esito
  diverso, per esempio dopo un aggiornamento del registro venditori) o con **D2**
  (nuovo avviso dello stesso annuncio già scartato, per esempio un ribasso di
  prezzo). D2 è rilevante per l'obiettivo commerciale: **un ribasso su un annuncio
  scartato in passato, anche per errore, viene nascosto senza avviso.**
- *Da verificare / Confermato (3)*: non è un'anomalia. La RPC di conferma non
  aggiorna `tipo_venditore` sul candidato (migrazione `20261123001500`), quindi il
  candidato conserva "Da verificare" anche se l'annuncio in archivio ha un altro
  tipo. Rende però fuorvianti le statistiche per tipo.

**Perché i privati riconosciuti sono zero: evidenza dal codice ✅**
Le regole reali del classificatore (`_shared/parser.ts:300-322`), eseguite su
frasi di prova, danno questi risultati:

| Frase di prova | Esito attuale |
|---|---|
| "Venditore: Privato", "Inserzionista privato", "Pubblicato da: privato" | Privato |
| "Trilocale in vendita da privati" (plurale) | Privato |
| "Privato vende trilocale" | Privato |
| "Annuncio **da privato**" (singolare) | **Da verificare** |
| "Privato" da solo, come etichetta | **Da verificare** |
| "Vendita diretta **dal** proprietario" | **Da verificare** |
| "Nessuna agenzia" | **Da verificare** |

Il classificatore è volutamente prudente e richiede formule esplicite. ⚠️ Resta
da dimostrare se le email reali dei portali contengano formule di questo tipo
oppure **nessuna** indicazione sul venditore: nel secondo caso lo zero è
strutturale (l'informazione non è nell'email) e servirà la pagina dell'annuncio,
la verifica manuale o un'API ufficiale. AQ4 misura questo aspetto senza
mostrare testi.

#### Le 5 domande dell'audit: metodo e risultato atteso
| # | Domanda | Metodo (sola lettura) | Risultato |
|---|---|---|---|
| 1 | Quali regole hanno prodotto ciascuno stato? | AQ1 (distribuzione per stato, tipo, override, versione, portale), AQ2 (percorso D1–D4 inferito per ogni scartato), AQ3 (evidenza del classificatore ricondotta alle etichette fisse del codice) | Tabella stato → regola/percorso, con quota "non attribuibile" |
| 2 | Perché tanti scartati? | AQ9 (`discarded_existing_count`: scarti D1 eseguiti dalla sincronizzazione nelle 48 ore) + AQ2 + AQ7 (tempo tra creazione e scarto: pochi minuti indica un percorso automatico) + AQ5 (duplicati per `listing_key` e URL) | Ripartizione degli 88 tra D1, D2/D4, D5 |
| 3 | Perché zero privati automatici? | AQ4: per stato e portale, **conteggi** di candidati il cui testo conservato contiene formule tipiche ("da privato", "privato" isolato, "proprietario", "senza agenzia", marchi di agenzia…); test del classificatore su frasi sintetiche in locale | Quota di "Da verificare" con segnali di privato non riconosciuti; elenco delle formule mancanti nelle regole |
| 4 | Ci sono privati tra i da verificare o scartati? | **Revisione manuale a campione** dal titolare: AQ8 estrae un campione casuale stratificato (solo identificativo, portale e URL pubblico dell'annuncio): 40 tra i "Da verificare / Scartato", tutti i 16 "Agenzia / Scartato", 40 tra i "Da verificare" in coda. Per ciascuno si annota l'esito reale (Privato, Agenzia, Non più online, Non determinabile) su un foglio personale, non nel repository | Stima con intervallo di confidenza della quota di privati per gruppo; casi reali da trasformare in test del classificatore |
| 5 | Notifiche e URL originali sono stati conservati? | AQ5: per stato, presenza di `url`, `url_originale`, `listing_key`, testo sorgente e numero di righe in `annunci_candidati_notifiche` | Tabella di conservazione per stato; elenco delle lacune |

**Conservazione: cosa si sa già dal codice ✅**
- Le email escluse alla prima lettura (agenzia o non pertinenti) **non lasciano
  traccia nel database**. Restano però nella casella Gmail: l'accesso OAuth è in
  sola lettura (`gmail.readonly`, `nmre-gmail-oauth-start/index.ts`), quindi NMRE
  non può cancellarle né modificarle. Il riesame è possibile da Gmail.
- Il percorso D1 azzera mittente e oggetto nelle colonne del candidato, ma li
  lascia in `dati_fonte` (incoerenza da risolvere con la decisione P0.6).
- Per i candidati salvati, l'URL originale (`url_originale`) e lo storico delle
  notifiche sono conservati anche quando lo stato è "scartato": D1–D4 cambiano
  solo lo stato.

**Verifica delle esclusioni senza traccia (circa 163 in 48 ore)**
1. *Subito, senza codice*: ricerca in Gmail degli avvisi dei portali delle ultime
   48 ore e confronto a campione (20 email) con i candidati presenti; per ciascuna
   email assente si annota l'esito reale dell'annuncio.
2. *Dopo approvazione (modifica di codice)*: modalità di **sola misurazione**
   nella sincronizzazione, che per ogni esclusione registra soltanto il **nome
   della regola** e il portale (nessun testo), così da sapere quale regola
   esclude cosa. È il primo passo di A.1.

**Esito dell'audit e decisione**
Rapporto con: matrice stato → regola, stima dei privati persi per gruppo, regole
da correggere in ordine di impatto, lacune di conservazione. Solo dopo il
rapporto si approvano A.1 (nessuna perdita automatica) e A.2 (classificazione).

Query: sezione "Audit acquisizione" (AQ1–AQ9) in
`supabase/audit/p0_verifica_produzione_sola_lettura.sql`. AQ8 restituisce URL
pubblici di annunci e identificativi interni: è pensata per l'uso personale del
titolare durante la revisione e **non va condivisa** in chat o su GitHub. Le altre
restituiscono solo conteggi e indicatori.

### A.1 Nessuna perdita automatica (priorità più alta del modulo)

**Stato (26/11/2026, riferito dal titolare):** Fase 1: le due migrazioni dei trigger di
notifica sono applicate in produzione e la funzione `nmre-gmail-scheduled` è attiva
nella versione 68; il frontend non è ancora distribuito. Fase 2 (avvisi dubbi):
preparata, **non applicata**. Le versioni registrate delle migrazioni non coincidono
con i file (rapporto A1 §16). Dettaglio: `docs/proposte/A1-nessuna-opportunita-persa.md` (§3 patch,
§8 recupero degli scartati: 88 alla rilevazione AQ2 del 25/11/2026, conteggio da rileggere prima del recupero; §9 priorità). I punti che seguono restano
l'obiettivo complessivo; quelli coperti dalla Fase 1 sono indicati nel rapporto.

- Le email classificate "Agenzia" vengono **salvate** con stato `agenzia_esclusa`, visibili in un filtro dedicato e recuperabili con un clic.
- Le email scartate come "non pertinenti" restano registrate con il motivo (`motivo_scarto`) e senza testo personale; nessun candidato già in coda passa a `scartato` senza una ragione registrata.
- Ogni percorso di scarto (D1–D4 dell'audit) registra **chi o cosa** ha scartato (`scartato_da`: sincronizzazione, regola, utente) e **quando**.
- Lo scarto automatico in interfaccia per URL già scartato (D2) diventa una **proposta**: l'annuncio resta visibile con il contrassegno "già scartato in passato" e, se il prezzo è sceso, viene evidenziato invece che nascosto.
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
| 1 | **A.0-bis** Audit del motore di acquisizione (sola lettura) | Priorità commerciale: capire se e dove si perdono privati. Non richiede modifiche e può partire subito, in parallelo con P0 |
| 1-bis | P0.0 → P0.8 | Sicurezza e affidabilità prima di aggiungere funzioni |
| 2 | **A.1** Nessuna perdita automatica | Massimo impatto sul numero di privati individuati; regole decise in base all'audit |
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
