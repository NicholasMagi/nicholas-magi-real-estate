// Repertorio dei 225 Comuni delle Marche.
// Riferimento: ISTAT, "Elenco dei comuni italiani" (aggiornato al 21/02/2026).
// La sigla provinciale permette di filtrare l'archivio senza aggiungere colonne al database.
export const PROVINCES = Object.freeze([
  { code: "AN", name: "Ancona", count: 47 },
  { code: "AP", name: "Ascoli Piceno", count: 33 },
  { code: "FM", name: "Fermo", count: 40 },
  { code: "MC", name: "Macerata", count: 55 },
  { code: "PU", name: "Pesaro e Urbino", count: 50 },
]);

export const MARCHE_MUNICIPALITIES = Object.freeze([
  {
    "name": "Agugliano",
    "provinceCode": "AN",
    "provinceName": "Ancona"
  },
  {
    "name": "Ancona",
    "provinceCode": "AN",
    "provinceName": "Ancona"
  },
  {
    "name": "Arcevia",
    "provinceCode": "AN",
    "provinceName": "Ancona"
  },
  {
    "name": "Barbara",
    "provinceCode": "AN",
    "provinceName": "Ancona"
  },
  {
    "name": "Belvedere Ostrense",
    "provinceCode": "AN",
    "provinceName": "Ancona"
  },
  {
    "name": "Camerano",
    "provinceCode": "AN",
    "provinceName": "Ancona"
  },
  {
    "name": "Camerata Picena",
    "provinceCode": "AN",
    "provinceName": "Ancona"
  },
  {
    "name": "Castelbellino",
    "provinceCode": "AN",
    "provinceName": "Ancona"
  },
  {
    "name": "Castelfidardo",
    "provinceCode": "AN",
    "provinceName": "Ancona"
  },
  {
    "name": "Castelleone di Suasa",
    "provinceCode": "AN",
    "provinceName": "Ancona"
  },
  {
    "name": "Castelplanio",
    "provinceCode": "AN",
    "provinceName": "Ancona"
  },
  {
    "name": "Cerreto d'Esi",
    "provinceCode": "AN",
    "provinceName": "Ancona"
  },
  {
    "name": "Chiaravalle",
    "provinceCode": "AN",
    "provinceName": "Ancona"
  },
  {
    "name": "Corinaldo",
    "provinceCode": "AN",
    "provinceName": "Ancona"
  },
  {
    "name": "Cupramontana",
    "provinceCode": "AN",
    "provinceName": "Ancona"
  },
  {
    "name": "Fabriano",
    "provinceCode": "AN",
    "provinceName": "Ancona"
  },
  {
    "name": "Falconara Marittima",
    "provinceCode": "AN",
    "provinceName": "Ancona"
  },
  {
    "name": "Filottrano",
    "provinceCode": "AN",
    "provinceName": "Ancona"
  },
  {
    "name": "Genga",
    "provinceCode": "AN",
    "provinceName": "Ancona"
  },
  {
    "name": "Jesi",
    "provinceCode": "AN",
    "provinceName": "Ancona"
  },
  {
    "name": "Loreto",
    "provinceCode": "AN",
    "provinceName": "Ancona"
  },
  {
    "name": "Maiolati Spontini",
    "provinceCode": "AN",
    "provinceName": "Ancona"
  },
  {
    "name": "Mergo",
    "provinceCode": "AN",
    "provinceName": "Ancona"
  },
  {
    "name": "Monsano",
    "provinceCode": "AN",
    "provinceName": "Ancona"
  },
  {
    "name": "Monte Roberto",
    "provinceCode": "AN",
    "provinceName": "Ancona"
  },
  {
    "name": "Monte San Vito",
    "provinceCode": "AN",
    "provinceName": "Ancona"
  },
  {
    "name": "Montecarotto",
    "provinceCode": "AN",
    "provinceName": "Ancona"
  },
  {
    "name": "Montemarciano",
    "provinceCode": "AN",
    "provinceName": "Ancona"
  },
  {
    "name": "Morro d'Alba",
    "provinceCode": "AN",
    "provinceName": "Ancona"
  },
  {
    "name": "Numana",
    "provinceCode": "AN",
    "provinceName": "Ancona"
  },
  {
    "name": "Offagna",
    "provinceCode": "AN",
    "provinceName": "Ancona"
  },
  {
    "name": "Osimo",
    "provinceCode": "AN",
    "provinceName": "Ancona"
  },
  {
    "name": "Ostra",
    "provinceCode": "AN",
    "provinceName": "Ancona"
  },
  {
    "name": "Ostra Vetere",
    "provinceCode": "AN",
    "provinceName": "Ancona"
  },
  {
    "name": "Poggio San Marcello",
    "provinceCode": "AN",
    "provinceName": "Ancona"
  },
  {
    "name": "Polverigi",
    "provinceCode": "AN",
    "provinceName": "Ancona"
  },
  {
    "name": "Rosora",
    "provinceCode": "AN",
    "provinceName": "Ancona"
  },
  {
    "name": "San Marcello",
    "provinceCode": "AN",
    "provinceName": "Ancona"
  },
  {
    "name": "San Paolo di Jesi",
    "provinceCode": "AN",
    "provinceName": "Ancona"
  },
  {
    "name": "Santa Maria Nuova",
    "provinceCode": "AN",
    "provinceName": "Ancona"
  },
  {
    "name": "Sassoferrato",
    "provinceCode": "AN",
    "provinceName": "Ancona"
  },
  {
    "name": "Senigallia",
    "provinceCode": "AN",
    "provinceName": "Ancona"
  },
  {
    "name": "Serra de' Conti",
    "provinceCode": "AN",
    "provinceName": "Ancona"
  },
  {
    "name": "Serra San Quirico",
    "provinceCode": "AN",
    "provinceName": "Ancona"
  },
  {
    "name": "Sirolo",
    "provinceCode": "AN",
    "provinceName": "Ancona"
  },
  {
    "name": "Staffolo",
    "provinceCode": "AN",
    "provinceName": "Ancona"
  },
  {
    "name": "Trecastelli",
    "provinceCode": "AN",
    "provinceName": "Ancona"
  },
  {
    "name": "Acquasanta Terme",
    "provinceCode": "AP",
    "provinceName": "Ascoli Piceno"
  },
  {
    "name": "Acquaviva Picena",
    "provinceCode": "AP",
    "provinceName": "Ascoli Piceno"
  },
  {
    "name": "Appignano del Tronto",
    "provinceCode": "AP",
    "provinceName": "Ascoli Piceno"
  },
  {
    "name": "Arquata del Tronto",
    "provinceCode": "AP",
    "provinceName": "Ascoli Piceno"
  },
  {
    "name": "Ascoli Piceno",
    "provinceCode": "AP",
    "provinceName": "Ascoli Piceno"
  },
  {
    "name": "Carassai",
    "provinceCode": "AP",
    "provinceName": "Ascoli Piceno"
  },
  {
    "name": "Castel di Lama",
    "provinceCode": "AP",
    "provinceName": "Ascoli Piceno"
  },
  {
    "name": "Castignano",
    "provinceCode": "AP",
    "provinceName": "Ascoli Piceno"
  },
  {
    "name": "Castorano",
    "provinceCode": "AP",
    "provinceName": "Ascoli Piceno"
  },
  {
    "name": "Colli del Tronto",
    "provinceCode": "AP",
    "provinceName": "Ascoli Piceno"
  },
  {
    "name": "Comunanza",
    "provinceCode": "AP",
    "provinceName": "Ascoli Piceno"
  },
  {
    "name": "Cossignano",
    "provinceCode": "AP",
    "provinceName": "Ascoli Piceno"
  },
  {
    "name": "Cupra Marittima",
    "provinceCode": "AP",
    "provinceName": "Ascoli Piceno"
  },
  {
    "name": "Folignano",
    "provinceCode": "AP",
    "provinceName": "Ascoli Piceno"
  },
  {
    "name": "Force",
    "provinceCode": "AP",
    "provinceName": "Ascoli Piceno"
  },
  {
    "name": "Grottammare",
    "provinceCode": "AP",
    "provinceName": "Ascoli Piceno"
  },
  {
    "name": "Maltignano",
    "provinceCode": "AP",
    "provinceName": "Ascoli Piceno"
  },
  {
    "name": "Massignano",
    "provinceCode": "AP",
    "provinceName": "Ascoli Piceno"
  },
  {
    "name": "Monsampolo del Tronto",
    "provinceCode": "AP",
    "provinceName": "Ascoli Piceno"
  },
  {
    "name": "Montalto delle Marche",
    "provinceCode": "AP",
    "provinceName": "Ascoli Piceno"
  },
  {
    "name": "Montedinove",
    "provinceCode": "AP",
    "provinceName": "Ascoli Piceno"
  },
  {
    "name": "Montefiore dell'Aso",
    "provinceCode": "AP",
    "provinceName": "Ascoli Piceno"
  },
  {
    "name": "Montegallo",
    "provinceCode": "AP",
    "provinceName": "Ascoli Piceno"
  },
  {
    "name": "Montemonaco",
    "provinceCode": "AP",
    "provinceName": "Ascoli Piceno"
  },
  {
    "name": "Monteprandone",
    "provinceCode": "AP",
    "provinceName": "Ascoli Piceno"
  },
  {
    "name": "Offida",
    "provinceCode": "AP",
    "provinceName": "Ascoli Piceno"
  },
  {
    "name": "Palmiano",
    "provinceCode": "AP",
    "provinceName": "Ascoli Piceno"
  },
  {
    "name": "Ripatransone",
    "provinceCode": "AP",
    "provinceName": "Ascoli Piceno"
  },
  {
    "name": "Roccafluvione",
    "provinceCode": "AP",
    "provinceName": "Ascoli Piceno"
  },
  {
    "name": "Rotella",
    "provinceCode": "AP",
    "provinceName": "Ascoli Piceno"
  },
  {
    "name": "San Benedetto del Tronto",
    "provinceCode": "AP",
    "provinceName": "Ascoli Piceno"
  },
  {
    "name": "Spinetoli",
    "provinceCode": "AP",
    "provinceName": "Ascoli Piceno"
  },
  {
    "name": "Venarotta",
    "provinceCode": "AP",
    "provinceName": "Ascoli Piceno"
  },
  {
    "name": "Altidona",
    "provinceCode": "FM",
    "provinceName": "Fermo"
  },
  {
    "name": "Amandola",
    "provinceCode": "FM",
    "provinceName": "Fermo"
  },
  {
    "name": "Belmonte Piceno",
    "provinceCode": "FM",
    "provinceName": "Fermo"
  },
  {
    "name": "Campofilone",
    "provinceCode": "FM",
    "provinceName": "Fermo"
  },
  {
    "name": "Falerone",
    "provinceCode": "FM",
    "provinceName": "Fermo"
  },
  {
    "name": "Fermo",
    "provinceCode": "FM",
    "provinceName": "Fermo"
  },
  {
    "name": "Francavilla d'Ete",
    "provinceCode": "FM",
    "provinceName": "Fermo"
  },
  {
    "name": "Grottazzolina",
    "provinceCode": "FM",
    "provinceName": "Fermo"
  },
  {
    "name": "Lapedona",
    "provinceCode": "FM",
    "provinceName": "Fermo"
  },
  {
    "name": "Magliano di Tenna",
    "provinceCode": "FM",
    "provinceName": "Fermo"
  },
  {
    "name": "Massa Fermana",
    "provinceCode": "FM",
    "provinceName": "Fermo"
  },
  {
    "name": "Monsampietro Morico",
    "provinceCode": "FM",
    "provinceName": "Fermo"
  },
  {
    "name": "Montappone",
    "provinceCode": "FM",
    "provinceName": "Fermo"
  },
  {
    "name": "Monte Giberto",
    "provinceCode": "FM",
    "provinceName": "Fermo"
  },
  {
    "name": "Monte Rinaldo",
    "provinceCode": "FM",
    "provinceName": "Fermo"
  },
  {
    "name": "Monte San Pietrangeli",
    "provinceCode": "FM",
    "provinceName": "Fermo"
  },
  {
    "name": "Monte Urano",
    "provinceCode": "FM",
    "provinceName": "Fermo"
  },
  {
    "name": "Monte Vidon Combatte",
    "provinceCode": "FM",
    "provinceName": "Fermo"
  },
  {
    "name": "Monte Vidon Corrado",
    "provinceCode": "FM",
    "provinceName": "Fermo"
  },
  {
    "name": "Montefalcone Appennino",
    "provinceCode": "FM",
    "provinceName": "Fermo"
  },
  {
    "name": "Montefortino",
    "provinceCode": "FM",
    "provinceName": "Fermo"
  },
  {
    "name": "Montegiorgio",
    "provinceCode": "FM",
    "provinceName": "Fermo"
  },
  {
    "name": "Montegranaro",
    "provinceCode": "FM",
    "provinceName": "Fermo"
  },
  {
    "name": "Monteleone di Fermo",
    "provinceCode": "FM",
    "provinceName": "Fermo"
  },
  {
    "name": "Montelparo",
    "provinceCode": "FM",
    "provinceName": "Fermo"
  },
  {
    "name": "Monterubbiano",
    "provinceCode": "FM",
    "provinceName": "Fermo"
  },
  {
    "name": "Montottone",
    "provinceCode": "FM",
    "provinceName": "Fermo"
  },
  {
    "name": "Moresco",
    "provinceCode": "FM",
    "provinceName": "Fermo"
  },
  {
    "name": "Ortezzano",
    "provinceCode": "FM",
    "provinceName": "Fermo"
  },
  {
    "name": "Pedaso",
    "provinceCode": "FM",
    "provinceName": "Fermo"
  },
  {
    "name": "Petritoli",
    "provinceCode": "FM",
    "provinceName": "Fermo"
  },
  {
    "name": "Ponzano di Fermo",
    "provinceCode": "FM",
    "provinceName": "Fermo"
  },
  {
    "name": "Porto San Giorgio",
    "provinceCode": "FM",
    "provinceName": "Fermo"
  },
  {
    "name": "Porto Sant'Elpidio",
    "provinceCode": "FM",
    "provinceName": "Fermo"
  },
  {
    "name": "Rapagnano",
    "provinceCode": "FM",
    "provinceName": "Fermo"
  },
  {
    "name": "Sant'Elpidio a Mare",
    "provinceCode": "FM",
    "provinceName": "Fermo"
  },
  {
    "name": "Santa Vittoria in Matenano",
    "provinceCode": "FM",
    "provinceName": "Fermo"
  },
  {
    "name": "Servigliano",
    "provinceCode": "FM",
    "provinceName": "Fermo"
  },
  {
    "name": "Smerillo",
    "provinceCode": "FM",
    "provinceName": "Fermo"
  },
  {
    "name": "Torre San Patrizio",
    "provinceCode": "FM",
    "provinceName": "Fermo"
  },
  {
    "name": "Apiro",
    "provinceCode": "MC",
    "provinceName": "Macerata"
  },
  {
    "name": "Appignano",
    "provinceCode": "MC",
    "provinceName": "Macerata"
  },
  {
    "name": "Belforte del Chienti",
    "provinceCode": "MC",
    "provinceName": "Macerata"
  },
  {
    "name": "Bolognola",
    "provinceCode": "MC",
    "provinceName": "Macerata"
  },
  {
    "name": "Caldarola",
    "provinceCode": "MC",
    "provinceName": "Macerata"
  },
  {
    "name": "Camerino",
    "provinceCode": "MC",
    "provinceName": "Macerata"
  },
  {
    "name": "Camporotondo di Fiastrone",
    "provinceCode": "MC",
    "provinceName": "Macerata"
  },
  {
    "name": "Castelraimondo",
    "provinceCode": "MC",
    "provinceName": "Macerata"
  },
  {
    "name": "Castelsantangelo sul Nera",
    "provinceCode": "MC",
    "provinceName": "Macerata"
  },
  {
    "name": "Cessapalombo",
    "provinceCode": "MC",
    "provinceName": "Macerata"
  },
  {
    "name": "Cingoli",
    "provinceCode": "MC",
    "provinceName": "Macerata"
  },
  {
    "name": "Civitanova Marche",
    "provinceCode": "MC",
    "provinceName": "Macerata"
  },
  {
    "name": "Colmurano",
    "provinceCode": "MC",
    "provinceName": "Macerata"
  },
  {
    "name": "Corridonia",
    "provinceCode": "MC",
    "provinceName": "Macerata"
  },
  {
    "name": "Esanatoglia",
    "provinceCode": "MC",
    "provinceName": "Macerata"
  },
  {
    "name": "Fiastra",
    "provinceCode": "MC",
    "provinceName": "Macerata"
  },
  {
    "name": "Fiuminata",
    "provinceCode": "MC",
    "provinceName": "Macerata"
  },
  {
    "name": "Gagliole",
    "provinceCode": "MC",
    "provinceName": "Macerata"
  },
  {
    "name": "Gualdo",
    "provinceCode": "MC",
    "provinceName": "Macerata"
  },
  {
    "name": "Loro Piceno",
    "provinceCode": "MC",
    "provinceName": "Macerata"
  },
  {
    "name": "Macerata",
    "provinceCode": "MC",
    "provinceName": "Macerata"
  },
  {
    "name": "Matelica",
    "provinceCode": "MC",
    "provinceName": "Macerata"
  },
  {
    "name": "Mogliano",
    "provinceCode": "MC",
    "provinceName": "Macerata"
  },
  {
    "name": "Monte Cavallo",
    "provinceCode": "MC",
    "provinceName": "Macerata"
  },
  {
    "name": "Monte San Giusto",
    "provinceCode": "MC",
    "provinceName": "Macerata"
  },
  {
    "name": "Monte San Martino",
    "provinceCode": "MC",
    "provinceName": "Macerata"
  },
  {
    "name": "Montecassiano",
    "provinceCode": "MC",
    "provinceName": "Macerata"
  },
  {
    "name": "Montecosaro",
    "provinceCode": "MC",
    "provinceName": "Macerata"
  },
  {
    "name": "Montefano",
    "provinceCode": "MC",
    "provinceName": "Macerata"
  },
  {
    "name": "Montelupone",
    "provinceCode": "MC",
    "provinceName": "Macerata"
  },
  {
    "name": "Morrovalle",
    "provinceCode": "MC",
    "provinceName": "Macerata"
  },
  {
    "name": "Muccia",
    "provinceCode": "MC",
    "provinceName": "Macerata"
  },
  {
    "name": "Penna San Giovanni",
    "provinceCode": "MC",
    "provinceName": "Macerata"
  },
  {
    "name": "Petriolo",
    "provinceCode": "MC",
    "provinceName": "Macerata"
  },
  {
    "name": "Pieve Torina",
    "provinceCode": "MC",
    "provinceName": "Macerata"
  },
  {
    "name": "Pioraco",
    "provinceCode": "MC",
    "provinceName": "Macerata"
  },
  {
    "name": "Poggio San Vicino",
    "provinceCode": "MC",
    "provinceName": "Macerata"
  },
  {
    "name": "Pollenza",
    "provinceCode": "MC",
    "provinceName": "Macerata"
  },
  {
    "name": "Porto Recanati",
    "provinceCode": "MC",
    "provinceName": "Macerata"
  },
  {
    "name": "Potenza Picena",
    "provinceCode": "MC",
    "provinceName": "Macerata"
  },
  {
    "name": "Recanati",
    "provinceCode": "MC",
    "provinceName": "Macerata"
  },
  {
    "name": "Ripe San Ginesio",
    "provinceCode": "MC",
    "provinceName": "Macerata"
  },
  {
    "name": "San Ginesio",
    "provinceCode": "MC",
    "provinceName": "Macerata"
  },
  {
    "name": "San Severino Marche",
    "provinceCode": "MC",
    "provinceName": "Macerata"
  },
  {
    "name": "Sant'Angelo in Pontano",
    "provinceCode": "MC",
    "provinceName": "Macerata"
  },
  {
    "name": "Sarnano",
    "provinceCode": "MC",
    "provinceName": "Macerata"
  },
  {
    "name": "Sefro",
    "provinceCode": "MC",
    "provinceName": "Macerata"
  },
  {
    "name": "Serrapetrona",
    "provinceCode": "MC",
    "provinceName": "Macerata"
  },
  {
    "name": "Serravalle di Chienti",
    "provinceCode": "MC",
    "provinceName": "Macerata"
  },
  {
    "name": "Tolentino",
    "provinceCode": "MC",
    "provinceName": "Macerata"
  },
  {
    "name": "Treia",
    "provinceCode": "MC",
    "provinceName": "Macerata"
  },
  {
    "name": "Urbisaglia",
    "provinceCode": "MC",
    "provinceName": "Macerata"
  },
  {
    "name": "Ussita",
    "provinceCode": "MC",
    "provinceName": "Macerata"
  },
  {
    "name": "Valfornace",
    "provinceCode": "MC",
    "provinceName": "Macerata"
  },
  {
    "name": "Visso",
    "provinceCode": "MC",
    "provinceName": "Macerata"
  },
  {
    "name": "Acqualagna",
    "provinceCode": "PU",
    "provinceName": "Pesaro e Urbino"
  },
  {
    "name": "Apecchio",
    "provinceCode": "PU",
    "provinceName": "Pesaro e Urbino"
  },
  {
    "name": "Belforte all'Isauro",
    "provinceCode": "PU",
    "provinceName": "Pesaro e Urbino"
  },
  {
    "name": "Borgo Pace",
    "provinceCode": "PU",
    "provinceName": "Pesaro e Urbino"
  },
  {
    "name": "Cagli",
    "provinceCode": "PU",
    "provinceName": "Pesaro e Urbino"
  },
  {
    "name": "Cantiano",
    "provinceCode": "PU",
    "provinceName": "Pesaro e Urbino"
  },
  {
    "name": "Carpegna",
    "provinceCode": "PU",
    "provinceName": "Pesaro e Urbino"
  },
  {
    "name": "Cartoceto",
    "provinceCode": "PU",
    "provinceName": "Pesaro e Urbino"
  },
  {
    "name": "Colli al Metauro",
    "provinceCode": "PU",
    "provinceName": "Pesaro e Urbino"
  },
  {
    "name": "Fano",
    "provinceCode": "PU",
    "provinceName": "Pesaro e Urbino"
  },
  {
    "name": "Fermignano",
    "provinceCode": "PU",
    "provinceName": "Pesaro e Urbino"
  },
  {
    "name": "Fossombrone",
    "provinceCode": "PU",
    "provinceName": "Pesaro e Urbino"
  },
  {
    "name": "Fratte Rosa",
    "provinceCode": "PU",
    "provinceName": "Pesaro e Urbino"
  },
  {
    "name": "Frontino",
    "provinceCode": "PU",
    "provinceName": "Pesaro e Urbino"
  },
  {
    "name": "Frontone",
    "provinceCode": "PU",
    "provinceName": "Pesaro e Urbino"
  },
  {
    "name": "Gabicce Mare",
    "provinceCode": "PU",
    "provinceName": "Pesaro e Urbino"
  },
  {
    "name": "Gradara",
    "provinceCode": "PU",
    "provinceName": "Pesaro e Urbino"
  },
  {
    "name": "Isola del Piano",
    "provinceCode": "PU",
    "provinceName": "Pesaro e Urbino"
  },
  {
    "name": "Lunano",
    "provinceCode": "PU",
    "provinceName": "Pesaro e Urbino"
  },
  {
    "name": "Macerata Feltria",
    "provinceCode": "PU",
    "provinceName": "Pesaro e Urbino"
  },
  {
    "name": "Mercatello sul Metauro",
    "provinceCode": "PU",
    "provinceName": "Pesaro e Urbino"
  },
  {
    "name": "Mercatino Conca",
    "provinceCode": "PU",
    "provinceName": "Pesaro e Urbino"
  },
  {
    "name": "Mombaroccio",
    "provinceCode": "PU",
    "provinceName": "Pesaro e Urbino"
  },
  {
    "name": "Mondavio",
    "provinceCode": "PU",
    "provinceName": "Pesaro e Urbino"
  },
  {
    "name": "Mondolfo",
    "provinceCode": "PU",
    "provinceName": "Pesaro e Urbino"
  },
  {
    "name": "Monte Cerignone",
    "provinceCode": "PU",
    "provinceName": "Pesaro e Urbino"
  },
  {
    "name": "Monte Grimano Terme",
    "provinceCode": "PU",
    "provinceName": "Pesaro e Urbino"
  },
  {
    "name": "Monte Porzio",
    "provinceCode": "PU",
    "provinceName": "Pesaro e Urbino"
  },
  {
    "name": "Montecalvo in Foglia",
    "provinceCode": "PU",
    "provinceName": "Pesaro e Urbino"
  },
  {
    "name": "Montefelcino",
    "provinceCode": "PU",
    "provinceName": "Pesaro e Urbino"
  },
  {
    "name": "Montelabbate",
    "provinceCode": "PU",
    "provinceName": "Pesaro e Urbino"
  },
  {
    "name": "Peglio",
    "provinceCode": "PU",
    "provinceName": "Pesaro e Urbino"
  },
  {
    "name": "Pergola",
    "provinceCode": "PU",
    "provinceName": "Pesaro e Urbino"
  },
  {
    "name": "Pesaro",
    "provinceCode": "PU",
    "provinceName": "Pesaro e Urbino"
  },
  {
    "name": "Petriano",
    "provinceCode": "PU",
    "provinceName": "Pesaro e Urbino"
  },
  {
    "name": "Piandimeleto",
    "provinceCode": "PU",
    "provinceName": "Pesaro e Urbino"
  },
  {
    "name": "Pietrarubbia",
    "provinceCode": "PU",
    "provinceName": "Pesaro e Urbino"
  },
  {
    "name": "Piobbico",
    "provinceCode": "PU",
    "provinceName": "Pesaro e Urbino"
  },
  {
    "name": "San Costanzo",
    "provinceCode": "PU",
    "provinceName": "Pesaro e Urbino"
  },
  {
    "name": "San Lorenzo in Campo",
    "provinceCode": "PU",
    "provinceName": "Pesaro e Urbino"
  },
  {
    "name": "Sant'Angelo in Vado",
    "provinceCode": "PU",
    "provinceName": "Pesaro e Urbino"
  },
  {
    "name": "Sant'Ippolito",
    "provinceCode": "PU",
    "provinceName": "Pesaro e Urbino"
  },
  {
    "name": "Sassocorvaro Auditore",
    "provinceCode": "PU",
    "provinceName": "Pesaro e Urbino"
  },
  {
    "name": "Serra Sant'Abbondio",
    "provinceCode": "PU",
    "provinceName": "Pesaro e Urbino"
  },
  {
    "name": "Tavoleto",
    "provinceCode": "PU",
    "provinceName": "Pesaro e Urbino"
  },
  {
    "name": "Tavullia",
    "provinceCode": "PU",
    "provinceName": "Pesaro e Urbino"
  },
  {
    "name": "Terre Roveresche",
    "provinceCode": "PU",
    "provinceName": "Pesaro e Urbino"
  },
  {
    "name": "Urbania",
    "provinceCode": "PU",
    "provinceName": "Pesaro e Urbino"
  },
  {
    "name": "Urbino",
    "provinceCode": "PU",
    "provinceName": "Pesaro e Urbino"
  },
  {
    "name": "Vallefoglia",
    "provinceCode": "PU",
    "provinceName": "Pesaro e Urbino"
  }
]);

