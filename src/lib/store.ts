import type { SupabaseClient } from "@supabase/supabase-js";
import type { ForgeReportData, Idea, IdeaVersion } from "./analyzeIdea";

export interface NewVersionInput {
  rawIdea: string;
  clarification?: string;
  data: ForgeReportData;
}

export interface IdeaStore {
  /** Ideas newest-updated first; each idea's versions newest first. */
  listIdeas(): Promise<Idea[]>;
  /** Adds a report to an existing idea, or creates the idea when ideaId is null. */
  addVersion(ideaId: string | null, input: NewVersionInput): Promise<Idea>;
  deleteIdea(ideaId: string): Promise<void>;
}

export function deriveTitle(data: ForgeReportData, rawIdea: string): string {
  const candidate =
    data.idea_title?.trim() || data.idea_summary?.trim() || rawIdea.trim();
  const firstLine = candidate.split("\n")[0];
  return firstLine.length > 80 ? `${firstLine.slice(0, 77)}...` : firstLine;
}

function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

// ---------------------------------------------------------------------------
// Browser-only store (used when Supabase is not configured)
// ---------------------------------------------------------------------------

const IDEAS_KEY = "forge_ideas_v2";
const LEGACY_REPORTS_KEY = "forge_reports_v1";
const MAX_LOCAL_IDEAS = 50;

function readLocalIdeas(): Idea[] {
  try {
    const raw = window.localStorage.getItem(IDEAS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    }
    // First run after the workspace upgrade: turn each old saved report into an idea.
    const legacyRaw = window.localStorage.getItem(LEGACY_REPORTS_KEY);
    if (!legacyRaw) return [];
    const legacy = JSON.parse(legacyRaw) as IdeaVersion[];
    if (!Array.isArray(legacy)) return [];
    const migrated: Idea[] = legacy
      .filter((r) => r?.data?.idea_score)
      .map((r) => ({
        id: newId(),
        title: deriveTitle(r.data, r.rawIdea),
        createdAt: r.createdAt,
        updatedAt: r.createdAt,
        versions: [r],
      }));
    writeLocalIdeas(migrated);
    return migrated;
  } catch {
    return [];
  }
}

function writeLocalIdeas(ideas: Idea[]): void {
  window.localStorage.setItem(IDEAS_KEY, JSON.stringify(ideas));
}

export function createLocalStore(): IdeaStore {
  return {
    async listIdeas() {
      return readLocalIdeas();
    },
    async addVersion(ideaId, input) {
      const now = new Date().toISOString();
      const version: IdeaVersion = {
        id: newId(),
        createdAt: now,
        rawIdea: input.rawIdea,
        clarification: input.clarification,
        data: input.data,
      };
      const ideas = readLocalIdeas();
      const existing = ideaId ? ideas.find((i) => i.id === ideaId) : undefined;
      const idea: Idea = existing
        ? {
            ...existing,
            title: deriveTitle(input.data, input.rawIdea),
            updatedAt: now,
            versions: [version, ...existing.versions],
          }
        : {
            id: newId(),
            title: deriveTitle(input.data, input.rawIdea),
            createdAt: now,
            updatedAt: now,
            versions: [version],
          };
      const next = [idea, ...ideas.filter((i) => i.id !== idea.id)].slice(
        0,
        MAX_LOCAL_IDEAS
      );
      try {
        writeLocalIdeas(next);
      } catch {
        throw new Error("This browser's storage is full or blocked.");
      }
      return idea;
    },
    async deleteIdea(ideaId) {
      writeLocalIdeas(readLocalIdeas().filter((i) => i.id !== ideaId));
    },
  };
}

// ---------------------------------------------------------------------------
// Supabase store (per-user rows protected by row level security)
// ---------------------------------------------------------------------------

interface ReportRow {
  id: string;
  created_at: string;
  raw_idea: string;
  clarification: string | null;
  data: ForgeReportData;
}

interface IdeaRow {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  reports: ReportRow[] | null;
}

function toVersion(row: ReportRow): IdeaVersion {
  return {
    id: row.id,
    createdAt: row.created_at,
    rawIdea: row.raw_idea,
    clarification: row.clarification ?? undefined,
    data: row.data,
  };
}

function toIdea(row: IdeaRow): Idea {
  return {
    id: row.id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    versions: (row.reports ?? [])
      .map(toVersion)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
  };
}

const IDEA_SELECT =
  "id, title, created_at, updated_at, reports (id, created_at, raw_idea, clarification, data)";

export function createSupabaseStore(sb: SupabaseClient): IdeaStore {
  const fetchIdea = async (ideaId: string): Promise<Idea> => {
    const { data, error } = await sb
      .from("ideas")
      .select(IDEA_SELECT)
      .eq("id", ideaId)
      .single();
    if (error) throw new Error(error.message);
    return toIdea(data as IdeaRow);
  };

  return {
    async listIdeas() {
      const { data, error } = await sb
        .from("ideas")
        .select(IDEA_SELECT)
        .order("updated_at", { ascending: false });
      if (error) throw new Error(error.message);
      // An idea whose first report failed to save has nothing to show.
      return (data as IdeaRow[]).map(toIdea).filter((i) => i.versions.length > 0);
    },
    async addVersion(ideaId, input) {
      const title = deriveTitle(input.data, input.rawIdea);
      let targetId = ideaId;
      if (targetId) {
        const { error } = await sb
          .from("ideas")
          .update({ title, updated_at: new Date().toISOString() })
          .eq("id", targetId);
        if (error) throw new Error(error.message);
      } else {
        const { data, error } = await sb
          .from("ideas")
          .insert({ title })
          .select("id")
          .single();
        if (error) throw new Error(error.message);
        targetId = (data as { id: string }).id;
      }
      const { error: reportError } = await sb.from("reports").insert({
        idea_id: targetId,
        raw_idea: input.rawIdea,
        clarification: input.clarification ?? null,
        data: input.data,
      });
      if (reportError) throw new Error(reportError.message);
      return fetchIdea(targetId);
    },
    async deleteIdea(ideaId) {
      const { error } = await sb.from("ideas").delete().eq("id", ideaId);
      if (error) throw new Error(error.message);
    },
  };
}
