// Authored scene recipes and generic-word parsing for the RuleDirector. All lists, words and values here are our own,
// written for this project (no third-party lists). A recipe sets the look: mood, harmony, hue family, value key,
// saturation, composition, painting style, stroke character and a broad subject type.
import { fnv1a } from "./rng.js";
import { COMPOSITIONS, HARMONIES, HUES, KEYS, MOODS, SATS } from "./render.js";

export const STYLES = {
  "loose open-air sketch": "quick and airy, edges left unfinished",
  "quiet tonal study": "few colours, soft changes of light and dark",
  "bold poster": "flat strong shapes and clear silhouettes",
  "dreamy wet-on-wet": "soft blooms and blurred edges",
  "nervous ink drawing": "many fine scratchy lines",
  "naive folk picture": "simple symbolic shapes, bright and direct",
  "moody nocturne": "dark, a few lights, heavy atmosphere",
  "hot expressive colour": "saturated, energetic, unnatural colour",
  "flat woodblock": "flat bands of colour with outlines, decorative",
  "dotted light": "built from many small touches of colour",
  "childlike crayon": "wobbly playful lines",
  "atmospheric haze": "faint layered washes and deep distance",
};
export const STROKES = {
  "calm and even": "steady, regular marks",
  "energetic and loose": "long fast marks that wander",
  "precise and controlled": "tight, careful, evenly spaced marks",
  "rough and broken": "dry, broken, scratchy marks",
  "soft and blended": "marks that melt into each other",
};
export const SUBJECTS = {
  none: "no single subject; the scene itself",
  tree: "a tree or trees",
  building: "a building, tower or houses",
  boat: "a boat or ship",
  animal: "an animal",
  person: "a figure, as a silhouette",
  flower: "flowers",
  light: "a sun, moon, lamp or star",
  mountain: "a mountain or hill",
  object: "an object on a table",
};

/** Every look field, its options in fixed order (share links and the picker use these lists). */
export const LOOK_FIELDS = {
  mood: Object.keys(MOODS),
  harmony: Object.keys(HARMONIES),
  hue: Object.keys(HUES),
  key: Object.keys(KEYS),
  saturation: Object.keys(SATS),
  composition: Object.keys(COMPOSITIONS),
  style: Object.keys(STYLES),
  stroke: Object.keys(STROKES),
  subject: Object.keys(SUBJECTS),
};

