import {
  municipality,price,listingPrice,priceReduction,listingUrl,propertyEmail,propertyType,surface,rooms,
  bedrooms,bathrooms,sellerClassification,resolveListingUrl,canonicalListingKey,compareListingIdentity
} from "./_shared/parser.ts";

function assertEquals<T>(actual:T,expected:T,message:string){
  if(actual!==expected)throw new Error(message+" — received: "+String(actual)+", expected: "+String(expected));
}

Deno.test("prezzo italiano con separatore migliaia",()=>{
  assertEquals(price("Prezzo richiesto: € 185.000"),185000,"€ 185.000");
  assertEquals(price("Richiesta 185.000,00 EUR"),185000,"185.000,00 EUR");
  assertEquals(price("€ 52.523 82 m² | 3 locali"),52523,"non ingloba la metratura successiva");
  assertEquals(price("€ 215.000 80 m² | 3 locali"),215000,"prezzo e superficie separati");
  assertEquals(price("€ 63.000 48 m²"),63000,"prezzo con metratura a due cifre");
  assertEquals(price("€ 246.000 118 m² | 4 locali"),246000,"non ingloba metratura a tre cifre");
  assertEquals(price("€ 112.950 214 m²"),112950,"prezzo prima di superficie a tre cifre");
  assertEquals(listingPrice("notifica senza importo","Quadrilocale € 246.000 118 m²"),246000,"recupera prezzo dal titolo dell’annuncio");
  assertEquals(listingPrice("notifica senza importo","Appartamento in vendita 118 m²"),null,"non inventa il prezzo mancante");
  const reduction=priceReduction("€ 167.000 € 179.000 (-6,7%)");
  assertEquals(reduction?.currentPrice,167000,"prezzo attuale del ribasso");
  assertEquals(reduction?.previousPrice,179000,"prezzo precedente del ribasso");
  assertEquals(reduction?.reductionAmount,12000,"importo della riduzione");
  assertEquals(reduction?.reductionPercent,6.7,"percentuale della riduzione");
  assertEquals(priceReduction("€ 85.000 € 105.000 (-19,0%)")?.reductionPercent,19.05,"calcola la percentuale esatta dai due importi anche quando il portale arrotonda");
  assertEquals(priceReduction("€ 179.000"),null,"non inventa il prezzo precedente");
  assertEquals(priceReduction("€ 180.000 € 179.000 (-6,7%)"),null,"rifiuta coppie prezzo incoerenti");
  assertEquals(priceReduction("€ 167.000 € 179.000 (-20,0%)"),null,"rifiuta percentuali discordanti");
});
Deno.test("estrazione tipologia, metratura e vani",()=>{
  assertEquals(propertyType("Appartamento trilocale con balcone"),"Trilocale","tipologia trilocale");
  assertEquals(surface("Superficie: 95 m² commerciali"),95,"superficie 95 m²");
  assertEquals(surface("Superficie: 1.200 m²"),1200,"superficie con separatore migliaia");
  assertEquals(surface("95,5 mq"),96,"superficie con decimale arrotondata al metro quadrato");
  assertEquals(rooms("4,5 locali"),4.5,"4,5 locali");
  assertEquals(bedrooms("2 camere da letto"),2,"2 camere");
  assertEquals(bathrooms("1 bagno"),1,"1 bagno");
});
Deno.test("riconoscimento comune marchigiano",()=>{
  assertEquals(municipality("Via Roma, Recanati, appartamento"),"Recanati","comune Recanati");
});
Deno.test("classificazione venditore prudente",()=>{
  assertEquals(sellerClassification("Pubblicato da privato"),"Privato","privato esplicito");
  assertEquals(sellerClassification("Venditore: agenzia immobiliare"),"Agenzia","agenzia esplicita");
  assertEquals(sellerClassification("Appartamento in vendita, informazioni nella scheda"),"Da verificare","caso ambiguo");
});
Deno.test("filtro notifica annuncio e rifiuto link generici",()=>{
  assertEquals(propertyEmail({
    subject:"1 nuovo annuncio per la tua ricerca: Case in vendita",
    snippet:"Disponibile un nuovo immobile",
    bodyText:"https://www.immobiliare.it/annunci/123456/"
  }),true,"nuovo annuncio con scheda diretta");
  assertEquals(propertyEmail({
    subject:"La tua ricerca è stata salvata: Case in vendita",
    snippet:"Nuovo annuncio",
    bodyText:"https://www.immobiliare.it/"
  }),false,"ricerca salvata");
  assertEquals(propertyEmail({
    subject:"1 nuovo annuncio per la tua ricerca",
    snippet:"Appartamento in vendita",
    bodyText:"appartamento in vendita https://www.immobiliare.it/"
  }),false,"homepage non è una scheda");
  assertEquals(propertyEmail({
    subject:"1 nuovo annuncio per la tua ricerca",
    snippet:"Appartamento all'asta",
    bodyText:"appartamento all'asta via Roma https://www.immobiliare.it/annunci/123456/"
  }),false,"annuncio all'asta");
});
Deno.test("preferisce il link diretto al link di tracciamento",()=>{
  const url=listingUrl("https://clicks.immobiliare.it/f/a/track https://www.immobiliare.it/annunci/987654/");
  if(!url?.includes("/annunci/987654/"))throw new Error("Non ha scelto il link diretto");
});

