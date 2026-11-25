import {
  appendStatusHistory, isRepairEligible, keepAgencyCandidates, preserveStatusHistory,
  processedVersionMark, sellerFieldsForExisting, shouldReopenDiscarded, STATUS_HISTORY_LIMIT,
  DISCARDED_NOTIFICATION_LIMIT, isNewNotificationAfterDiscard, recordNotificationAfterDiscard
} from "./_shared/retention.ts";

function assertEquals<T>(actual:T,expected:T,message:string){
  if(actual!==expected)throw new Error(message+" — received: "+String(actual)+", expected: "+String(expected));
}

Deno.test("un candidato in coda non viene mai declassato automaticamente ad Agenzia",()=>{
  const fields=sellerFieldsForExisting(
    {tipo_venditore:"Da verificare",seller_manual_override:false},
    {classification:"Agenzia",confidence:95,evidence:"Inserzionista riconducibile a un marchio immobiliare"}
  );
  assertEquals(fields?.tipo_venditore,"Da verificare","resta da verificare");
  assertEquals(fields?.seller_confidence,0,"nessuna certezza automatica");
  assertEquals(fields?.seller_evidence.includes("Nuovi segnali di agenzia"),true,"l'evidenza spiega il motivo");
  assertEquals(fields?.seller_evidence.includes("marchio immobiliare"),true,"conserva la regola che ha scattato");
});

Deno.test("un privato riconosciuto non viene declassato ad Agenzia senza conferma",()=>{
  const fields=sellerFieldsForExisting(
    {tipo_venditore:"Privato",seller_manual_override:false},
    {classification:"Agenzia",confidence:98,evidence:"Venditore indicato come agenzia o professionista"}
  );
  assertEquals(fields?.tipo_venditore,"Da verificare","passa in revisione, non in agenzia");
});

Deno.test("le classificazioni manuali non vengono mai toccate",()=>{
  const fields=sellerFieldsForExisting(
    {tipo_venditore:"Privato",seller_manual_override:true},
    {classification:"Agenzia",confidence:98,evidence:"x"}
  );
  assertEquals(fields,null,"nessun campo venditore da aggiornare");
});

Deno.test("un candidato già Agenzia può restare Agenzia e i nuovi privati vengono riconosciuti",()=>{
  assertEquals(sellerFieldsForExisting({tipo_venditore:"Agenzia",seller_manual_override:false},
    {classification:"Agenzia",confidence:95,evidence:"x"})?.tipo_venditore,"Agenzia","agenzia confermata");
  assertEquals(sellerFieldsForExisting({tipo_venditore:"Da verificare",seller_manual_override:false},
    {classification:"Privato",confidence:99,evidence:"Etichetta esplicita: venditore privato"})?.tipo_venditore,"Privato","privato riconosciuto");
});

Deno.test("uno scarto precedente non nasconde un nuovo ribasso",()=>{
  assertEquals(shouldReopenDiscarded("scartato",true),true,"scartato + ribasso: torna in revisione");
  assertEquals(shouldReopenDiscarded("scartato",false),false,"scartato senza ribasso: resta scartato, la notifica è conservata");
  assertEquals(shouldReopenDiscarded("da_verificare",true),false,"già in coda");
  assertEquals(shouldReopenDiscarded("confermato",true),false,"già in archivio: non torna in coda");
});

Deno.test("rielaborazione: idoneità invariata rispetto al filtro storico",()=>{
  assertEquals(isRepairEligible({source_email_id:"m1",deduplication_version:0,seller_classification_version:3,data_extraction_version:6}),true,"deduplicazione mancante");
  assertEquals(isRepairEligible({source_email_id:"m1",deduplication_version:1,seller_classification_version:2,data_extraction_version:6}),true,"classificatore vecchio");
  assertEquals(isRepairEligible({source_email_id:"m1",deduplication_version:1,seller_classification_version:3,data_extraction_version:5}),true,"estrazione vecchia");
  assertEquals(isRepairEligible({source_email_id:"m1",deduplication_version:1,seller_classification_version:3,data_extraction_version:6}),false,"già aggiornato");
  assertEquals(isRepairEligible({source_email_id:"m1",seller_manual_override:true,deduplication_version:0}),false,"manuale escluso");
  assertEquals(isRepairEligible({source_email_id:null,deduplication_version:0}),false,"senza email");
});

Deno.test("una copia storica marcata come elaborata non viene più riletta a ogni ciclo",()=>{
  const legacy={source_email_id:"m1",deduplication_version:0,seller_classification_version:1,data_extraction_version:2};
  assertEquals(isRepairEligible(legacy),true,"prima: idonea");
  const marked={...legacy,...processedVersionMark(legacy)};
  assertEquals(isRepairEligible(marked),false,"dopo: non più idonea");
});

Deno.test("il segno di elaborazione non abbassa mai una versione esistente",()=>{
  const mark=processedVersionMark({deduplication_version:1,seller_classification_version:100,data_extraction_version:7});
  assertEquals(mark.seller_classification_version,100,"versione manuale preservata");
  assertEquals(mark.data_extraction_version,7,"versione futura preservata");
});

