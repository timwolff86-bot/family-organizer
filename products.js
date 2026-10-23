// Einkaufs-Kategorien in der Reihenfolge eines typischen Supermarkt-Rundgangs
// und der Start-Katalog an Produkten. Der Katalog wird beim ersten Start in die
// Datenbank (Tabelle "products") geschrieben und lernt dort dazu.

export const CATEGORIES = [
  { id: 'obst', icon: '🍎', label: 'Obst & Gemüse' },
  { id: 'brot', icon: '🥖', label: 'Brot & Backwaren' },
  { id: 'kuehl', icon: '🧀', label: 'Milch, Käse & Eier' },
  { id: 'fleisch', icon: '🥩', label: 'Fleisch, Wurst & Fisch' },
  { id: 'tiefkuehl', icon: '🧊', label: 'Tiefkühl' },
  { id: 'vorrat', icon: '🍝', label: 'Nudeln, Reis & Konserven' },
  { id: 'backen', icon: '🧂', label: 'Backen, Gewürze & Öl' },
  { id: 'fruehstueck', icon: '🥣', label: 'Frühstück, Kaffee & Tee' },
  { id: 'suess', icon: '🍫', label: 'Süßes & Snacks' },
  { id: 'getraenke', icon: '🥤', label: 'Getränke' },
  { id: 'drogerie', icon: '🧴', label: 'Drogerie & Baby' },
  { id: 'haushalt', icon: '🧽', label: 'Haushalt & Putzen' },
  { id: 'sonstiges', icon: '🛒', label: 'Sonstiges' },
];