// keywords (comma separated; a keyword may be several words) | mood | harmony | hue | key | saturation | composition |
// style | stroke | subject
const SCENE_TABLE = `
lighthouse,light house|stormy|complementary|blue|dark|moderate|tall centre|moody nocturne|energetic and loose|building
sunflower,sunflowers|joyful|complementary|yellow|light|vivid|open horizon|hot expressive colour|energetic and loose|flower
pine forest,pine,pines,fir,firs,conifer|calm|analogous|green|mid|muted|tall centre|quiet tonal study|calm and even|tree
fishing boat,boat,boats,sailboat,sail boat,yacht,rowing boat,canoe,kayak|warm|complementary|orange|mid|moderate|mirror water|loose open-air sketch|soft and blended|boat
rooftops,roofs,rooftop|calm|analogous|blue|mid|muted|side weight|nervous ink drawing|rough and broken|building
dunes,dune,sand dunes|eerie|complementary|orange|dark|moderate|deep ground|atmospheric haze|soft and blended|light
pond,lily pads,lily pad,water lilies,waterlily|calm|analogous|green|mid|moderate|mirror water|dotted light|calm and even|flower
forest path,woodland path,path through,trail,footpath|warm|analogous|orange|mid|moderate|deep ground|loose open-air sketch|energetic and loose|tree
barn,farmhouse,farm|joyful|complementary|red|light|moderate|open horizon|naive folk picture|calm and even|building
waves,surf,breakers,rocky shore,rocks|stormy|analogous|teal|mid|moderate|diagonal sweep|loose open-air sketch|energetic and loose|none
night market,market,bazaar,stalls,street food|joyful|triadic|red|dark|vivid|side weight|dotted light|energetic and loose|light
mountain lake,alpine lake,lake reflection,reflection|calm|analogous|blue|light|moderate|mirror water|atmospheric haze|soft and blended|mountain
mountain,mountains,peak,peaks,summit,alps,volcano|austere|analogous|blue|mid|muted|big sky|flat woodblock|precise and controlled|mountain
hill,hills,hillside,meadow,meadows|calm|analogous|green|light|moderate|open horizon|loose open-air sketch|calm and even|mountain
field,fields,farmland,wheat,cornfield,prairie|warm|analogous|yellow|light|moderate|deep ground|loose open-air sketch|calm and even|none
beach,seaside,shore,coast,coastline|joyful|complementary|teal|light|moderate|open horizon|loose open-air sketch|calm and even|none
sea,ocean,seascape|calm|analogous|blue|mid|moderate|open horizon|atmospheric haze|soft and blended|none
harbour,harbor,port,pier,dock,quay,marina|warm|complementary|blue|mid|moderate|mirror water|loose open-air sketch|calm and even|boat
river,stream,creek,brook|calm|analogous|teal|mid|moderate|diagonal sweep|loose open-air sketch|soft and blended|none
waterfall,cascade|joyful|analogous|teal|light|moderate|tall centre|dreamy wet-on-wet|energetic and loose|none
lake|calm|analogous|blue|light|muted|mirror water|atmospheric haze|soft and blended|none
island,islands,atoll|joyful|complementary|teal|light|vivid|mirror water|naive folk picture|calm and even|tree
desert,cactus,cacti,canyon,mesa|warm|complementary|orange|light|moderate|deep ground|bold poster|precise and controlled|none
jungle,rainforest,tropical|joyful|analogous|green|mid|vivid|tall centre|hot expressive colour|energetic and loose|tree
palm,palm tree,palms|joyful|complementary|green|light|vivid|tall centre|naive folk picture|calm and even|tree
oak,tree,old tree,willow,birch|calm|analogous|green|mid|moderate|tall centre|loose open-air sketch|calm and even|tree
autumn leaves,fall leaves,maple,orchard|warm|analogous|orange|mid|vivid|open horizon|dotted light|energetic and loose|tree
garden,flower bed,flowerbed,allotment|joyful|triadic|pink|light|moderate|open horizon|dotted light|calm and even|flower
flowers,flower,bouquet,roses,rose,tulips,tulip,poppies,poppy,daisies,lavender,blossom,cherry blossom|joyful|analogous|pink|light|vivid|still life|dreamy wet-on-wet|soft and blended|flower
vase|calm|complementary|blue|light|moderate|still life|quiet tonal study|calm and even|object
still life,table,tabletop|calm|analogous|orange|mid|muted|still life|quiet tonal study|calm and even|object
fruit,apple,apples,pear,pears,lemon,lemons,orange fruit,bowl of fruit,grapes|warm|complementary|red|mid|vivid|still life|bold poster|precise and controlled|object
coffee,mug,cup,teacup,tea,teapot|warm|analogous|orange|mid|muted|still life|quiet tonal study|calm and even|object
bread,cake,pie,breakfast,dinner,meal,food,pizza,soup|warm|analogous|yellow|mid|moderate|still life|naive folk picture|calm and even|object
bottle,bottles,wine,jug,jar|calm|analogous|green|mid|muted|still life|quiet tonal study|precise and controlled|object
knife and fork,cutlery,kitchen|calm|analogous|teal|light|muted|still life|nervous ink drawing|precise and controlled|object
city,skyline,downtown,skyscraper,skyscrapers|eerie|complementary|blue|dark|moderate|side weight|bold poster|precise and controlled|building
street,streets,alley,lane,avenue|calm|analogous|orange|mid|muted|deep ground|nervous ink drawing|rough and broken|building
village,town,houses,cottage,cottages,hamlet|calm|analogous|orange|light|moderate|open horizon|naive folk picture|calm and even|building
castle,fortress,palace,ruins,ruin|eerie|analogous|violet|dark|muted|tall centre|moody nocturne|rough and broken|building
church,cathedral,chapel,temple,mosque,pagoda,tower|austere|analogous|yellow|mid|muted|tall centre|quiet tonal study|precise and controlled|building
bridge,bridges,viaduct|calm|complementary|blue|mid|moderate|mirror water|flat woodblock|precise and controlled|building
windmill,mill|joyful|complementary|blue|light|moderate|tall centre|naive folk picture|calm and even|building
train,railway,station,tram|eerie|analogous|teal|dark|muted|diagonal sweep|nervous ink drawing|energetic and loose|building
car,cars,road,highway,motorway|calm|complementary|blue|mid|moderate|deep ground|bold poster|precise and controlled|object
cat,kitten,cats|calm|complementary|orange|mid|moderate|still life|bold poster|soft and blended|animal
dog,puppy,dogs|joyful|complementary|orange|light|moderate|open horizon|naive folk picture|calm and even|animal
horse,horses,pony,cow,cows,sheep,goat,deer,stag|calm|analogous|orange|mid|moderate|open horizon|loose open-air sketch|calm and even|animal
fish,koi,whale,whales,dolphin,dolphins,shark,octopus,jellyfish|calm|analogous|teal|mid|moderate|deep ground|dreamy wet-on-wet|soft and blended|animal
bird,birds,owl,eagle,swan,swans,duck,ducks,heron,gull,seagull,crow,parrot,flamingo|calm|complementary|blue|light|moderate|big sky|loose open-air sketch|energetic and loose|animal
butterfly,butterflies,bee,bees|joyful|triadic|yellow|light|vivid|still life|dotted light|calm and even|flower
fox,wolf,bear,lion,tiger,elephant,giraffe,rabbit,hare|warm|complementary|orange|mid|moderate|side weight|bold poster|energetic and loose|animal
person,figure,woman,man,girl,boy,child,people,dancer,walker,fisherman|calm|complementary|blue|mid|moderate|tall centre|loose open-air sketch|calm and even|person
portrait,face,self portrait|calm|complementary|orange|mid|muted|tall centre|quiet tonal study|soft and blended|person
moon,full moon,moonlight,moonlit,crescent|eerie|complementary|blue|dark|moderate|big sky|moody nocturne|soft and blended|light
sun,sunshine,sunny|joyful|complementary|yellow|light|vivid|big sky|hot expressive colour|energetic and loose|light
stars,starry,starry night,shooting star,galaxy,milky way,constellation|eerie|complementary|violet|dark|vivid|big sky|dotted light|energetic and loose|light
aurora,northern lights|eerie|triadic|teal|dark|vivid|big sky|dreamy wet-on-wet|soft and blended|light
rainbow|joyful|triadic|violet|light|vivid|big sky|naive folk picture|calm and even|light
sky,clouds,cloud,cloudy,sky above|calm|analogous|blue|light|muted|big sky|atmospheric haze|soft and blended|none
volcano eruption,lava,fire,bonfire,campfire,fireplace,candle,candles|warm|analogous|red|dark|vivid|tall centre|hot expressive colour|energetic and loose|light
abstract,shapes,pattern,geometry,colour study,color study,battle of colours,battle of colors|joyful|triadic|red|mid|vivid|diagonal sweep|bold poster|energetic and loose|none
`;

