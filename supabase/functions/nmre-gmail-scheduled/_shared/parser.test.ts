import {
  bathrooms,
  bedrooms,
  municipality,
  price,
  propertyType,
  rooms,
  surface
} from "./parser.ts";

function assertEquals<T>(actual:T, expected:T, label:string):void {
  if(actual!==expected){
    throw new Error(label+": expected "+String(expected)+", received "+String(actual));
  }
}

Deno.test("price parser handles Italian euro formats",()=>{
  assertEquals(price("Prezzo richiesto: € 189.000"),189000,"grouped euro value");
  assertEquals(price("Richiesta 210.000 euro"),210000,"euro suffix");
  assertEquals(price("€ 180,5 mila"),180500,"thousands suffix");
  assertEquals(price("Prezzo: 1.250.000,00 EUR"),1250000,"decimal cents");
  assertEquals(price("Richiesta &euro; 180.000"),180000,"HTML encoded euro symbol");
  assertEquals(price("Appartamento di 95 mq e 4 locali"),null,"no invented price");
});

Deno.test("surface parser handles common portal formats",()=>{
  assertEquals(surface("Superficie commerciale: 95 mq"),95,"commercial surface");
  assertEquals(surface("120 m²"),120,"square metre symbol");
  assertEquals(surface("Superficie commerciale: 95 m&sup2;"),95,"HTML encoded square metre symbol");
  assertEquals(surface("1.200 m2"),1200,"thousands separated square metres");
  assertEquals(surface("Superficie: circa 100 metri quadrati"),100,"approximate surface");
  assertEquals(surface("4 locali, 2 bagni"),null,"no invented surface");
});

Deno.test("rooms parser handles values before and after labels",()=>{
  assertEquals(rooms("Appartamento con 4,5 vani"),4.5,"decimal rooms");
  assertEquals(rooms("Locali: 3"),3,"label before value");
});

Deno.test("bedrooms and bathrooms parser handles singular and plural labels",()=>{
  assertEquals(bedrooms("2 camere da letto"),2,"bedrooms before label");
  assertEquals(bedrooms("Camere: 3"),3,"bedrooms after label");
  assertEquals(bathrooms("1 bagno"),1,"singular bathroom");
  assertEquals(bathrooms("Bagni: 2"),2,"plural bathrooms after label");
});

Deno.test("property type parser recognises additional Italian categories",()=>{
  assertEquals(propertyType("Villetta a schiera con giardino"),"Villetta a schiera","terraced house");
  assertEquals(propertyType("Porzione di bifamiliare"),"Porzione di bifamiliare","semi-detached portion");
  assertEquals(propertyType("Locale commerciale in centro"),"Locale commerciale","commercial premises");
  assertEquals(propertyType("Loft ristrutturato"),"Loft","loft");
});

Deno.test("municipality parser recognises core territory",()=>{
  assertEquals(municipality("Osimo - zona centro"),"Osimo","Osimo");
  assertEquals(municipality("Castelfidardo (AN)"),"Castelfidardo","Castelfidardo");
});