const LIST = {
  obst: `Apfel, Äpfel, Birne, Birnen, Banane, Bananen, Weintrauben, Trauben, Orange, Orangen, Mandarine, Mandarinen,
    Clementinen, Zitrone, Zitronen, Limette, Limetten, Kiwi, Kiwis, Mango, Ananas, Melone, Wassermelone, Erdbeeren,
    Himbeeren, Heidelbeeren, Blaubeeren, Brombeeren, Johannisbeeren, Kirschen, Pflaumen, Zwetschgen, Pfirsich, Pfirsiche,
    Nektarinen, Aprikosen, Granatapfel, Avocado, Avocados, Obst, Tomate, Tomaten, Cherrytomaten, Rispentomaten,
    Gurke, Gurken, Salatgurke, Paprika, Zucchini, Aubergine, Auberginen, Karotte, Karotten, Möhre, Möhren, Kartoffel,
    Kartoffeln, Süßkartoffel, Süßkartoffeln, Zwiebel, Zwiebeln, Rote Zwiebeln, Frühlingszwiebeln, Lauchzwiebeln,
    Knoblauch, Ingwer, Lauch, Porree, Sellerie, Staudensellerie, Brokkoli, Blumenkohl, Rosenkohl, Weißkohl, Rotkohl,
    Wirsing, Kohlrabi, Spinat, Blattspinat, Salat, Eisbergsalat, Kopfsalat, Feldsalat, Rucola, Romanasalat, Pilze,
    Champignons, Radieschen, Rote Bete, Spargel, Mais, Maiskolben, Kürbis, Hokkaido, Fenchel, Erbsen, Bohnen,
    Grüne Bohnen, Petersilie, Schnittlauch, Basilikum, Dill, Koriander, Minze, Kräuter, Gemüse, Suppengrün`,
  brot: `Brot, Brötchen, Toast, Toastbrot, Vollkornbrot, Baguette, Ciabatta, Laugenbrezel, Brezel, Brezeln,
    Croissant, Croissants, Aufbackbrötchen, Knäckebrot, Zwieback, Kuchen, Muffins, Wraps, Tortillas, Burgerbrötchen,
    Hotdog-Brötchen, Pita, Fladenbrot, Hefezopf, Rosinenbrötchen, Laugenbrötchen`,
  kuehl: `Milch, Vollmilch, Fettarme Milch, H-Milch, Hafermilch, Haferdrink, Sojamilch, Mandelmilch, Butter,
    Margarine, Joghurt, Naturjoghurt, Griechischer Joghurt, Quark, Magerquark, Skyr, Sahne, Schlagsahne, Saure Sahne,
    Schmand, Crème fraîche, Frischkäse, Käse, Gouda, Emmentaler, Mozzarella, Parmesan, Feta, Hirtenkäse, Camembert,
    Reibekäse, Streukäse, Scheibenkäse, Halloumi, Hüttenkäse, Mascarpone, Ricotta, Ei, Eier, Pudding, Milchreis,
    Grießbrei, Kefir, Buttermilch, Kakao-Drink, Fruchtzwerge, Trinkjoghurt, Tofu, Hummus, Pesto, Frischhefe,
    Blätterteig, Pizzateig, Gnocchi, Tortellini, Frische Pasta, Kräuterbutter, Dessert`,
  fleisch: `Fleisch, Hackfleisch, Hack, Rinderhack, Gemischtes Hack, Hähnchen, Hähnchenbrust, Hähnchenschenkel,
    Hühnchen, Putenbrust, Pute, Schnitzel, Steak, Rindfleisch, Schweinefleisch, Gulasch, Bratwurst, Bratwürste,
    Würstchen, Wiener, Frankfurter, Wurst, Aufschnitt, Salami, Schinken, Kochschinken, Lachsschinken, Speck,
    Schinkenwürfel, Mortadella, Leberwurst, Fleischwurst, Lyoner, Chorizo, Frikadellen, Cevapcici, Fisch, Lachs,
    Räucherlachs, Thunfischsteak, Garnelen, Forelle, Kabeljau, Vegetarische Würstchen, Veggie-Burger, Burger Patties,
    Hähnchenbrustfilet, Geflügelwurst`,
  tiefkuehl: `Tiefkühlpizza, Pizza, Pommes, Pommes frites, Kroketten, Fischstäbchen, Rahmspinat, Tiefkühlgemüse,
    Erbsen tiefgekühlt, Beerenmischung, Tiefkühlbeeren, Eis, Eiscreme, Speiseeis, Stieleis, Eiswürfel, Kräuter tiefgekühlt,
    Baguettes tiefgekühlt, Chicken Nuggets, Nuggets, Lasagne, Flammkuchen, Rösti, Kaisergemüse, Buttergemüse`,
  vorrat: `Nudeln, Spaghetti, Penne, Fusilli, Spirelli, Farfalle, Makkaroni, Lasagneplatten, Bandnudeln, Reis,
    Basmatireis, Jasminreis, Risottoreis, Couscous, Bulgur, Quinoa, Linsen, Rote Linsen, Kichererbsen, Kidneybohnen,
    Weiße Bohnen, Dosentomaten, Passierte Tomaten, Tomaten passiert, Stückige Tomaten, Tomatenmark, Dosenmais,
    Thunfisch, Ravioli, Suppe, Brühe, Gemüsebrühe, Hühnerbrühe, Fertiggericht, Tütensuppe, Instantnudeln, Ketchup,
    Mayonnaise, Mayo, Senf, Remoulade, Grillsoße, Barbecuesoße, Sojasoße, Sojasauce, Pastasoße, Tomatensoße,
    Kartoffelpüree, Semmelbrösel, Paniermehl, Gewürzgurken, Essiggurken, Oliven, Kapern, Apfelmus,
    Sauerkraut, Kokosmilch, Currypaste, Tortilla Chips`,
  backen: `Mehl, Weizenmehl, Dinkelmehl, Zucker, Puderzucker, Brauner Zucker, Vanillezucker, Backpulver, Hefe,
    Trockenhefe, Natron, Speisestärke, Stärke, Kakaopulver, Backkakao, Schokotropfen, Kuvertüre, Streusel, Mandeln,
    Gemahlene Mandeln, Haselnüsse, Walnüsse, Rosinen, Salz, Meersalz, Pfeffer, Paprikapulver, Curry, Currypulver,
    Zimt, Muskat, Oregano, Thymian, Rosmarin, Chili, Chiliflocken, Kreuzkümmel, Gewürze, Gewürz, Öl, Olivenöl,
    Sonnenblumenöl, Rapsöl, Bratöl, Essig, Balsamico, Apfelessig, Kokosöl, Honig, Sirup, Ahornsirup, Gelatine,
    Puddingpulver, Tortenguss`,
  fruehstueck: `Müsli, Haferflocken, Cornflakes, Cerealien, Granola, Marmelade, Konfitüre, Nutella, Nussnougatcreme,
    Erdnussbutter, Brotaufstrich, Kaffee, Kaffeebohnen, Kaffeepads, Kaffeekapseln, Espresso, Instantkaffee, Tee,
    Schwarzer Tee, Grüner Tee, Pfefferminztee, Kräutertee, Früchtetee, Kakao, Kaba, Kaffeesahne, Kondensmilch`,
  suess: `Schokolade, Kinderschokolade, Gummibärchen, Haribo, Kekse, Butterkekse, Chips, Kartoffelchips, Salzstangen,
    Flips, Erdnussflips, Erdnüsse, Nüsse, Studentenfutter, Cracker, Popcorn, Süßigkeiten, Bonbons, Kaugummi,
    Müsliriegel, Riegel, Schokoriegel, Waffeln, Lebkuchen, Spekulatius, Zwieback Kinder, Reiswaffeln, Pralinen`,
  getraenke: `Wasser, Mineralwasser, Sprudel, Wasser still, Stilles Wasser, Wasser medium, Saft, Apfelsaft, Orangensaft,
    Multivitaminsaft, Traubensaft, Apfelschorle, Schorle, Limonade, Limo, Cola, Cola Zero, Fanta, Sprite, Spezi,
    Eistee, Bier, Alkoholfreies Bier, Radler, Wein, Rotwein, Weißwein, Rosé, Sekt, Prosecco, Sirup Getränk,
    Energydrink, Tonic Water, Malzbier, Kakao Getränk`,
  drogerie: `Zahnpasta, Zahncreme, Kinderzahnpasta, Zahnbürste, Zahnbürsten, Zahnseide, Mundspülung, Shampoo,
    Duschgel, Seife, Flüssigseife, Handseife, Deo, Deodorant, Creme, Bodylotion, Sonnencreme, Rasierer, Rasierschaum,
    Rasiergel, Toilettenpapier, Klopapier, Feuchtes Toilettenpapier, Taschentücher, Wattepads, Wattestäbchen,
    Windeln, Feuchttücher, Binden, Tampons, Slipeinlagen, Haargummis, Pflaster, Lippenpflege, Labello, Haarspülung,
    Spülung, Haargel, Kinder Shampoo, Babyöl, Wundschutzcreme`,
  haushalt: `Spülmittel, Geschirrspültabs, Spülmaschinentabs, Tabs, Klarspüler, Spülmaschinensalz, Waschmittel,
    Flüssigwaschmittel, Colorwaschmittel, Weichspüler, Allzweckreiniger, Badreiniger, Glasreiniger, WC-Reiniger,
    Kloreiniger, Entkalker, Schwämme, Spülschwamm, Putzlappen, Mikrofasertücher, Küchenrolle, Küchenpapier,
    Müllbeutel, Mülltüten, Gefrierbeutel, Frischhaltefolie, Alufolie, Backpapier, Servietten, Batterien,
    Glühbirne, Kerzen, Teelichter, Zahnstocher, Grillkohle, Streichhölzer, Feuerzeug, Gefrierdosen`,
};