Deno.test("lo storico delle decisioni si aggiunge senza perdere gli altri dati estratti",()=>{
  const start={piano:"2",classe_energetica:"C"};
  const once=appendStatusHistory(start,{data:"2026-11-26T10:00:00Z",origine:"sincronizzazione",azione:"riaperto_per_ribasso",da:"scartato",a:"da_verificare",motivo:"Nuovo ribasso"});
  const twice=appendStatusHistory(once,{data:"2026-11-26T11:00:00Z",origine:"utente",azione:"scartato",motivo:"Agenzia verificata"});
  assertEquals(twice.piano,"2","campo esistente conservato");
  assertEquals(twice.classe_energetica,"C","campo esistente conservato");
  assertEquals((twice.storico_stato as unknown[]).length,2,"due voci");
  assertEquals((start as Record<string,unknown>).storico_stato,undefined,"l'oggetto originale non viene modificato");
});

Deno.test("lo storico è limitato alle voci più recenti",()=>{
  let value:Record<string,unknown>={};
  for(let index=0;index<STATUS_HISTORY_LIMIT+5;index++){
    value=appendStatusHistory(value,{data:String(index),origine:"utente",azione:"prova"});
  }
  const history=value.storico_stato as Array<{data:string}>;
  assertEquals(history.length,STATUS_HISTORY_LIMIT,"limite rispettato");
  assertEquals(history[history.length-1].data,String(STATUS_HISTORY_LIMIT+4),"l'ultima voce è la più recente");
});

Deno.test("una nuova estrazione conserva lo storico delle decisioni",()=>{
  const previous=appendStatusHistory({vecchio:true},{data:"t",origine:"utente",azione:"riportato_in_coda"});
  const next=preserveStatusHistory(previous,{nuovo:true});
  assertEquals(next.nuovo,true,"dati nuovi applicati");
  assertEquals(next.vecchio,undefined,"i dati estratti vecchi vengono sostituiti come prima");
  assertEquals(Array.isArray(next.storico_stato)&&next.storico_stato.length===1,true,"storico conservato");
  assertEquals(preserveStatusHistory(null,{nuovo:true}).storico_stato,undefined,"senza storico nulla da aggiungere");
});

Deno.test("le agenzie sono conservate salvo disattivazione esplicita",()=>{
  assertEquals(keepAgencyCandidates(undefined),true,"predefinito: conserva");
  assertEquals(keepAgencyCandidates(""),true,"vuoto: conserva");
  assertEquals(keepAgencyCandidates("false"),false,"disattivazione esplicita");
  assertEquals(keepAgencyCandidates(" FALSE "),false,"maiuscole e spazi");
});

const notice=(id:string,extra:Record<string,unknown>={})=>({
  data:"2026-11-25T10:00:00Z",source_email_id:id,prezzo:150000,ribasso_percentuale:null,
  titolo:"Trilocale di prova",comune:"Ancona",portale:"immobiliare.it",...extra
});

Deno.test("una nuova notifica senza ribasso su uno scartato viene riconosciuta",()=>{
  assertEquals(isNewNotificationAfterDiscard("scartato",false),true,"scartato, notifica nuova");
  assertEquals(isNewNotificationAfterDiscard("scartato",true),false,"rilettura della stessa notifica");
  assertEquals(isNewNotificationAfterDiscard("da_verificare",false),false,"già in coda: è visibile");
  assertEquals(isNewNotificationAfterDiscard("confermato",false),false,"in archivio");
});

Deno.test("la notifica dopo lo scarto viene registrata con le informazioni essenziali",()=>{
  const first=recordNotificationAfterDiscard({piano:"3"},notice("m1"));
  const record=first.notifiche_dopo_scarto as Record<string,any>;
  assertEquals(first.piano,"3","altri dati conservati");
  assertEquals(record.conteggio,1,"conteggio");
  assertEquals(record.da_rivedere,true,"da rivedere");
  assertEquals(record.ultima.source_email_id,"m1","ultima notifica");
  assertEquals(record.ultima.prezzo,150000,"prezzo");
  const second=recordNotificationAfterDiscard(first,notice("m2",{prezzo:149000}));
  assertEquals((second.notifiche_dopo_scarto as any).conteggio,2,"seconda notifica");
  assertEquals((second.notifiche_dopo_scarto as any).ultima.prezzo,149000,"ultima aggiornata");
});

Deno.test("la stessa notifica non viene contata due volte",()=>{
  const once=recordNotificationAfterDiscard({},notice("m1"));
  const twice=recordNotificationAfterDiscard(once,notice("m1"));
  assertEquals((twice.notifiche_dopo_scarto as any).conteggio,1,"idempotente");
});

Deno.test("l'elenco delle notifiche dopo lo scarto è limitato, il conteggio no",()=>{
  let value:Record<string,unknown>={};
  for(let index=0;index<DISCARDED_NOTIFICATION_LIMIT+4;index++)value=recordNotificationAfterDiscard(value,notice("m"+index));
  const record=value.notifiche_dopo_scarto as any;
  assertEquals(record.elenco.length,DISCARDED_NOTIFICATION_LIMIT,"elenco limitato");
  assertEquals(record.conteggio,DISCARDED_NOTIFICATION_LIMIT+4,"conteggio completo");
});
