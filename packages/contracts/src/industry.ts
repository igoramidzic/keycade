import { naics2022 } from "./naics-2022.js";

/** U.S. national six-digit industries, pinned to the Census Bureau's 2022 taxonomy. */
export const industryTaxonomyVersion = "2022";
export type Industry = { code: string; title: string; taxonomyVersion: string };
export const industryCatalog: readonly Industry[] = naics2022.map(([code, title]) => ({
  code,
  title,
  taxonomyVersion: industryTaxonomyVersion,
}));
const byCode = new Map(industryCatalog.map((entry) => [entry.code, entry]));

export function industryByCode(code: string | null | undefined): Industry | undefined {
  return code ? byCode.get(code) : undefined;
}

export function isValidIndustry(code: string, version: string): boolean {
  return version === industryTaxonomyVersion && byCode.has(code);
}
