// Who the founder is and which language they read, sent with every request
// so the model can tailor its judgement and write in the founder's language.

export type Language = "en" | "sw";

export interface FounderProfileInput {
  name?: string;
  country?: string;
  city?: string;
  background?: string;
  skills?: string;
  hours_per_week?: string;
  budget?: string;
  goal?: string;
}

const PROFILE_FIELDS: Array<[keyof FounderProfileInput, string, number]> = [
  ["name", "Name", 80],
  ["country", "Country", 80],
  ["city", "City", 80],
  ["background", "Background and experience", 800],
  ["skills", "Skills", 500],
  ["hours_per_week", "Time available per week", 80],
  ["budget", "Money available to start", 120],
  ["goal", "What they want from this business", 500],
];

/** Turns the client's profile object into labelled lines, dropping empty or oversized fields. */
export function parseProfile(input: unknown): string[] {
  if (typeof input !== "object" || input === null) return [];
  const record = input as Record<string, unknown>;
  const lines: string[] = [];
  for (const [key, label, max] of PROFILE_FIELDS) {
    const value = record[key];
    if (typeof value !== "string") continue;
    const clean = value.replace(/\s+/g, " ").trim().slice(0, max);
    if (clean) lines.push(`- ${label}: ${clean}`);
  }
  return lines;
}

export function parseLanguage(input: unknown): Language {
  return input === "sw" ? "sw" : "en";
}

/** Instruction appended to system prompts so every text field comes back in the founder's language. */
export function languageRule(language: Language): string {
  return language === "sw"
    ? "\n\nLANGUAGE: Write every human-readable text value in clear, simple Kiswahili (Swahili as used in Tanzania). Keep JSON keys, enum values (such as go, pivot, kill, low, medium, high) and company or product names exactly as they are."
    : "";
}

export function profileBlock(lines: string[]): string {
  return lines.length > 0
    ? lines.join("\n")
    : "Not provided. The founder has not filled in a profile.";
}
