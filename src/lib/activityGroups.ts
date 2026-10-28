// Fixed activity groups, shared by the server (which builds them) and the UI (which labels them).

export const MUST_SEE = "Don't miss";
export const THEME_PARKS = "Theme parks";
export const MORE_IDEAS = "More ideas";

/** Scouts name groups freely; the fixed groups get one name each so they can be merged and ordered. */
export function canonicalGroup(name: string): string {
  if (/must|don.?t miss|highlight|top (sights|attractions|things)|essential|iconic|unmissable/i.test(name)) return MUST_SEE;
  if (/theme ?park|amusement|water ?park/i.test(name)) return THEME_PARKS;
  return name;
}

/** One-line description under a group heading. */
export const GROUP_BLURB: Record<string, string> = {
  [MUST_SEE]: "The sights and experiences this place is best known for.",
  [THEME_PARKS]: "Rides, water parks and full days out.",
  [MORE_IDEAS]: "Other good options we found that don't fit the groups above.",
};
