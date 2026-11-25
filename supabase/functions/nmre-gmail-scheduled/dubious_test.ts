// Rete di sicurezza degli avvisi dubbi (Fase 2). Testi sintetici: nessun dato reale.
import { captureDubiousAlertsEnabled, dubiousAlertEvidence, portalForHost, promotedSellerClassification, senderDomain } from "./_shared/dubious.ts";
import { propertyEmailDecision, specificPortalListingUrl } from "./_shared/parser.ts";

function assertEquals<T>(actual:T,expected:T,message:string){
  if(actual!==expected)throw new Error(message+" — received: "+String(actual)+", expected: "+String(expected));
}
const PORTALS=["idealista.it","immobiliare.it","casa.it","subito.it"];
const LISTING="https://www.immobiliare.it/annunci/123456789/";
const evidenceFor=(email:{subject:string;bodyText:string;from?:string})=>{
  const rule=propertyEmailDecision(email).rule;
  const text=[email.subject,email.bodyText].join(" ");
  return {rule,evidence:dubiousAlertEvidence(rule,email,specificPortalListingUrl(text),PORTALS)};
};

Deno.test("mittente e portale",()=>{
  assertEquals(senderDomain("Immobiliare.it <noreply@notifiche.immobiliare.it>"),"notifiche.immobiliare.it","dominio dal mittente");
  assertEquals(senderDomain("persona@example.com"),"example.com","indirizzo semplice");
  assertEquals(senderDomain(""),null,"vuoto");
  assertEquals(portalForHost("notifiche.immobiliare.it",PORTALS),"immobiliare.it","sottodominio del portale");
  assertEquals(portalForHost("immobiliare.it.example.com",PORTALS),null,"dominio ingannevole");
});

Deno.test("avviso con 'password' nel piè di pagina: conservato come dubbio con la scheda",()=>{
  const {rule,evidence}=evidenceFor({subject:"Nuovo annuncio per la tua ricerca",bodyText:"Trilocale "+LISTING+" Hai dimenticato la password?"});
  assertEquals(rule,"esclusione_nel_testo","escluso dal filtro");
  assertEquals(evidence?.reason,"scheda_specifica","prova: scheda specifica");
  assertEquals(evidence?.listingUrl,LISTING,"link conservato");
  assertEquals(evidence?.portal,"immobiliare.it","portale");
});

Deno.test("avviso di ribasso escluso dal filtro: conservato come dubbio",()=>{
  const {evidence}=evidenceFor({subject:"Il prezzo è sceso",bodyText:"Ora 140.000 € "+LISTING});
  assertEquals(evidence?.reason,"scheda_specifica","conservato");
});

Deno.test("scheda diretta battuta dal link di ricerca annidato: la scheda resta disponibile",()=>{
  const nested="https://clicks.immobiliare.it/f/a/x?url=https%3A%2F%2Fwww.immobiliare.it%2Fricerca%2F";
  const {rule,evidence}=evidenceFor({subject:"Nuovi annunci",bodyText:"Trilocale "+LISTING+" Vedi tutti "+nested});
  assertEquals(rule,"link_principale_generico","escluso dal filtro");
  assertEquals(evidence?.listingUrl,LISTING,"la scheda specifica viene recuperata");
});

Deno.test("tracker sconosciuto ma mittente del portale: conservato come dubbio senza link",()=>{
  const {evidence}=evidenceFor({subject:"Nuovo annuncio",bodyText:"Trilocale https://u123.ct.sendgrid.net/ls/click?upn=abc",from:"Idealista <avvisi@idealista.it>"});
  assertEquals(evidence?.reason,"mittente_portale","prova: mittente");
  assertEquals(evidence?.listingUrl,null,"nessun link disponibile");
});

Deno.test("email di servizio senza annuncio: non conservata",()=>{
  assertEquals(evidenceFor({subject:"Reimposta la password",bodyText:"Clicca qui https://www.immobiliare.it/account/",from:"noreply@immobiliare.it"}).evidence,null,"reset password del portale");
  assertEquals(evidenceFor({subject:"Benvenuto",bodyText:"Grazie per l'iscrizione",from:"noreply@casa.it"}).evidence,null,"benvenuto senza scheda");
  assertEquals(evidenceFor({subject:"Offerta",bodyText:"Sconti",from:"news@example.com"}).evidence,null,"mittente estraneo");
});

Deno.test("email di servizio che contiene una scheda specifica: conservata",()=>{
  const {evidence}=evidenceFor({subject:"Benvenuto su Immobiliare.it",bodyText:"Ecco un annuncio per te "+LISTING});
  assertEquals(evidence?.reason,"scheda_specifica","la scheda prevale sull'esclusione dell'oggetto");
});

Deno.test("un avviso accettato non è mai un avviso dubbio",()=>{
  assertEquals(evidenceFor({subject:"Nuovo annuncio per la tua ricerca",bodyText:"Trilocale "+LISTING}).evidence,null,"accettato");
});

Deno.test("un avviso promosso dal titolare non resta mai in agenzia",()=>{
  assertEquals(promotedSellerClassification({classification:"Agenzia",confidence:95,evidence:"x"}).classification,"Da verificare","agenzia → da verificare");
  assertEquals(promotedSellerClassification({classification:"Privato",confidence:99,evidence:"y"}).classification,"Privato","privato invariato");
});

Deno.test("la rete di sicurezza è disattivata salvo attivazione esplicita",()=>{
  assertEquals(captureDubiousAlertsEnabled(undefined),false,"predefinito: spenta (richiede la migrazione)");
  assertEquals(captureDubiousAlertsEnabled("true"),true,"attivata");
  assertEquals(captureDubiousAlertsEnabled("TRUE "),true,"maiuscole e spazi");
  assertEquals(captureDubiousAlertsEnabled("1"),false,"solo 'true'");
});
