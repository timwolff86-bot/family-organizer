// Kochbuch: Kategorien und Start-Rezepte (für 4 Personen).
// Die Rezepte werden beim ersten Start in die Datenbank (Tabelle "recipes") geschrieben
// und können dort bearbeitet, ergänzt oder gelöscht werden.
// Zutaten: eine Zeile pro Zutat, Menge vorne – so landen sie direkt auf der Einkaufsliste.

export const RECIPE_CATEGORIES = [
  { id: 'nudeln', label: 'Nudeln', emoji: '🍝' },
  { id: 'fleisch', label: 'Fleisch', emoji: '🥩' },
  { id: 'gefluegel', label: 'Geflügel', emoji: '🍗' },
  { id: 'fisch', label: 'Fisch', emoji: '🐟' },
  { id: 'vegetarisch', label: 'Vegetarisch', emoji: '🥦' },
  { id: 'suppe', label: 'Suppe & Eintopf', emoji: '🍲' },
  { id: 'suess', label: 'Süße Hauptgerichte', emoji: '🥞' },
  { id: 'schnell', label: 'Schnell & einfach', emoji: '⚡' },
  { id: 'sonstiges', label: 'Sonstiges', emoji: '🍽️' },
];

export const recipeCategory = (id) =>
  RECIPE_CATEGORIES.find((c) => c.id === id) || RECIPE_CATEGORIES[RECIPE_CATEGORIES.length - 1];

// Zutaten, die meist im Haus sind – werden beim Einkaufen nicht vorausgewählt
export const STAPLES = new Set([
  'salz', 'pfeffer', 'öl', 'olivenöl', 'sonnenblumenöl', 'rapsöl', 'bratöl', 'zucker', 'wasser',
  'paprikapulver', 'oregano', 'zimt', 'muskat', 'curry', 'currypulver', 'gemüsebrühe', 'brühe', 'und',
]);

const r = (title, category, minutes, emoji, ingredients, steps) => ({
  title,
  category,
  minutes,
  servings: 4,
  emoji,
  ingredients: ingredients.trim().split('\n').map((s) => s.trim()).filter(Boolean),
  steps: steps.trim().split('\n').map((s) => s.trim()).filter(Boolean).join('\n'),
});

