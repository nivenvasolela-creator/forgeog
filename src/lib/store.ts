import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Experiment,
  ForgeReportData,
  Idea,
  IdeaVersion,
  Sprint,
} from "./analyzeIdea";

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
  /** Adds one "todo" experiment per title and returns the new rows. */
  addExperiments(ideaId: string, titles: string[]): Promise<Experiment[]>;
  updateExperiment(
    ideaId: string,
    experimentId: string,
    patch: ExperimentPatch
  ): Promise<void>;
  deleteExperiment(ideaId: string, experimentId: string): Promise<void>;
  /** Stores the idea's sprint, replacing any earlier one. */
  saveSprint(ideaId: string, sprint: Sprint): Promise<void>;
}

export type ExperimentPatch = Partial<
  Pick<Experiment, "status" | "outcome" | "notes">
>;

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
      if (!Array.isArray(parsed)) return [];
      // Ideas saved before validation plans existed have no experiments list.
      return (parsed as Idea[]).map((i) => ({
        ...i,
        experiments: i.experiments ?? [],
        sprint: i.sprint ?? null,
      }));
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
        experiments: [],
        sprint: null,
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

function updateLocalIdea(ideaId: string, change: (idea: Idea) => Idea): void {
  try {
    writeLocalIdeas(
      readLocalIdeas().map((i) => (i.id === ideaId ? change(i) : i))
    );
  } catch {
    throw new Error("This browser's storage is full or blocked.");
  }
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
            experiments: [],
            sprint: null,
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
    async addExperiments(ideaId, titles) {
      const now = new Date().toISOString();
      const added: Experiment[] = titles.map((title) => ({
        id: newId(),
        title,
        status: "todo",
        outcome: null,
        notes: "",
        createdAt: now,
        updatedAt: now,
      }));
      updateLocalIdea(ideaId, (idea) => ({
        ...idea,
        experiments: [...idea.experiments, ...added],
      }));
      return added;
    },
    async updateExperiment(ideaId, experimentId, patch) {
      const now = new Date().toISOString();
      updateLocalIdea(ideaId, (idea) => ({
        ...idea,
        experiments: idea.experiments.map((e) =>
          e.id === experimentId ? { ...e, ...patch, updatedAt: now } : e
        ),
      }));
    },
    async deleteExperiment(ideaId, experimentId) {
      updateLocalIdea(ideaId, (idea) => ({
        ...idea,
        experiments: idea.experiments.filter((e) => e.id !== experimentId),
      }));
    },
    async saveSprint(ideaId, sprint) {
      updateLocalIdea(ideaId, (idea) => ({ ...idea, sprint }));
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

interface ExperimentRow {
  id: string;
  title: string;
  status: Experiment["status"];
  outcome: Experiment["outcome"];
  notes: string;
  created_at: string;
  updated_at: string;
}

function toExperiment(row: ExperimentRow): Experiment {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    outcome: row.outcome,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

interface IdeaRow {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  reports: ReportRow[] | null;
  experiments: ExperimentRow[] | null;
  sprints: SprintRow[] | SprintRow | null;
}

interface SprintRow {
  data: { plan?: Sprint["plan"]; done?: string[] } | null;
  created_at: string;
}

function toSprint(rows: IdeaRow["sprints"]): Sprint | null {
  // One-to-one relations come back as an object; older clients may see a list.
  const row = Array.isArray(rows) ? rows[0] : rows;
  if (!row?.data?.plan) return null;
  return {
    plan: row.data.plan,
    done: Array.isArray(row.data.done) ? row.data.done : [],
    createdAt: row.created_at,
  };
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
    experiments: (row.experiments ?? [])
      .map(toExperiment)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    sprint: toSprint(row.sprints),
  };
}

const EXPERIMENT_SELECT =
  "id, title, status, outcome, notes, created_at, updated_at";
const IDEA_SELECT = `id, title, created_at, updated_at, reports (id, created_at, raw_idea, clarification, data), experiments (${EXPERIMENT_SELECT}), sprints (data, created_at)`;

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
    async addExperiments(ideaId, titles) {
      const { data, error } = await sb
        .from("experiments")
        .insert(titles.map((title) => ({ idea_id: ideaId, title })))
        .select(EXPERIMENT_SELECT);
      if (error) throw new Error(error.message);
      return (data as ExperimentRow[])
        .map(toExperiment)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    },
    async updateExperiment(_ideaId, experimentId, patch) {
      const { error } = await sb
        .from("experiments")
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq("id", experimentId);
      if (error) throw new Error(error.message);
    },
    async deleteExperiment(_ideaId, experimentId) {
      const { error } = await sb
        .from("experiments")
        .delete()
        .eq("id", experimentId);
      if (error) throw new Error(error.message);
    },
    async saveSprint(ideaId, sprint) {
      const { error } = await sb.from("sprints").upsert(
        {
          idea_id: ideaId,
          data: { plan: sprint.plan, done: sprint.done },
          created_at: sprint.createdAt,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "idea_id" }
      );
      if (error) throw new Error(error.message);
    },
  };
}