function parseTable(text) {
  return text.trim().split("\n").map((line) => {
    const [kw, mood, harmony, hue, key, saturation, composition, style, stroke, subject] = line.split("|");
    const r = { keywords: kw.split(",").map((s) => s.trim()), mood, harmony, hue, key, saturation, composition, style, stroke, subject };
    for (const f of Object.keys(LOOK_FIELDS)) {
      if (!LOOK_FIELDS[f].includes(r[f])) throw new Error(`recipes: bad ${f} '${r[f]}' in '${kw}'`);
    }
    return r;
  });
}

export const SCENES = parseTable(SCENE_TABLE);

// ------------------------------------------------------------------------------------------------ generic words
// word list -> fields it sets (applied after the scene recipe, in this table's order; later groups win)
const GENERIC = [
  // settings
  [["sea", "ocean", "bay", "lagoon", "water"], { hue: "blue" }],
  [["forest", "woods", "wood", "woodland", "grove"], { hue: "green", composition: "tall centre" }],
  [["city", "urban", "town"], { composition: "side weight" }],
  [["desert", "sand", "sandy"], { hue: "orange" }],
  [["snow", "snowy", "ice", "icy", "frozen", "glacier", "frost", "frosty"], { key: "light", hue: "blue", saturation: "muted" }],
  [["lake", "pond", "reflection", "reflected", "mirror"], { composition: "mirror water" }],
  [["field", "meadow", "plain", "plains", "valley"], { composition: "deep ground" }],
  [["mountain", "mountains", "peak", "cliff", "cliffs"], { composition: "big sky" }],
  [["table", "kitchen", "indoors", "room", "interior", "window"], { composition: "still life" }],
  // seasons
  [["spring", "springtime"], { hue: "green", key: "light", mood: "joyful" }],
  [["summer", "summertime"], { hue: "yellow", saturation: "vivid", mood: "warm" }],
  [["autumn", "fall", "autumnal"], { hue: "orange", mood: "warm" }],
  [["winter", "wintry", "wintertime"], { hue: "blue", key: "light", saturation: "muted", mood: "austere" }],
  // weather
  [["storm", "stormy", "thunder", "thunderstorm", "lightning", "gale", "hurricane", "tempest"], { mood: "stormy", key: "dark" }],
  [["rain", "rainy", "raining", "drizzle", "wet", "puddle", "puddles"], { mood: "calm", saturation: "muted", hue: "blue" }],
  [["fog", "foggy", "mist", "misty", "haze", "hazy"], { saturation: "muted", key: "light", style: "atmospheric haze" }],
  [["wind", "windy", "breeze", "breezy"], { stroke: "energetic and loose" }],
  [["clear", "bright"], { key: "light" }],
  // time of day
  [["dawn", "sunrise", "daybreak", "morning"], { hue: "pink", key: "light", mood: "calm" }],
  [["noon", "midday", "daytime", "afternoon"], { key: "light", mood: "warm" }],
  [["sunset", "dusk", "evening", "twilight", "golden hour"], { hue: "orange", mood: "warm", key: "mid" }],
  [["night", "nighttime", "midnight", "nocturnal", "dark"], { key: "dark", style: "moody nocturne" }],
  // moods
  [["calm", "quiet", "peaceful", "still", "serene", "tranquil", "gentle", "sleepy"], { mood: "calm" }],
  [["happy", "joyful", "cheerful", "festive", "party", "celebration", "fun", "playful"], { mood: "joyful" }],
  [["warm", "cosy", "cozy", "hot", "glowing"], { mood: "warm" }],
  [["eerie", "spooky", "haunted", "ghostly", "ghost", "strange", "mysterious", "creepy", "uncanny"], { mood: "eerie" }],
  [["sad", "lonely", "melancholy", "gloomy", "grey", "gray", "bleak"], { mood: "austere", saturation: "muted" }],
  [["wild", "angry", "raging", "fierce", "rough"], { mood: "stormy", stroke: "rough and broken" }],
  [["minimal", "simple", "plain", "sparse", "empty"], { mood: "austere", harmony: "monochrome" }],
  [["dreamy", "dream", "soft", "magical", "fairy"], { style: "dreamy wet-on-wet", stroke: "soft and blended" }],
  [["bold", "poster", "graphic"], { style: "bold poster" }],
  [["sketch", "drawing", "ink", "pen"], { style: "nervous ink drawing" }],
  [["crayon", "childlike", "child's", "kids"], { style: "childlike crayon" }],
  [["dots", "dotted", "pointillist", "speckled"], { style: "dotted light" }],
  // broad subjects (only when no scene recipe named one)
  [["animal", "animals", "creature", "pet"], { subject: "animal" }],
  [["building", "buildings", "house", "home", "tower"], { subject: "building" }],
  [["tree", "trees"], { subject: "tree" }],
  [["ship", "ships", "boat", "boats"], { subject: "boat" }],
  [["someone", "silhouette", "figure", "walker", "traveller", "traveler"], { subject: "person" }],
  [["flower", "flowers", "bloom", "blooms"], { subject: "flower" }],
  // colour words (strongest: they name the hue directly)
  [["red", "crimson", "scarlet", "ruby", "cherry"], { hue: "red" }],
  [["orange", "amber", "tangerine", "copper", "rust"], { hue: "orange" }],
  [["yellow", "gold", "golden", "lemon", "mustard"], { hue: "yellow" }],
  [["green", "emerald", "olive", "lime", "jade", "mossy"], { hue: "green" }],
  [["teal", "turquoise", "aqua", "cyan"], { hue: "teal" }],
  [["blue", "navy", "azure", "cobalt", "sapphire", "indigo"], { hue: "blue" }],
  [["violet", "purple", "lilac", "lavender", "plum", "mauve"], { hue: "violet" }],
  [["pink", "rose", "magenta", "fuchsia", "coral", "peach"], { hue: "pink" }],
  [["pastel", "pale"], { key: "light", saturation: "muted" }],
  [["vivid", "vibrant", "neon", "electric", "saturated"], { saturation: "vivid" }],
  [["black", "white", "monochrome"], { harmony: "monochrome" }],
];