const MUNICIPALITY_ALIASES = new Map([
  ["camporotondo di f.", "Camporotondo di Fiastrone"],
  ["castelsantangelo sn", "Castelsantangelo sul Nera"],
  ["san benedetto del t.", "San Benedetto del Tronto"],
  ["santa vittoria in m.", "Santa Vittoria in Matenano"],
]);

export function normalizeMunicipalityName(value) {
  return String(value ?? "")
    .trim()
    .replace(/\\s*\\((AN|AP|FM|MC|PU)\\)\\s*$/i, "")
    .replace(/\\s+(AN|AP|FM|MC|PU)$/i, "")
    .normalize("NFD")
    .replace(/[\\u0300-\\u036f]/g, "")
    .replace(/[’`]/g, "'")
    .replace(/[.]/g, "")
    .replace(/\\s+/g, " ")
    .toLocaleLowerCase("it");
}

const MUNICIPALITY_LOOKUP = new Map(
  MARCHE_MUNICIPALITIES.map((item) => [normalizeMunicipalityName(item.name), item]),
);

export function getMunicipalityInfo(value) {
  const normalized = normalizeMunicipalityName(value);
  if (!normalized) return null;
  const alias = MUNICIPALITY_ALIASES.get(normalized);
  return MUNICIPALITY_LOOKUP.get(normalizeMunicipalityName(alias || value)) || null;
}

export function canonicalMunicipalityName(value) {
  return getMunicipalityInfo(value)?.name || String(value ?? "").trim();
}