Deno.test("risolve il redirect email verso la scheda Immobiliare.it con GET",async()=>{
  const originalFetch=globalThis.fetch;
  let requestMethod="";
  try{
    globalThis.fetch=(async(_input:RequestInfo|URL,init?:RequestInit)=>{
      requestMethod=String(init?.method||"");
      return {ok:true,url:"https://www.immobiliare.it/annunci/987654321/"} as Response;
    }) as typeof fetch;
    const url=await resolveListingUrl("https://clicks.immobiliare.it/f/a/click-tracked-listing");
    assertEquals(requestMethod,"GET","il redirect viene seguito con GET");
    assertEquals(url,"https://www.immobiliare.it/annunci/987654321/","URL della scheda specifica");
  }finally{
    globalThis.fetch=originalFetch;
  }
});
Deno.test("non accetta la homepage come destinazione di un link tracciato",async()=>{
  const originalFetch=globalThis.fetch;
  try{
    globalThis.fetch=(async()=>({
      ok:true,
      url:"https://www.immobiliare.it/?utm_source=alert_istantaneo"
    }) as Response) as typeof fetch;
    const url=await resolveListingUrl("https://clicks.immobiliare.it/f/a/click-tracked-logo");
    assertEquals(url,null,"la homepage non è una scheda immobiliare");
  }finally{
    globalThis.fetch=originalFetch;
  }
});


Deno.test("chiave canonica stabile solo per URL di schede specifiche",()=>{
  assertEquals(
    canonicalListingKey("https://www.immobiliare.it/annunci/987654321/?utm_source=email#dettagli"),
    "immobiliare.it/annunci/987654321",
    "ignora www, parametri di tracciamento e frammenti"
  );
  assertEquals(
    canonicalListingKey("https://immobiliare.it/annunci/987654321/"),
    "immobiliare.it/annunci/987654321",
    "stessa scheda con forma URL diversa"
  );
  assertEquals(canonicalListingKey("https://www.immobiliare.it/"),null,"rifiuta la homepage");
  assertEquals(canonicalListingKey("https://www.immobiliare.it/ricerca/"),null,"rifiuta la ricerca generica");
  assertEquals(canonicalListingKey("https://example.com/annunci/987654321/"),null,"rifiuta host non riconosciuti");
});


Deno.test("deduplica cross-portale quando comune, indirizzo e civico coincidono",()=>{
  const a={url:"https://www.casa.it/immobili/99112233/",titolo:"Appartamento luminoso in Via Roma",comune:"Osimo",tipologia_immobile:"Trilocale",superficie_mq:92,locali:3,prezzo:198000,dati_estratti:{indirizzo_rilevato:"Via Roma 14"}};
  const b={url:"https://www.immobiliare.it/annunci/88776655/",titolo:"Trilocale ristrutturato, centro",comune:"Osimo",tipologia_immobile:"Appartamento",superficie_mq:93,locali:3,prezzo:205000,dati_estratti:{indirizzo_rilevato:"V. Roma, 14"}};
  const result=compareListingIdentity(a,b);
  if(result.kind!=="strong"||result.confidence<95)throw new Error("Indirizzo cross-portale certo non riconosciuto: "+JSON.stringify(result));
});
Deno.test("annunci simili senza indirizzo certo restano possibili duplicati",()=>{
  const a={titolo:"Trilocale ristrutturato con garage",comune:"Osimo",tipologia_immobile:"Trilocale",superficie_mq:90,locali:3,prezzo:200000};
  const b={titolo:"Appartamento luminoso con terrazzo",comune:"Osimo",tipologia_immobile:"Appartamento",superficie_mq:91,locali:3,prezzo:204000};
  const result=compareListingIdentity(a,b);
  if(result.kind!=="possible")throw new Error("Caso incerto unito automaticamente: "+JSON.stringify(result));
});
Deno.test("non associa immobili con civici diversi sulla stessa via",()=>{
  const a={titolo:"Appartamento Via Roma",comune:"Osimo",tipologia_immobile:"Appartamento",superficie_mq:90,locali:3,prezzo:200000,dati_estratti:{indirizzo_rilevato:"Via Roma 14"}};
  const b={titolo:"Appartamento Via Roma",comune:"Osimo",tipologia_immobile:"Appartamento",superficie_mq:90,locali:3,prezzo:200000,dati_estratti:{indirizzo_rilevato:"Via Roma 16"}};
  const result=compareListingIdentity(a,b);
  if(result.kind!=="none")throw new Error("Civici diversi associati: "+JSON.stringify(result));
});
Deno.test("non associa automaticamente immobili in comuni diversi",()=>{
  const result=compareListingIdentity(
    {titolo:"Trilocale",comune:"Osimo",tipologia_immobile:"Appartamento",superficie_mq:90,locali:3,prezzo:200000},
    {titolo:"Trilocale",comune:"Ancona",tipologia_immobile:"Appartamento",superficie_mq:90,locali:3,prezzo:200000}
  );
  assertEquals(result.kind,"none","il comune deve coincidere");
});
