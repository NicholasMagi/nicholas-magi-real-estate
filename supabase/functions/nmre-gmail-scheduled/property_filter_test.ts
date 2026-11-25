// Diagnostica del filtro avvisi immobiliari (propertyEmailDecision).
//
// Questi test documentano il comportamento ATTUALE, inclusi i falsi negativi
// noti (casi "FALSO NEGATIVO NOTO"): avvisi reali che oggi vengono esclusi prima
// del salvataggio. Non correggono le regole: le regole verranno modificate solo
// dopo l'audit dei falsi positivi e negativi (docs/proposte/A1-nessuna-opportunita-persa.md).
// Quando una regola cambierà, il test corrispondente andrà aggiornato in modo
// esplicito nella stessa modifica.
//
// Tutti i testi sono sintetici: nessun dato reale.
import { propertyEmail, propertyEmailDecision } from "./_shared/parser.ts";

function assertEquals<T>(actual:T,expected:T,message:string){
  if(actual!==expected)throw new Error(message+" — received: "+String(actual)+", expected: "+String(expected));
}

const LISTING="https://www.immobiliare.it/annunci/123456789/";
const rule=(subject:string,bodyText:string)=>propertyEmailDecision({subject,bodyText}).rule;

Deno.test("avviso ordinario accettato",()=>{
  assertEquals(rule("Nuovo annuncio per la tua ricerca","Trilocale Ancona 150.000 € "+LISTING),"accettata","avviso standard");
});

Deno.test("propertyEmail coincide con la decisione diagnostica",()=>{
  const cases=[
    {subject:"Nuovo annuncio per la tua ricerca",bodyText:"Trilocale "+LISTING},
    {subject:"Benvenuto su Immobiliare.it",bodyText:LISTING},
    {subject:"Il prezzo è sceso",bodyText:LISTING},
    {subject:"Nuovi annunci",bodyText:"https://www.immobiliare.it/ricerca/ancona/"}
  ];
  for(const email of cases){
    assertEquals(propertyEmail(email),propertyEmailDecision(email).accepted,"stesso esito per: "+email.subject);
  }
});

Deno.test("esclusioni legittime (veri negativi)",()=>{
  assertEquals(rule("Benvenuto su Immobiliare.it","Completa il profilo "+LISTING),"esclusione_nell_oggetto","email di benvenuto");
  assertEquals(rule("Reimposta la password","Clicca qui "+LISTING),"esclusione_nell_oggetto","reset password");
  assertEquals(rule("Nuovi annunci","Vedi i risultati https://www.immobiliare.it/ricerca/ancona/"),"link_principale_generico","solo link di ricerca generico");
});

Deno.test("FALSO NEGATIVO NOTO: parola di esclusione nel piè di pagina o nella descrizione",()=>{
  assertEquals(rule("Nuovo annuncio per la tua ricerca","Trilocale "+LISTING+" Hai dimenticato la password?"),"esclusione_nel_testo","'password' nel piè di pagina");
  assertEquals(rule("Nuovo annuncio per la tua ricerca","Trilocale "+LISTING+" Disiscriviti dalla newsletter"),"esclusione_nel_testo","'newsletter' nel piè di pagina");
  assertEquals(rule("Nuovi annunci","Trilocale "+LISTING+" Ricevi promozioni dai partner"),"esclusione_nel_testo","'promozioni' nel piè di pagina");
  assertEquals(rule("Nuovo annuncio","Trilocale vicino al Tribunale "+LISTING),"esclusione_nel_testo","'tribunale' come riferimento geografico");
  assertEquals(rule("Nuovo annuncio","Benvenuto nella tua nuova casa: trilocale "+LISTING),"esclusione_nel_testo","'benvenuto' nella descrizione");
});

Deno.test("FALSO NEGATIVO NOTO: avvisi con formulazioni non previste",()=>{
  assertEquals(rule("Il prezzo è sceso","Un immobile che segui ha ridotto il prezzo: ora 140.000 € "+LISTING),"nessun_segnale_di_avviso","avviso di ribasso");
  assertEquals(rule("Abbiamo trovato 3 case per te","Trilocale "+LISTING),"nessun_segnale_di_avviso","formulazione alternativa");
});

Deno.test("FALSO NEGATIVO NOTO: link di ricerca annidato che prevale sulla scheda diretta",()=>{
  const nested="https://clicks.immobiliare.it/f/a/x?url=https%3A%2F%2Fwww.immobiliare.it%2Fricerca%2F";
  assertEquals(rule("Nuovi annunci","Trilocale "+LISTING+" Vedi tutti "+nested),"link_principale_generico","la scheda esiste ma il link principale scelto è la ricerca");
});

Deno.test("FALSO NEGATIVO NOTO: link di tracciamento di un dominio non riconosciuto",()=>{
  assertEquals(rule("Nuovo annuncio","Trilocale https://u123.ct.sendgrid.net/ls/click?upn=abc"),"nessun_link_annuncio","dominio di tracciamento non in elenco");
});