// Start-Katalog als { key, name, category }, ohne doppelte Schlüssel
export function seedProducts() {
  const seen = new Set();
  const out = [];
  for (const [category, text] of Object.entries(LIST)) {
    for (const raw of text.split(',')) {
      const name = raw.trim();
      const key = normalize(name);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push({ key, name, category });
    }
  }
  return out;
}

// Häufige Artikel, falls noch nichts gekauft wurde
export const QUICK_DEFAULTS = ['Milch', 'Brot', 'Eier', 'Butter', 'Käse', 'Bananen', 'Äpfel', 'Wasser', 'Toilettenpapier', 'Nudeln'];

const UNITS =
  'x|stk|stück|st|kg|g|gr|l|ml|liter|pck|pack|packung|packungen|pkg|fl|flasche|flaschen|kiste|kisten|kasten|dose|dosen|becher|bund|netz|beutel|glas|gläser|tüte|tüten|rolle|rollen|großpackung|groß|klein|große|kleine|grosse';
const UNIT_RE = new RegExp(`(^|\\s)(${UNITS})(?=\\s|$)`, 'g');

// "2 kg Äpfel (bio)" → "äpfel bio"
export function normalize(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[0-9]+([.,][0-9]+)?\s*%?/g, ' ')
    .replace(/[^a-zäöüß\s-]/g, ' ')
    .replace(UNIT_RE, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Kategorie zu einem eingegebenen Namen finden.
// products: Liste aus der Datenbank ({ key, category }).
export function classify(name, products) {
  const n = normalize(name);
  if (!n) return 'sonstiges';
  const map = new Map(products.map((p) => [p.key, p.category]));
  if (map.has(n)) return map.get(n);

  const words = n.split(/[\s-]+/).filter(Boolean);
  // Deutsch: das Hauptwort steht meist hinten ("Bio Vollmilch" → "vollmilch")
  for (let i = words.length - 1; i >= 0; i--) if (map.has(words[i])) return map.get(words[i]);

  // Zusammengesetzte Wörter: "Erdbeerjoghurt" endet auf "joghurt"
  for (let i = words.length - 1; i >= 0; i--) {
    let best = null;
    for (const [key, cat] of map) {
      if (key.length >= 3 && !key.includes(' ') && words[i].endsWith(key) && (!best || key.length > best.key.length)) {
        best = { key, cat };
      }
    }
    if (best) return best.cat;
  }
  return 'sonstiges';
}

export const categoryOf = (id) => CATEGORIES.find((c) => c.id === id) || CATEGORIES[CATEGORIES.length - 1];