export const SEED_RECIPES = [
  r('Spaghetti Bolognese', 'nudeln', 40, '🍝', `
    500 g Spaghetti
    500 g Rinderhack
    1 Zwiebel
    1 Knoblauchzehe
    2 Karotten
    1 Dose stückige Tomaten
    2 EL Tomatenmark
    Parmesan
    Olivenöl
    Salz & Pfeffer`, `
    Zwiebel, Knoblauch und Karotten fein würfeln.
    Hack in Öl krümelig braten, Gemüse dazugeben und kurz mitbraten.
    Tomatenmark kurz anrösten, Tomaten dazu, 20 Min. köcheln lassen. Würzen.
    Spaghetti nach Packung kochen, mit Soße und Parmesan servieren.`),
  r('Nudeln mit Tomatensoße', 'nudeln', 20, '🍅', `
    500 g Nudeln
    1 Dose passierte Tomaten
    1 Zwiebel
    1 Knoblauchzehe
    Basilikum
    Parmesan
    Olivenöl
    Salz & Pfeffer`, `
    Zwiebel und Knoblauch würfeln und in Öl glasig dünsten.
    Passierte Tomaten dazugeben, 10 Min. köcheln, mit Salz, Pfeffer und Basilikum abschmecken.
    Nudeln kochen und mit der Soße und Parmesan servieren.`),
  r('Nudelauflauf mit Schinken', 'nudeln', 45, '🧀', `
    400 g Penne
    200 g Kochschinken
    200 ml Sahne
    200 ml Milch
    3 Eier
    200 g Reibekäse
    Salz & Pfeffer
    Muskat`, `
    Ofen auf 200 °C vorheizen. Nudeln 2 Min. kürzer als angegeben kochen.
    Schinken würfeln. Sahne, Milch und Eier verquirlen, würzen.
    Nudeln und Schinken in eine Auflaufform, Eiermilch darüber, mit Käse bestreuen.
    25 Min. backen, bis der Käse goldbraun ist.`),
  r('Lasagne', 'nudeln', 75, '🍝', `
    1 Packung Lasagneplatten
    500 g Gemischtes Hack
    1 Zwiebel
    1 Dose passierte Tomaten
    2 EL Tomatenmark
    50 g Butter
    50 g Mehl
    500 ml Milch
    150 g Reibekäse
    Salz & Pfeffer
    Muskat`, `
    Hack mit Zwiebel anbraten, Tomatenmark und Tomaten dazu, 15 Min. köcheln, würzen.
    Für die Béchamel Butter schmelzen, Mehl einrühren, nach und nach Milch dazu, aufkochen, mit Salz und Muskat würzen.
    In einer Form abwechselnd Soße, Platten und Béchamel schichten, mit Käse abschließen.
    Bei 180 °C ca. 40 Min. backen.`),
  r('Tortellini in Sahnesoße', 'nudeln', 15, '🥟', `
    2 Packungen Tortellini
    200 ml Sahne
    150 g Kochschinken
    100 g Erbsen
    Parmesan
    Salz & Pfeffer`, `
    Tortellini nach Packung kochen.
    Schinken würfeln und kurz anbraten, Erbsen und Sahne dazugeben, aufkochen.
    Tortellini unterheben, mit Parmesan, Salz und Pfeffer abschmecken.`),
  r('Pasta mit Pesto', 'schnell', 15, '🌿', `
    500 g Nudeln
    1 Glas Pesto
    250 g Cherrytomaten
    Parmesan`, `
    Nudeln kochen, etwas Kochwasser aufheben.
    Tomaten halbieren.
    Nudeln mit Pesto, einem Schuss Kochwasser und Tomaten mischen, mit Parmesan servieren.`),
  r('Gnocchi mit Tomaten und Mozzarella', 'vegetarisch', 25, '🧀', `
    800 g Gnocchi
    1 Dose stückige Tomaten
    2 Mozzarella
    1 Zwiebel
    Basilikum
    Olivenöl
    Salz & Pfeffer`, `
    Ofen auf 200 °C vorheizen. Zwiebel würfeln und in Öl andünsten, Tomaten dazu, würzen.
    Gnocchi roh mit der Soße in eine Auflaufform geben, Mozzarella darauf zupfen.
    15–20 Min. backen, mit Basilikum servieren.`),
  r('Käsespätzle', 'vegetarisch', 30, '🧀', `
    500 g Spätzle
    250 g Bergkäse
    3 Zwiebeln
    30 g Butter
    Schnittlauch
    Salz & Pfeffer`, `
    Zwiebeln in Ringe schneiden und in Butter goldbraun braten.
    Spätzle kochen bzw. erhitzen.
    Spätzle und geriebenen Käse schichtweise in eine Form geben, kurz im Ofen schmelzen lassen.
    Mit Röstzwiebeln und Schnittlauch servieren.`),
  r('Pfannkuchen', 'suess', 30, '🥞', `
    250 g Mehl
    500 ml Milch
    4 Eier
    1 Prise Salz
    Butter
    Apfelmus
    Zucker`, `
    Mehl, Milch, Eier und Salz glatt rühren, 10 Min. quellen lassen.
    Etwas Butter in der Pfanne erhitzen, dünn Teig hineingeben, von beiden Seiten goldbraun backen.
    Mit Apfelmus oder Zucker servieren.`),
  r('Kaiserschmarrn', 'suess', 30, '🥞', `
    200 g Mehl
    400 ml Milch
    5 Eier
    40 g Zucker
    50 g Butter
    Puderzucker
    Apfelmus`, `
    Eier trennen. Eigelb mit Mehl, Milch und der Hälfte des Zuckers verrühren.
    Eiweiß mit dem restlichen Zucker steif schlagen und unterheben.
    In Butter in einer großen Pfanne backen, wenden, mit zwei Gabeln zerreißen.
    Mit Puderzucker bestäuben, mit Apfelmus servieren.`),
  r('Milchreis', 'suess', 40, '🍚', `
    250 g Milchreis
    1 l Milch
    2 EL Zucker
    1 Päckchen Vanillezucker
    Zimt & Zucker
    Apfelmus`, `
    Milch mit Zucker und Vanillezucker aufkochen, Reis einrühren.
    Bei kleiner Hitze 30 Min. unter gelegentlichem Rühren quellen lassen.
    Mit Zimt und Zucker oder Apfelmus servieren.`),
  r('Fischstäbchen mit Kartoffelpüree', 'fisch', 30, '🐟', `
    1 Packung Fischstäbchen
    1 kg Kartoffeln
    200 ml Milch
    30 g Butter
    300 g Erbsen tiefgekühlt
    Salz
    Muskat`, `
    Kartoffeln schälen und in Salzwasser 20 Min. kochen.
    Fischstäbchen nach Packung im Ofen oder in der Pfanne zubereiten.
    Kartoffeln mit warmer Milch und Butter stampfen, mit Salz und Muskat würzen.
    Erbsen kurz kochen und alles zusammen servieren.`),
  r('Lachs mit Brokkoli und Reis', 'fisch', 30, '🍣', `
    4 Lachsfilets
    300 g Reis
    1 Brokkoli
    1 Zitrone
    Olivenöl
    Salz & Pfeffer`, `
    Reis nach Packung kochen.
    Brokkoli in Röschen teilen und 5 Min. dämpfen oder kochen.
    Lachs salzen und in Öl je Seite 3–4 Min. braten, mit Zitrone beträufeln.`),
  r('Hähnchen-Curry mit Reis', 'gefluegel', 35, '🍛', `
    600 g Hähnchenbrust
    300 g Basmatireis
    1 Dose Kokosmilch
    1 Zwiebel
    2 Paprika
    2 EL Currypulver
    1 Stück Ingwer
    Öl
    Salz`, `
    Reis kochen. Hähnchen in Würfel schneiden, Zwiebel und Paprika klein schneiden.
    Hähnchen in Öl anbraten, Zwiebel, Paprika und geriebenen Ingwer dazu.
    Curry kurz mitrösten, mit Kokosmilch ablöschen, 10 Min. köcheln, salzen.`),
  r('Hähnchenschenkel aus dem Ofen', 'gefluegel', 60, '🍗', `
    8 Hähnchenschenkel
    1 kg Kartoffeln
    2 Paprika
    2 Zwiebeln
    Rosmarin
    Paprikapulver
    Olivenöl
    Salz & Pfeffer`, `
    Ofen auf 200 °C vorheizen.
    Kartoffeln vierteln, Paprika und Zwiebeln grob schneiden, mit Öl und Gewürzen mischen.
    Hähnchenschenkel würzen und auf das Gemüse legen.
    Ca. 45 Min. backen, bis die Haut knusprig ist.`),
  r('Chicken Nuggets mit Ofenpommes', 'schnell', 30, '🍟', `
    1 Packung Chicken Nuggets
    1 Packung Pommes
    1 Salatgurke
    Ketchup`, `
    Nuggets und Pommes nach Packung im Ofen backen.
    Gurke in Scheiben oder Sticks schneiden und dazu reichen.`),
  r('Frikadellen mit Kartoffelpüree', 'fleisch', 45, '🍖', `
    500 g Gemischtes Hack
    1 Brötchen vom Vortag
    1 Ei
    1 Zwiebel
    1 TL Senf
    1 kg Kartoffeln
    200 ml Milch
    30 g Butter
    Salz & Pfeffer`, `
    Brötchen einweichen und ausdrücken. Mit Hack, Ei, gewürfelter Zwiebel, Senf, Salz und Pfeffer verkneten.
    Frikadellen formen und in Öl von beiden Seiten je 5–6 Min. braten.
    Kartoffeln kochen und mit Milch und Butter zu Püree stampfen.`),
  r('Schnitzel mit Kartoffelsalat', 'fleisch', 50, '🥩', `
    4 Schnitzel
    2 Eier
    100 g Mehl
    150 g Paniermehl
    1 kg Kartoffeln
    1 Zwiebel
    250 ml Gemüsebrühe
    3 EL Essig
    Öl
    1 Zitrone
    Salz & Pfeffer`, `
    Kartoffeln kochen, pellen und in Scheiben schneiden. Mit gewürfelter Zwiebel, warmer Brühe, Essig, Öl, Salz und Pfeffer mischen und ziehen lassen.
    Schnitzel flach klopfen, würzen, in Mehl, verquirltem Ei und Paniermehl wenden.
    In reichlich Öl goldbraun ausbacken, mit Zitrone servieren.`),
  r('Chili con Carne', 'fleisch', 45, '🌶️', `
    500 g Rinderhack
    1 Zwiebel
    2 Knoblauchzehen
    1 Paprika
    1 Dose Kidneybohnen
    1 Dose Mais
    1 Dose stückige Tomaten
    2 EL Tomatenmark
    1 TL Kreuzkümmel
    Chili
    Saure Sahne
    Baguette
    Salz & Pfeffer`, `
    Hack anbraten, Zwiebel, Knoblauch und Paprika gewürfelt dazugeben.
    Tomatenmark und Gewürze kurz mitrösten, Tomaten dazu, 20 Min. köcheln.
    Bohnen und Mais abgießen, unterrühren, nochmal 5 Min. köcheln.
    Mit saurer Sahne und Baguette servieren.`),
  r('Gulasch mit Nudeln', 'fleisch', 120, '🍲', `
    800 g Rindergulasch
    500 g Zwiebeln
    2 EL Paprikapulver
    2 EL Tomatenmark
    500 ml Rinderbrühe
    500 g Bandnudeln
    Öl
    Salz & Pfeffer`, `
    Fleisch portionsweise in Öl scharf anbraten.
    Zwiebeln in Streifen dazugeben und weich braten, Tomatenmark und Paprikapulver kurz mitrösten.
    Mit Brühe ablöschen und zugedeckt ca. 1,5 Std. schmoren lassen.
    Nudeln kochen und mit dem Gulasch servieren.`),
  r('Burger', 'fleisch', 30, '🍔', `
    4 Burgerbrötchen
    500 g Rinderhack
    4 Scheiben Cheddar
    1 Tomate
    1 Eisbergsalat
    1 Zwiebel
    Gewürzgurken
    Ketchup
    Salz & Pfeffer`, `
    Hack würzen und zu 4 flachen Patties formen.
    In der Pfanne oder auf dem Grill je Seite 3–4 Min. braten, zum Schluss Käse auflegen.
    Brötchen kurz rösten und mit Salat, Tomate, Zwiebel, Gurken und Ketchup belegen.`),
  r('Hot Dogs', 'schnell', 15, '🌭', `
    8 Hotdog-Brötchen
    8 Wiener Würstchen
    Röstzwiebeln
    Gewürzgurken
    Ketchup
    Senf`, `
    Würstchen in heißem Wasser 5 Min. ziehen lassen.
    Brötchen kurz aufbacken, Würstchen hineinlegen.
    Mit Röstzwiebeln, Gurken, Ketchup und Senf belegen.`),
  r('Wraps mit Hähnchen', 'gefluegel', 25, '🌯', `
    8 Wraps
    400 g Hähnchenbrust
    1 Eisbergsalat
    2 Tomaten
    1 Salatgurke
    150 g Reibekäse
    200 g Saure Sahne
    Paprikapulver
    Salz & Pfeffer`, `
    Hähnchen in Streifen schneiden, würzen und anbraten.
    Gemüse klein schneiden.
    Wraps kurz erwärmen, jeder belegt sich selbst mit Hähnchen, Gemüse, Käse und saurer Sahne.`),
  r('Pizza vom Blech', 'vegetarisch', 45, '🍕', `
    1 Pizzateig
    1 Dose passierte Tomaten
    2 Mozzarella
    150 g Salami
    1 Paprika
    100 g Champignons
    Oregano
    Salz`, `
    Ofen auf 220 °C vorheizen. Teig auf dem Blech ausrollen.
    Mit gewürzten Tomaten bestreichen und nach Lust belegen.
    Ca. 15 Min. backen.`),
  r('Flammkuchen', 'schnell', 25, '🫓', `
    1 Flammkuchenteig
    200 g Schmand
    150 g Schinkenwürfel
    2 Zwiebeln
    Salz & Pfeffer`, `
    Ofen auf 220 °C vorheizen, Teig auf dem Blech ausbreiten.
    Schmand würzen und aufstreichen, mit Zwiebelringen und Schinkenwürfeln belegen.
    10–12 Min. knusprig backen.`),
  r('Ofengemüse mit Feta', 'vegetarisch', 40, '🥕', `
    1 kg Kartoffeln
    2 Paprika
    2 Zucchini
    1 Zwiebel
    200 g Feta
    Rosmarin
    Olivenöl
    Salz & Pfeffer`, `
    Ofen auf 200 °C vorheizen.
    Gemüse in mundgerechte Stücke schneiden, mit Öl, Salz, Pfeffer und Rosmarin mischen.
    30 Min. backen, Feta darüber bröseln und weitere 5 Min. backen.`),
  r('Gemüse-Reispfanne', 'vegetarisch', 30, '🍚', `
    300 g Reis
    2 Paprika
    1 Zucchini
    2 Karotten
    200 g Erbsen
    3 Eier
    3 EL Sojasoße
    Öl`, `
    Reis kochen (am besten schon am Vortag).
    Gemüse klein schneiden und in Öl kräftig anbraten.
    Reis dazugeben und mitbraten, Eier darüber schlagen und unterrühren.
    Mit Sojasoße abschmecken.`),
  r('Bratkartoffeln mit Spiegelei', 'schnell', 30, '🍳', `
    1 kg Kartoffeln
    1 Zwiebel
    100 g Speckwürfel
    8 Eier
    Schnittlauch
    Öl
    Salz & Pfeffer`, `
    Gekochte Kartoffeln (gern vom Vortag) in Scheiben schneiden.
    In Öl mit Speck und Zwiebeln langsam knusprig braten, würzen.
    Spiegeleier braten und mit Schnittlauch servieren.`),
  r('Rührei mit Brot', 'schnell', 10, '🍳', `
    8 Eier
    100 ml Milch
    Schnittlauch
    Butter
    1 Brot
    Salz & Pfeffer`, `
    Eier mit Milch, Salz und Pfeffer verquirlen.
    In Butter bei mittlerer Hitze langsam stocken lassen.
    Mit Schnittlauch und Brot servieren.`),
  r('Kartoffelsuppe mit Würstchen', 'suppe', 40, '🥔', `
    1 kg Kartoffeln
    2 Karotten
    1 Stange Lauch
    1 Zwiebel
    1 l Gemüsebrühe
    4 Wiener Würstchen
    100 ml Sahne
    Majoran
    Salz & Pfeffer`, `
    Gemüse schälen und würfeln, Zwiebel in etwas Öl andünsten.
    Kartoffeln, Karotten und Lauch dazu, mit Brühe auffüllen und 20 Min. kochen.
    Teilweise pürieren, Sahne dazu, mit Majoran, Salz und Pfeffer abschmecken.
    Würstchen in Scheiben darin erwärmen.`),
  r('Tomatensuppe', 'suppe', 25, '🍅', `
    2 Dosen passierte Tomaten
    1 Zwiebel
    1 Knoblauchzehe
    500 ml Gemüsebrühe
    100 ml Sahne
    Basilikum
    Baguette
    Salz & Pfeffer`, `
    Zwiebel und Knoblauch andünsten, Tomaten und Brühe dazugeben.
    15 Min. köcheln, Sahne einrühren, abschmecken.
    Mit Basilikum und Baguette servieren.`),
  r('Linsensuppe', 'suppe', 45, '🍲', `
    250 g Linsen
    2 Karotten
    2 Kartoffeln
    1 Zwiebel
    1 Stange Lauch
    1,5 l Gemüsebrühe
    4 Wiener Würstchen
    2 EL Essig
    Salz & Pfeffer`, `
    Gemüse würfeln, Zwiebel andünsten.
    Linsen, Gemüse und Brühe dazugeben und 30 Min. köcheln lassen.
    Würstchen in Scheiben darin erwärmen, mit Essig, Salz und Pfeffer abschmecken.`),
  r('Kürbissuppe', 'suppe', 35, '🎃', `
    1 Hokkaido
    2 Kartoffeln
    1 Zwiebel
    1 Stück Ingwer
    1 l Gemüsebrühe
    200 ml Kokosmilch
    Kürbiskerne
    Salz & Pfeffer`, `
    Kürbis entkernen und mit Schale würfeln, Kartoffeln und Zwiebel würfeln.
    Zwiebel und Ingwer andünsten, Gemüse und Brühe dazu, 20 Min. kochen.
    Fein pürieren, Kokosmilch einrühren, abschmecken, mit Kürbiskernen servieren.`),
  r('Chili sin Carne', 'vegetarisch', 40, '🌶️', `
    1 Dose Kidneybohnen
    1 Dose Schwarze Bohnen
    1 Dose Mais
    1 Dose stückige Tomaten
    1 Zwiebel
    2 Paprika
    1 Süßkartoffel
    1 TL Kreuzkümmel
    Chili
    Reis
    Salz & Pfeffer`, `
    Zwiebel, Paprika und Süßkartoffel würfeln und anbraten.
    Gewürze kurz mitrösten, Tomaten dazu, 15 Min. köcheln.
    Bohnen und Mais dazugeben, weitere 10 Min. köcheln. Mit Reis servieren.`),
  r('Spinat mit Ei und Kartoffeln', 'vegetarisch', 30, '🥬', `
    1 Packung Rahmspinat
    1 kg Kartoffeln
    8 Eier
    Salz`, `
    Kartoffeln kochen.
    Eier 8 Min. hart kochen, abschrecken und pellen.
    Rahmspinat erhitzen und mit Kartoffeln und halbierten Eiern servieren.`),
];
