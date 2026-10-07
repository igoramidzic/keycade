import { type Industry, industryCatalog } from "./industry.js";

// Search hints are authored locally, not official Census classifications. They never
// create an industry: every result comes from the pinned, validated source catalog.
const synonyms: Record<string, string> = {
  "621210": "dentist dentistry dental office dental clinic orthodontist teeth tooth care",
  "621111": "doctor physician medical office family medicine primary care clinic",
  "621310": "chiropractor chiropractic back pain clinic",
  "621320": "optometrist eye doctor vision clinic",
  "621340": "physical therapy physiotherapy therapist rehabilitation occupational therapy",
  "541940": "vet veterinarian animal pet clinic animal hospital",
  "812112": "hair salon hairdresser beauty haircuts hairstylist",
  "812111": "barber barbershop haircut",
  "812113": "nail salon manicure pedicure",
  "811111": "car auto repair mechanic garage automobile workshop",
  "811121": "auto body shop collision repair car paint",
  "238220": "plumber plumbing heating air conditioning hvac",
  "238210": "electrician electrical contractor wiring",
  "238160": "roofer roofing contractor roof repair",
  "236118": "home renovation remodeling remodelling remodeler house improvements",
  "561730": "landscaper landscaping lawn garden mowing gardener",
  "561720": "cleaner house cleaning janitor office cleaning maid",
  "722511": "restaurant diner sit down dining waiter eatery",
  "722513": "fast food takeaway takeout pizza sandwich burger counter restaurant",
  "722515": "coffee shop cafe tea juice ice cream donut doughnut",
  "722320": "caterer catering events meals",
  "445110": "grocery supermarket food store groceries",
  "445291": "bakery baked goods bread cake cookies shop",
  "541511": "software developer app website programming coding custom software",
  "541512": "it consultant technology computer systems consulting",
  "541110": "lawyer attorney legal law office practice",
  "541211": "accountant accounting cpa certified public accountant",
  "541219": "bookkeeper bookkeeping payroll accounting services",
  "541810": "advertising agency marketing ad campaigns",
  "541430": "graphic designer graphic design branding logo",
  "541921": "photographer photography portraits wedding photos",
  "531210": "realtor real estate agent broker property sales",
  "624410": "daycare child care childcare nursery preschool",
  "713940": "gym fitness workout health club personal training",
  "484110": "trucking truck driver local freight haul delivery",
  "484121": "trucking truck driver long distance freight interstate haul",
  "492210": "courier local delivery messenger packages",
  "812910": "pet grooming groomer dog walking boarding kennel pet sitter",
};

const stopWords = new Set(["a", "an", "and", "business", "company", "for", "i", "my", "of", "the"]);
function words(text: string): string[] {
  return text
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word && !stopWords.has(word))
    .map((word) => (word.length > 4 && word.endsWith("s") ? word.slice(0, -1) : word));
}

// Bounded Damerau-Levenshtein permits ordinary typos and swapped adjacent letters.
function distance(a: string, b: string): number {
  const rows = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) {
      const row = rows[i] as number[];
      const before = rows[i - 1] as number[];
      row[j] = Math.min(
        (before[j] as number) + 1,
        (row[j - 1] as number) + 1,
        (before[j - 1] as number) + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1])
        row[j] = Math.min(row[j] as number, (rows[i - 2]?.[j - 2] as number) + 1);
    }
  return rows[a.length]?.[b.length] as number;
}

function matchWord(query: string, candidate: string): number {
  if (query === candidate) return 12;
  if (query.length >= 2 && candidate.startsWith(query)) return 8;
  if (query.length < 4) return 0;
  const allowed = query.length >= 7 ? 2 : 1;
  if (Math.abs(query.length - candidate.length) > allowed) return 0;
  return distance(query, candidate) <= allowed ? 4 : 0;
}
const index = industryCatalog.map((industry) => ({
  industry,
  title: words(industry.title),
  aliases: words(synonyms[industry.code] ?? ""),
}));

/** Deterministic local ranking; search text can never become a selected code. */
export function searchIndustries(query: string, limit = 30): Industry[] {
  const normalized = query.trim().slice(0, 120);
  const cap = Math.min(100, Math.max(1, Math.floor(limit) || 30));
  if (!normalized) return industryCatalog.slice(0, cap);
  if (/^\d+$/.test(normalized))
    return industryCatalog.filter((item) => item.code.startsWith(normalized)).slice(0, cap);
  const tokens = words(normalized).slice(0, 12);
  if (!tokens.length) return [];
  return index
    .map(({ industry, title, aliases }) => {
      let score = 0;
      for (const token of tokens) {
        const titleScore = Math.max(0, ...title.map((word) => matchWord(token, word)));
        const aliasScore = Math.max(0, ...aliases.map((word) => matchWord(token, word)));
        const matched = Math.max(titleScore * 2, aliasScore);
        if (!matched) return { industry, score: 0 };
        score += matched;
      }
      return { industry, score };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || a.industry.code.localeCompare(b.industry.code))
    .slice(0, cap)
    .map(({ industry }) => industry);
}
