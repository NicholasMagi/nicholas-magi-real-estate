# NMRE Mobile

App nativa iOS/Android del progetto Nicholas Magi Real Estate. È separata dalla PWA esistente e riutilizzerà il backend Supabase già operativo. Questa prima anteprima contiene struttura, navigazione e schermate visive: non legge ancora dati reali e non effettua scritture.

## Prima prova su iPhone o Android

Requisiti sul PC Windows:
- Node.js 22.13 o successivo.
- Git.
- Telefono e PC sulla stessa rete Wi-Fi per la modalità LAN.

Passaggi:
1. Clonare il repository e selezionare il branch `mobile-expo-foundation`.
2. Aprire il terminale nella cartella `mobile`.
3. Eseguire `npm install`.
4. Eseguire `npx expo start`.
5. Installare Expo Go compatibile con SDK 58 sul telefono.
6. Inquadrare il QR code mostrato nel terminale/browser. Su iPhone aprire il codice con la fotocamera e scegliere Expo Go; su Android usare lo scanner QR di Expo Go.

Se la rete impedisce il collegamento LAN, eseguire `npm run start:tunnel`.

Nessun account Supabase è necessario per questa prima anteprima. Le schermate dichiarano che il collegamento dati non è ancora attivo: non sono presenti annunci o contatti dimostrativi.

## Verifiche

```powershell
npm install
npm run typecheck
npm run lint
npm run check:expo
```

Il lockfile npm deve essere generato e committato dopo l'installazione in ambiente di sviluppo; non è stato generato durante la creazione remota dei file. Non avviare build di produzione in questa fase.

## Build EAS successiva

```powershell
npm install -g eas-cli
eas login
eas build:configure
eas build --platform ios --profile development
```

La build iOS richiede la configurazione delle credenziali di firma Apple/EAS. Non committare credenziali o certificati.

## Stato
- M0 audit: completato.
- M1 documentazione: completata.
- M2 scaffold Expo: avviato.
- Supabase Auth/dati reali: non collegati.
- Preferiti, native push e ALBim: non implementati.