function tokens(text) {
  return ` ${text.toLowerCase().replace(/[^a-z0-9' ]+/g, " ").replace(/\s+/g, " ").trim()} `;
}

function has(t, phrase) {
  return t.includes(` ${phrase} `);
}

/** A look drawn from the hash of the text: the same text always gives the same look. */
export function hashedLook(text) {
  let h = fnv1a(`look|${text.trim().toLowerCase()}`);
  const out = {};
  for (const [f, opts] of Object.entries(LOOK_FIELDS)) {
    out[f] = opts[h % opts.length];
    h = Math.imul(h ^ (h >>> 13), 0x5bd1e995) >>> 0;
  }
  return out;
}

/**
 * prompt (already through the guardrails) -> {look, known, scene, matched: [words]}.
 * known = false when neither a scene nor any generic word matched; the look then comes from the prompt's hash.
 */
export function readPrompt(prompt) {
  const t = tokens(prompt);
  let best = null, bestLen = 0;
  for (const s of SCENES) {
    for (const k of s.keywords) {
      if (has(t, k) && k.length > bestLen) { best = s; bestLen = k.length; }
    }
  }
  const matched = [];
  const look = best ? { ...best } : hashedLook(prompt);
  delete look.keywords;
  if (best) matched.push(best.keywords.find((k) => has(t, k) && k.length === bestLen));
  for (const [words, set] of GENERIC) {
    const w = words.find((x) => has(t, x));
    if (!w) continue;
    if (best && w === matched[0]) continue;
    if (set.subject && best && best.subject !== "none") continue;
    Object.assign(look, set);
    matched.push(w);
  }
  return { look, known: matched.length > 0, scene: best ? best.keywords[0] : null, matched: [...new Set(matched)] };
}

/** Clamp a look to the fixed option lists (unknown values -> the field's first option). */
export function cleanLook(look) {
  const out = {};
  for (const [f, opts] of Object.entries(LOOK_FIELDS)) out[f] = opts.includes(look?.[f]) ? look[f] : opts[0];
  return out;
}
