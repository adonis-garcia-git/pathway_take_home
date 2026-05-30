// Pinned seed data for the headless demo run.
//
// Restaurant: Frankies 457 Spuntino — a real Italian restaurant on Court St
// in Carroll Gardens, Brooklyn. The menu text below is a representative
// transcription in the style of their published menu; see docs/source.md
// for the snapshot URL and capture metadata. It is fed verbatim to the
// real Claude parser so the parse_menu stage exercises live LLM extraction.

export const FRANKIES_457 = {
  externalId: "demo:frankies-457",
  name: "Frankies 457 Spuntino",
  address: "457 Court St, Brooklyn, NY 11231",
  // Approximate Carroll Gardens lat/lng; real geocoding is out of scope.
  lat: 40.6774,
  lng: -73.9986,
  sourceType: "text" as const,
  sourceUrl: "https://frankies457.com/menu",
  // Hand-curated menu in the style of the restaurant. Anthropic still parses
  // this as if it were any user-provided text input.
  rawSource: `FRANKIES 457 SPUNTINO — Dinner

ANTIPASTI
· House meatballs in tomato sauce — beef & pork, San Marzano tomato, fresh basil
· Marinated olives — Castelvetrano, Cerignola, garlic, orange peel, EVOO
· Crostini with cannellini & sage — cannellini beans, sage, garlic, EVOO, country bread
· Roasted beets with goat cheese — golden beets, fresh goat cheese, walnuts, arugula
· Burrata with summer tomato — burrata, heirloom tomato, basil, EVOO, sea salt

SALUMI & FORMAGGI
· Prosciutto di Parma — 24-month aged, served with grissini
· Soppressata — house cured, black pepper crust
· Pecorino Toscano — semi-aged sheep's milk, honey
· Mozzarella di bufala — imported, with EVOO and cracked pepper

PASTA
· Cavatelli with hot sausage & browned butter — fresh cavatelli, Italian sausage, sage
· Tagliatelle al ragù — slow-cooked beef & pork ragù, parmigiano
· Bucatini cacio e pepe — pecorino romano, black pepper, EVOO
· Gnocchi with marinara — potato gnocchi, San Marzano tomato, basil, parmigiano

SECONDI
· Braciole — beef braciole stuffed with breadcrumbs, garlic, parmigiano, simmered in tomato
· Pork sausage with peppers — house Italian sausage, sweet peppers, onion
· Roasted half chicken — herbs, lemon, EVOO

CONTORNI
· Escarole sautéed with garlic — escarole, garlic, EVOO, chili flake
· Roasted potatoes — fingerlings, rosemary, EVOO

DOLCI
· Olive oil cake — citrus zest, vanilla, EVOO
· Affogato — vanilla gelato, espresso`,
};
