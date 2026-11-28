# NMRE · Esperimento acquisizione pubblica

Questo ramo contiene un laboratorio separato dalla sincronizzazione stabile. Non attivarlo sul progetto Supabase di produzione.

## Stato iniziale: spento e in sola lettura

La funzione \`nmre-ingestion-lab\` richiede tutte queste condizioni:
- JWT utente valido e identità uguale a \`NMRE_ALLOWED_USER_ID\`;
- \`NMRE_PUBLIC_INGESTION_LAB_ENABLED=true\`;
- host esatto presente in \`NMRE_INGESTION_ALLOWED_HOSTS\`;
- richiesta POST manuale con un solo URL HTTPS.

L'allowlist degli host è vuota se non configurata. Non aggiungere un portale prima di aver verificato condizioni d'uso, policy di accesso automatizzato e indicazioni pubblicate dal portale.

## Limiti tecnici deliberati

- Una sola pagina per chiamata; nessuna scansione pianificata o paginazione.
- Nessun cookie, login, header di identità simulata, proxy rotante o bypass di CAPTCHA/anti-bot.
- Redirect non seguiti; timeout 10 secondi; massimo 1,5 MB di HTML.
- Estrae solo JSON-LD pubblico e produce anteprime; non scrive nel database e non importa opportunità.
- Il venditore resta sempre "Da verificare"; non deduce che sia un privato.
- Errori HTTP, redirect e blocchi vengono registrati come esito; nessun retry automatico.

## Filtro territoriale

Il limite richiesto è 45 minuti in automobile da Castelfidardo. La funzione legge \`NMRE_INGESTION_45MIN_MUNICIPALITIES\`, elenco separato da virgole di comuni il cui tempo di percorrenza è stato verificato. Se l'elenco è assente, \`within_45_min\` resta \`null\`: non viene inventato un raggio stradale partendo dai confini provinciali.

L'elenco va compilato dopo aver verificato i tempi reali di percorrenza; non impostarlo con l'intera provincia di Ancona o Macerata.

## Variabili previste (solo progetto Supabase di test)

- \`NMRE_PUBLIC_INGESTION_LAB_ENABLED\`
- \`NMRE_INGESTION_ALLOWED_HOSTS\`
- \`NMRE_INGESTION_45MIN_MUNICIPALITIES\`
- \`NMRE_ALLOWED_USER_ID\` (utente di test autorizzato)

Non configurare queste variabili nel progetto di produzione durante la fase sperimentale.
