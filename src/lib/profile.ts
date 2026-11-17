import type { SupabaseClient } from "@supabase/supabase-js";
import type { Language } from "./i18n";

/** What FORGE remembers about the founder. Every field is optional free text. */
export interface FounderProfile {
  name: string;
  country: string;
  city: string;
  background: string;
  skills: string;
  hours_per_week: string;
  budget: string;
  goal: string;
  language: Language;
}

export const PROFILE_TEXT_FIELDS = [
  "name",
  "country",
  "city",
  "background",
  "skills",
  "hours_per_week",
  "budget",
  "goal",
] as const;

export const PROFILE_LIMITS: Record<(typeof PROFILE_TEXT_FIELDS)[number], number> = {
  name: 80,
  country: 80,
  city: 80,
  background: 800,
  skills: 500,
  hours_per_week: 80,
  budget: 120,
  goal: 500,
};

export function emptyProfile(language: Language): FounderProfile {
  return {
    name: "",
    country: "",
    city: "",
    background: "",
    skills: "",
    hours_per_week: "",
    budget: "",
    goal: "",
    language,
  };
}

/** True once the founder has told FORGE anything beyond their name. */
export function profileHasSubstance(profile: FounderProfile | null): boolean {
  if (!profile) return false;
  return PROFILE_TEXT_FIELDS.some((f) => f !== "name" && profile[f].trim() !== "");
}

function normalise(row: Record<string, unknown>): FounderProfile {
  const out = emptyProfile(row.language === "sw" ? "sw" : "en");
  for (const field of PROFILE_TEXT_FIELDS) {
    const value = row[field];
    out[field] = typeof value === "string" ? value : "";
  }
  return out;
}

export interface ProfileStore {
  /** Null when the founder has never saved a profile. */
  load(): Promise<FounderProfile | null>;
  save(profile: FounderProfile): Promise<void>;
}

const LOCAL_PROFILE_KEY = "forge_profile_v1";

export function createLocalProfileStore(): ProfileStore {
  return {
    async load() {
      try {
        const raw = window.localStorage.getItem(LOCAL_PROFILE_KEY);
        return raw ? normalise(JSON.parse(raw) as Record<string, unknown>) : null;
      } catch {
        return null;
      }
    },
    async save(profile) {
      try {
        window.localStorage.setItem(LOCAL_PROFILE_KEY, JSON.stringify(profile));
      } catch {
        throw new Error("This browser's storage is full or blocked.");
      }
    },
  };
}

export function createSupabaseProfileStore(sb: SupabaseClient): ProfileStore {
  return {
    async load() {
      const { data, error } = await sb
        .from("profiles")
        .select("name, country, city, background, skills, hours_per_week, budget, goal, language")
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data ? normalise(data as Record<string, unknown>) : null;
    },
    async save(profile) {
      const { data: userData } = await sb.auth.getUser();
      const userId = userData.user?.id;
      if (!userId) throw new Error("You are signed out.");
      const row: Record<string, string> = { user_id: userId, language: profile.language };
      for (const field of PROFILE_TEXT_FIELDS) {
        row[field] = profile[field].trim().slice(0, PROFILE_LIMITS[field]);
      }
      const { error } = await sb
        .from("profiles")
        .upsert({ ...row, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
      if (error) throw new Error(error.message);
    },
  };
}
