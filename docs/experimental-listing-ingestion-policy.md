# Sperimentazione acquisizione annunci automatica

## Scopo

Questo ramo è isolato dalla versione stabile e serve a valutare integrazioni automatiche per le nuove opportunità nelle province di Ancona e Macerata. Non deve essere unito a `main` né distribuito in produzione finché ogni fonte non è stata verificata e i test non sono superati.

## Regola di ammissione delle fonti

Un adapter automatico può essere implementato soltanto quando ricorre almeno una di queste condizioni:

1. API/feed ufficiale o integrazione documentata che consente l'uso previsto;
2. autorizzazione scritta del gestore del portale per l'accesso e l'estrazione automatica;
3. fonte di dati propria dell'utente o messa a disposizione con licenza che consente chiaramente l'elaborazione prevista.

La sola accessibilità pubblica di una pagina e il volume ridotto delle richieste non equivalgono a un'autorizzazione.

## Fonti già verificate

- **Subito.it — BLOCCATO per scraping automatico.** Le Condizioni Generali del Servizio vietano espressamente robot, spider, scraper e strumenti automatici per accedere al sito o estrarne dati. Inoltre vietano agli aggregatori/terzi non previamente autorizzati l'utilizzo dei contenuti. Fonte: https://info.subito.it/policies/condizioni-generali.htm
- **Idealista — BLOCCATO senza consenso scritto.** Le condizioni vietano accesso, controllo o copia di informazioni tramite robot, spider, scraper o altri mezzi automatici o manuali senza preventivo consenso scritto, e vietano lo scraping per attività commerciali/concorrenti senza consenso scritto. Fonte: https://www.idealista.it/assistenzautenti/articoli/condizioni-generali-del-servizio/
- **TrovaCasa — NON APPROVATO.** Le condizioni riservano l'uso del servizio e i contenuti; non è stata verificata un'autorizzazione per estrazione automatica commerciale. Non implementare finché non viene chiarito per iscritto.
- **Green-Acres — NON APPROVATO.** Le condizioni consultate non sono sufficienti a confermare il permesso di estrazione automatica e riutilizzo commerciale dei contenuti. Richiedere chiarimento/autorizzazione.
- **Casa.it e Wikicasa — NON VERIFICATI.** Non implementare adapter automatici finché non sono state esaminate le condizioni applicabili e/o ottenuta autorizzazione.

## Architettura prevista

- Adapter separati per fonte, con allowlist esplicita.
- Nessun login automatizzato, CAPTCHA solving, proxy rotanti, fingerprint spoofing, bypass di rate limit o protezioni anti-bot.
- Arresto immediato su 403, 429, CAPTCHA, challenge o indicazioni di blocco; nessun retry aggressivo.
- Limiti conservativi di frequenza e volume per le sole fonti autorizzate.
- Filtro territoriale AN/MC applicato prima del salvataggio.
- Deduplicazione tramite URL/ID canonico e tracciamento della fonte.
- Classificazione del venditore prudente: nessuna fonte o località incerta viene etichettata automaticamente come privato.
- Conservare solo i dati strettamente necessari e rispettare privacy, diritti sui contenuti e termini della fonte.

## Fallback

La versione sicura di riferimento resta il ramo da cui deriva questo esperimento: `integrate/subito-territory-mobile` (PR #99). Il ramo sperimentale non modifica né sostituisce quel fallback. Se una fonte non è autorizzata o si dimostra instabile, si mantiene l'acquisizione tramite email alert, integrazioni ufficiali e inserimento manuale.

## Stato

Esperimento iniziale: nessun crawler/worker automatico attivato e nessuna richiesta automatica inviata ai portali. Nessun secret, database o deploy di produzione modificato.
