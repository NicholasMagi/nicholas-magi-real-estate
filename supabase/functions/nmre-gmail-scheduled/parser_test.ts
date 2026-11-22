import {
  municipality,price,listingUrl,propertyEmail,propertyType,surface,rooms,
  bedrooms,bathrooms,sellerClassification
} from "./_shared/parser.ts";

function assertEquals<T>(actual:T,expected:T,message:string){
  if(actual!==expected)throw new Error(message+" — received: "+String(actual)+", expected: "+String(expected));
}

Deno.test("prezzo italiano con separatore migliaia",()=>{
  assertEquals(price("Prezzo richiesto: € 185.000"),185000,"€ 185.000");
  assertEquals(price("Richiesta 185.000,00 EUR"),185000,"185.000,00 EUR");
});
Deno.test("estrazione tipologia, metratura e vani",()=>{
  assertEquals(propertyType("Appartamento trilocale con balcone"),"Trilocale","tipologia trilocale");
  assertEquals(surface("Superficie: 95 m² commerciali"),95,"superficie 95 m²");
  assertEquals(surface("Superficie: 1.200 m²"),1200,"superficie con separatore migliaia");
  assertEquals(surface("95,5 mq"),95,"superficie con decimale");
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
