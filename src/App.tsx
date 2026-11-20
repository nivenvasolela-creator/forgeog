import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { AuthScreen } from "./components/AuthScreen";
import { InputScreen } from "./components/InputScreen";
import { ProfileScreen } from "./components/ProfileScreen";
import { ReportScreen } from "./components/ReportScreen";
import { WorkingScreen } from "./components/WorkingScreen";
import { AskForgeScreen } from "./components/AskForgeScreen";
import { TelegramCard } from "./components/TelegramCard";
import { askForgeAvailable, type ChatAction } from "./lib/askForge";
import {
  analyzeIdea,
  buildSprintPlan,
  sprintRequest,
  completedEvidence,
  STRESS_TEST_PHASES,
  type Experiment,
  type Idea,
  type Sprint,
} from "./lib/analyzeIdea";
import { useI18n } from "./lib/i18n";
import {
  enqueueJob,
  listActiveJobs,
  nexusAvailable,
  phaseForStep,
  watchJob,
  type NexusJob,
} from "./lib/nexus";
import {
  createLocalProfileStore,
  createSupabaseProfileStore,
  emptyProfile,
  profileHasSubstance,
  type FounderProfile,
} from "./lib/profile";
import {
  createLocalStore,
  createSupabaseStore,
  deriveTitle,
  type ExperimentPatch,
} from "./lib/store";
import { supabase } from "./lib/supabase";

type FlowScreen = "home" | "working" | "idea" | "profile" | "ask";

const PROFILE_SKIPPED_KEY = "forge_profile_skipped_v1";

function profileSkipped(): boolean {
  try {
    return window.localStorage.getItem(PROFILE_SKIPPED_KEY) === "1";
  } catch {
    return false;
  }
}

function errorText(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

/** True when the model provider refused because a daily or rate quota ran out. */
function isQuotaError(message: string): boolean {
  return /free-models-per-day|rate limit|quota/i.test(message);
}

const ACTIVE_IDEA_KEY = "forge_active_idea_v2";
const UNSAVED_IDEA_ID = "unsaved";

function rememberActiveIdea(id: string | null): void {
  try {
    if (id) window.localStorage.setItem(ACTIVE_IDEA_KEY, id);
    else window.localStorage.removeItem(ACTIVE_IDEA_KEY);
  } catch {
    // Ignore storage errors
  }
}

function recallActiveIdea(): string | null {
  try {
    return window.localStorage.getItem(ACTIVE_IDEA_KEY);
  } catch {
    return null;
  }
}

export default function App() {
  const { t, lang, setLang } = useI18n();
  // Sign-in only exists when Supabase is configured.
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(!supabase);

  useEffect(() => {
    if (!supabase) return;
    void supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthReady(true);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  const userId = session?.user.id ?? null;
  const store = useMemo(
    () => (supabase ? createSupabaseStore(supabase) : createLocalStore()),
    []
  );

  const profileStore = useMemo(
    () => (supabase ? createSupabaseProfileStore(supabase) : createLocalProfileStore()),
    []
  );
  const [profile, setProfile] = useState<FounderProfile | null>(null);
  const [profileLoaded, setProfileLoaded] = useState(false);

  const [sprintBuildingFor, setSprintBuildingFor] = useState<string | null>(null);
  const [sprintError, setSprintError] = useState<{ ideaId: string; message: string } | null>(
    null
  );

  // Nexus: jobs still working in the background, the one shown on the
  // working screen, and the job whose clarifying question is being answered.
  const [activeJobs, setActiveJobs] = useState<NexusJob[]>([]);
  const [waitingForQuota, setWaitingForQuota] = useState(false);
  const foregroundJobRef = useRef<string | null>(null);
  const answeringJobRef = useRef<string | null>(null);

  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [ideasLoading, setIdeasLoading] = useState(true);
  const [screen, setScreen] = useState<FlowScreen>("home");
  // Ask FORGE: the idea it opened on, and the screen to go back to.
  const [askIdeaId, setAskIdeaId] = useState<string | null>(null);
  const [askReturn, setAskReturn] = useState<"home" | "idea">("home");
  const [activeIdeaId, setActiveIdeaId] = useState<string | null>(null);
  const [activeVersionId, setActiveVersionId] = useState<string | null>(null);
  const [revisingIdeaId, setRevisingIdeaId] = useState<string | null>(null);

  const [rawIdea, setRawIdea] = useState("");
  const [clarifyingQuestion, setClarifyingQuestion] = useState<string | null>(
    null
  );
  const [clarificationAnswer, setClarificationAnswer] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [saveWarning, setSaveWarning] = useState<string | null>(null);
  const [activePhaseIndex, setActivePhaseIndex] = useState(0);

  const targetPhaseRef = useRef(0);
  const displayPhaseRef = useRef(0);

  const resetDraft = useCallback(() => {
    setRawIdea("");
    setClarifyingQuestion(null);
    setClarificationAnswer("");
    setErrorMessage(null);
    setRevisingIdeaId(null);
  }, []);

  // Load the workspace once we know who is using it.
  useEffect(() => {
    if (!authReady) return;
    if (supabase && !userId) {
      setIdeas([]);
      setActiveIdeaId(null);
      setScreen("home");
      resetDraft();
      return;
    }
    let cancelled = false;
    setIdeasLoading(true);
    store
      .listIdeas()
      .then((loaded) => {
        if (cancelled) return;
        setIdeas(loaded);
        const lastId = recallActiveIdea();
        if (lastId && loaded.some((i) => i.id === lastId)) {
          setActiveIdeaId(lastId);
          setActiveVersionId(null);
          setScreen("idea");
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setErrorMessage(t.loadIdeasFailed(errorText(err, t.unknownError)));
      })
      .finally(() => {
        if (!cancelled) setIdeasLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // t only shapes the error text; reloading on a language switch is not wanted.
  }, [authReady, userId, store, resetDraft]);

  // Load what FORGE remembers about the founder; first-timers see onboarding.
  useEffect(() => {
    if (!authReady) return;
    if (supabase && !userId) {
      setProfile(null);
      setProfileLoaded(false);
      return;
    }
    let cancelled = false;
    profileStore
      .load()
      .then((loaded) => {
        if (cancelled) return;
        setProfile(loaded);
        if (loaded) setLang(loaded.language);
        else if (!profileSkipped()) setScreen("profile");
      })
      .catch(() => {
        // Without a profile FORGE still works; it just knows less.
      })
      .finally(() => {
        if (!cancelled) setProfileLoaded(true);
      });
    return () => {
      cancelled = true;
    };
    // setLang is stable; lang is deliberately not a dependency.
  }, [authReady, userId, profileStore, setLang]);

  // Keep the saved profile's language in step with the toggle.
  useEffect(() => {
    if (!profile || profile.language === lang) return;
    const next = { ...profile, language: lang };
    setProfile(next);
    profileStore.save(next).catch(() => {
      // Not critical: the toggle still applies in this browser.
    });
  }, [lang, profile, profileStore]);

  // Smoothly step the 6 stress-test phases in order on the working screen
  useEffect(() => {
    if (screen !== "working") return;

    const timer = window.setInterval(() => {
      setActivePhaseIndex((prev) => {
        const next = prev < targetPhaseRef.current ? prev + 1 : prev;
        displayPhaseRef.current = next;
        return next;
      });
    }, 320);

    return () => window.clearInterval(timer);
  }, [screen]);

  const reloadIdeas = useCallback(async () => {
    try {
      setIdeas(await store.listIdeas());
    } catch {
      // Keep what is on screen; the next refresh tries again.
    }
  }, [store]);

  // Follow Nexus jobs that run in the background; when one finishes, load
  // the new report or sprint into the workspace.
  const activeCountRef = useRef(0);
  const refreshActiveJobs = useCallback(async () => {
    if (!supabase || !nexusAvailable(supabase) || !userId) return;
    try {
      const list = await listActiveJobs(supabase);
      const working = list.filter((j) => j.status !== "needs_input").length;
      if (working < activeCountRef.current) void reloadIdeas();
      activeCountRef.current = working;
      setActiveJobs(list);
    } catch {
      // Try again on the next tick.
    }
  }, [userId, reloadIdeas]);

  useEffect(() => {
    void refreshActiveJobs();
  }, [refreshActiveJobs]);

  const hasWorkingJobs = activeJobs.some((j) => j.status !== "needs_input");
  useEffect(() => {
    if (!hasWorkingJobs) return;
    const timer = window.setInterval(() => void refreshActiveJobs(), 5000);
    return () => window.clearInterval(timer);
  }, [hasWorkingJobs, refreshActiveJobs]);

  /** Runs an analysis as a Nexus job and follows it on the working screen. */
  const runAnalysisWithNexus = async (
    sb: NonNullable<typeof supabase>,
    trimmedIdea: string,
    clarificationText?: string
  ) => {
    const revising = ideas.find((i) => i.id === revisingIdeaId);
    const jobId = await enqueueJob(
      sb,
      "analyze",
      {
        rawIdea: trimmedIdea,
        clarification: clarificationText?.trim() || undefined,
        evidence: revising ? completedEvidence(revising.experiments) : undefined,
        profile: profile ?? undefined,
        language: lang,
        ideaId: revisingIdeaId ?? undefined,
      },
      answeringJobRef.current ?? undefined
    );
    answeringJobRef.current = null;
    foregroundJobRef.current = jobId;
    void refreshActiveJobs();

    const job = await watchJob(
      sb,
      jobId,
      (update) => {
        const phase = phaseForStep(update.step);
        if (phase > targetPhaseRef.current) targetPhaseRef.current = phase;
        setWaitingForQuota(update.error === "quota");
      },
      () => foregroundJobRef.current !== jobId
    );
    setWaitingForQuota(false);
    // Null means the founder sent it to the background; the home screen follows it.
    if (!job) return;
    foregroundJobRef.current = null;

    if (job.status === "needs_input") {
      answeringJobRef.current = job.id;
      setClarifyingQuestion(job.result?.question ?? "");
      setClarificationAnswer("");
      setScreen("home");
      void refreshActiveJobs();
      return;
    }
    if (job.status === "failed") {
      throw new Error(job.error === "quota" ? t.aiLimitReached : job.error || t.analysisFailed);
    }

    for (let idx = displayPhaseRef.current; idx <= STRESS_TEST_PHASES.length; idx++) {
      setActivePhaseIndex(idx);
      await new Promise((resolve) => window.setTimeout(resolve, 140));
    }
    const loaded = await store.listIdeas();
    setIdeas(loaded);
    void refreshActiveJobs();
    const ideaId = job.result?.ideaId ?? null;
    setActiveIdeaId(ideaId);
    setActiveVersionId(null);
    rememberActiveIdea(ideaId);
    resetDraft();
    setScreen(ideaId && loaded.some((i) => i.id === ideaId) ? "idea" : "home");
  };

  const handleKeepInBackground = () => {
    foregroundJobRef.current = null;
    setWaitingForQuota(false);
    resetDraft();
    rememberActiveIdea(null);
    setActiveIdeaId(null);
    setScreen("home");
    void refreshActiveJobs();
  };

  /** Re-opens a background job's clarifying question so the founder can answer it. */
  const handleAnswerJob = (job: NexusJob) => {
    resetDraft();
    answeringJobRef.current = job.id;
    setRevisingIdeaId(job.input?.ideaId ?? null);
    setRawIdea(job.input?.rawIdea ?? "");
    setClarifyingQuestion(job.result?.question ?? "");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const runAnalysis = async (ideaText: string, clarificationText?: string) => {
    const trimmedIdea = ideaText.trim();
    if (!trimmedIdea) {
      setErrorMessage(t.enterIdeaFirst);
      return;
    }

    if (clarifyingQuestion && !clarificationText?.trim()) {
      setErrorMessage(t.answerClarifying);
      return;
    }

    setErrorMessage(null);
    setSaveWarning(null);
    targetPhaseRef.current = 0;
    displayPhaseRef.current = 0;
    setActivePhaseIndex(0);
    setScreen("working");

    if (supabase && nexusAvailable(supabase)) {
      try {
        await runAnalysisWithNexus(supabase, trimmedIdea, clarificationText);
      } catch (err) {
        foregroundJobRef.current = null;
        const message = errorText(err, t.analysisFailed);
        setErrorMessage(isQuotaError(message) ? t.aiLimitReached : message);
        setScreen("home");
      }
      return;
    }

    try {
      let accessToken: string | undefined;
      if (supabase) {
        const { data } = await supabase.auth.getSession();
        accessToken = data.session?.access_token;
      }

      const revising = ideas.find((i) => i.id === revisingIdeaId);

      const result = await analyzeIdea(trimmedIdea, {
        clarification: clarificationText?.trim() || undefined,
        evidence: revising ? completedEvidence(revising.experiments) : undefined,
        accessToken,
        profile,
        language: lang,
        onPhase: (phaseIndex) => {
          if (phaseIndex > targetPhaseRef.current) {
            targetPhaseRef.current = phaseIndex;
          }
        },
      });

      if (result.status === "clarification_needed") {
        setClarifyingQuestion(result.question);
        setClarificationAnswer("");
        setScreen("home");
        return;
      }

      // Briefly light up any remaining phases in order before revealing report
      for (let idx = displayPhaseRef.current; idx <= STRESS_TEST_PHASES.length; idx++) {
        setActivePhaseIndex(idx);
        await new Promise((resolve) => window.setTimeout(resolve, 140));
      }

      const input = {
        rawIdea: trimmedIdea,
        clarification: clarificationText?.trim() || undefined,
        data: result.report,
      };

      let saved: Idea;
      try {
        saved = await store.addVersion(revisingIdeaId, input);
        // A brand-new idea starts with the report's suggested tests as its plan.
        const suggested = result.report.blueprint.validate_next
          .map((t) => t.trim())
          .filter(Boolean);
        if (!revisingIdeaId && suggested.length > 0) {
          try {
            saved = {
              ...saved,
              experiments: await store.addExperiments(saved.id, suggested),
            };
          } catch {
            // The report is saved; the founder can still track items by hand.
          }
        }
      } catch (saveErr) {
        // The analysis already ran; show it even though it could not be stored.
        const now = new Date().toISOString();
        saved = {
          id: UNSAVED_IDEA_ID,
          title: deriveTitle(result.report, trimmedIdea),
          createdAt: now,
          updatedAt: now,
          versions: [{ id: UNSAVED_IDEA_ID, createdAt: now, ...input }],
          experiments: [],
          sprint: null,
        };
        setSaveWarning(t.reportNotSaved(errorText(saveErr, t.unknownError)));
      }

      setIdeas((prev) => [saved, ...prev.filter((i) => i.id !== saved.id)]);
      setActiveIdeaId(saved.id);
      setActiveVersionId(null);
      rememberActiveIdea(saved.id === UNSAVED_IDEA_ID ? null : saved.id);
      resetDraft();
      setScreen("idea");
    } catch (err) {
      const message = errorText(err, t.analysisFailed);
      setErrorMessage(isQuotaError(message) ? t.aiLimitReached : message);
      setScreen("home");
    }
  };

  const handleSubmit = () => {
    void runAnalysis(
      rawIdea,
      clarifyingQuestion ? clarificationAnswer : undefined
    );
  };

  const goHome = () => {
    rememberActiveIdea(null);
    setActiveIdeaId(null);
    setSaveWarning(null);
    setIdeas((prev) => prev.filter((i) => i.id !== UNSAVED_IDEA_ID));
    setScreen("home");
  };

  const handleNewIdea = () => {
    resetDraft();
    goHome();
  };

  const handleSelectIdea = (idea: Idea) => {
    rememberActiveIdea(idea.id);
    setActiveIdeaId(idea.id);
    setActiveVersionId(null);
    setErrorMessage(null);
    setScreen("idea");
  };

  const openAsk = (ideaId: string | null) => {
    setAskIdeaId(ideaId);
    setAskReturn(screen === "idea" ? "idea" : "home");
    setScreen("ask");
    window.scrollTo({ top: 0 });
  };

  const handleChatAction = (action: ChatAction) => {
    if (action.type === "run_analysis") {
      handleTestIdea(action.ideaText);
      return;
    }
    if (action.type === "edit_profile") {
      setScreen("profile");
      return;
    }
    const idea = ideas.find((i) => i.id === action.ideaId);
    if (!idea) return;
    handleSelectIdea(idea);
    if (action.type === "build_sprint" && !idea.sprint) void handleBuildSprint(idea);
  };

  const handleRevise = (idea: Idea) => {
    const latest = idea.versions[0];
    resetDraft();
    setRevisingIdeaId(idea.id === UNSAVED_IDEA_ID ? null : idea.id);
    setRawIdea(
      latest.clarification
        ? `${latest.rawIdea}\n\n${latest.clarification}`
        : latest.rawIdea
    );
    goHome();
  };

  /** Starts a fresh idea pre-filled with a suggested pivot. */
  const handleTestIdea = (text: string) => {
    resetDraft();
    setRawIdea(text);
    goHome();
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const setIdeaSprint = (ideaId: string, sprint: Sprint) => {
    setIdeas((prev) => prev.map((i) => (i.id === ideaId ? { ...i, sprint } : i)));
  };

  const handleBuildSprint = async (idea: Idea) => {
    if (sprintBuildingFor) return;
    setSprintBuildingFor(idea.id);
    setSprintError(null);
    if (supabase && nexusAvailable(supabase)) {
      try {
        const jobId = await enqueueJob(
          supabase,
          "sprint",
          sprintRequest(idea, { profile, language: lang })
        );
        void refreshActiveJobs();
        const job = await watchJob(supabase, jobId, () => {}, () => false);
        if (job?.status === "failed") {
          throw new Error(job.error === "quota" ? t.aiLimitReached : job.error || t.unknownError);
        }
        await reloadIdeas();
        void refreshActiveJobs();
      } catch (err) {
        const message = errorText(err, t.unknownError);
        setSprintError({
          ideaId: idea.id,
          message: isQuotaError(message) ? t.aiLimitReached : t.sprintFailed(message),
        });
      } finally {
        setSprintBuildingFor(null);
      }
      return;
    }
    try {
      let accessToken: string | undefined;
      if (supabase) {
        const { data } = await supabase.auth.getSession();
        accessToken = data.session?.access_token;
      }
      const plan = await buildSprintPlan(idea, { accessToken, profile, language: lang });
      const sprint: Sprint = { plan, done: [], createdAt: new Date().toISOString() };
      setIdeaSprint(idea.id, sprint);
      try {
        await store.saveSprint(idea.id, sprint);
      } catch (err) {
        setSprintError({
          ideaId: idea.id,
          message: t.sprintSaveFailed(errorText(err, t.unknownError)),
        });
      }
    } catch (err) {
      const message = errorText(err, t.unknownError);
      setSprintError({
        ideaId: idea.id,
        message: isQuotaError(message) ? t.aiLimitReached : t.sprintFailed(message),
      });
    } finally {
      setSprintBuildingFor(null);
    }
  };

  // Tick or untick a task: update the screen first, then save.
  const handleToggleSprintTask = (idea: Idea, key: string) => {
    if (!idea.sprint) return;
    const done = idea.sprint.done.includes(key)
      ? idea.sprint.done.filter((k) => k !== key)
      : [...idea.sprint.done, key];
    const next = { ...idea.sprint, done };
    setIdeaSprint(idea.id, next);
    store.saveSprint(idea.id, next).catch((err) =>
      setSprintError({
        ideaId: idea.id,
        message: t.sprintSaveFailed(errorText(err, t.unknownError)),
      })
    );
  };

  const handleSaveProfile = async (next: FounderProfile) => {
    await profileStore.save(next);
    setProfile(next);
    setScreen(activeIdeaId ? "idea" : "home");
  };

  const handleLeaveProfile = () => {
    if (!profile) {
      try {
        window.localStorage.setItem(PROFILE_SKIPPED_KEY, "1");
      } catch {
        // Onboarding may show again next visit; harmless.
      }
    }
    setScreen(activeIdeaId ? "idea" : "home");
  };

  const handleDeleteIdea = async (idea: Idea) => {
    if (!window.confirm(t.deleteConfirm(idea.title, idea.versions.length))) {
      return;
    }
    try {
      if (idea.id !== UNSAVED_IDEA_ID) await store.deleteIdea(idea.id);
      setIdeas((prev) => prev.filter((i) => i.id !== idea.id));
      if (revisingIdeaId === idea.id) resetDraft();
      goHome();
    } catch (err) {
      setSaveWarning(t.deleteFailed(errorText(err, t.unknownError)));
    }
  };

  const changeExperiments = (
    ideaId: string,
    change: (experiments: Experiment[]) => Experiment[]
  ) => {
    setIdeas((prev) =>
      prev.map((i) =>
        i.id === ideaId ? { ...i, experiments: change(i.experiments) } : i
      )
    );
  };

  const reportPlanError = (err: unknown) => {
    setSaveWarning(t.planSaveFailed(errorText(err, t.unknownError)));
  };

  const handleAddExperiments = async (ideaId: string, titles: string[]) => {
    try {
      const added = await store.addExperiments(ideaId, titles);
      changeExperiments(ideaId, (list) => [...list, ...added]);
    } catch (err) {
      reportPlanError(err);
    }
  };

  // Update the screen first so typing and toggling feel instant, then save.
  const handleUpdateExperiment = (
    ideaId: string,
    experimentId: string,
    patch: ExperimentPatch
  ) => {
    changeExperiments(ideaId, (list) =>
      list.map((e) => (e.id === experimentId ? { ...e, ...patch } : e))
    );
    store.updateExperiment(ideaId, experimentId, patch).catch(reportPlanError);
  };

  const handleDeleteExperiment = (ideaId: string, experimentId: string) => {
    changeExperiments(ideaId, (list) =>
      list.filter((e) => e.id !== experimentId)
    );
    store.deleteExperiment(ideaId, experimentId).catch(reportPlanError);
  };

  if (!authReady) {
    return <p className="px-4 py-16 text-center text-sm text-[#6B6B65]">{t.loading}</p>;
  }

  if (supabase && !session) {
    return <AuthScreen supabase={supabase} />;
  }

  if (!profileLoaded) {
    return <p className="px-4 py-16 text-center text-sm text-[#6B6B65]">{t.loading}</p>;
  }

  if (screen === "profile") {
    return (
      <ProfileScreen
        initial={profile ?? emptyProfile(lang)}
        isOnboarding={!profile}
        onSave={handleSaveProfile}
        onLeave={handleLeaveProfile}
        footer={
          profile && supabase && askForgeAvailable(supabase) ? (
            <TelegramCard supabase={supabase} />
          ) : null
        }
      />
    );
  }

  if (screen === "ask" && supabase && askForgeAvailable(supabase)) {
    return (
      <AskForgeScreen
        supabase={supabase}
        ideas={ideas
          .filter((i) => i.id !== UNSAVED_IDEA_ID)
          .map((i) => ({ id: i.id, title: i.title }))}
        initialIdeaId={askIdeaId}
        onBack={() => setScreen(askReturn === "idea" && activeIdeaId ? "idea" : "home")}
        onAction={handleChatAction}
      />
    );
  }

  if (screen === "working") {
    return (
      <WorkingScreen
        activePhaseIndex={activePhaseIndex}
        ideaPreview={rawIdea.trim()}
        onBackground={nexusAvailable(supabase) ? handleKeepInBackground : undefined}
        waitingForQuota={waitingForQuota}
      />
    );
  }

  const activeIdea = ideas.find((i) => i.id === activeIdeaId) ?? null;

  if (screen === "idea" && activeIdea) {
    return (
      <ReportScreen
        idea={activeIdea}
        activeVersionId={activeVersionId}
        onSelectVersion={setActiveVersionId}
        warning={saveWarning}
        onBack={goHome}
        onNewIdea={handleNewIdea}
        onRevise={() => handleRevise(activeIdea)}
        onDelete={() => void handleDeleteIdea(activeIdea)}
        planDisabled={activeIdea.id === UNSAVED_IDEA_ID}
        onAddExperiments={(titles) =>
          void handleAddExperiments(activeIdea.id, titles)
        }
        onUpdateExperiment={(id, patch) =>
          handleUpdateExperiment(activeIdea.id, id, patch)
        }
        onDeleteExperiment={(id) => handleDeleteExperiment(activeIdea.id, id)}
        onTestIdea={handleTestIdea}
        sprintBuilding={sprintBuildingFor === activeIdea.id}
        sprintError={sprintError?.ideaId === activeIdea.id ? sprintError.message : null}
        showProfileTip={!profileHasSubstance(profile)}
        onBuildSprint={() => void handleBuildSprint(activeIdea)}
        onToggleSprintTask={(key) => handleToggleSprintTask(activeIdea, key)}
        onAsk={
          supabase && askForgeAvailable(supabase) && activeIdea.id !== UNSAVED_IDEA_ID
            ? () => openAsk(activeIdea.id)
            : undefined
        }
      />
    );
  }

  const sb = supabase;
  const signOut = sb ? () => void sb.auth.signOut() : null;
  const revisingIdea = ideas.find((i) => i.id === revisingIdeaId) ?? null;

  return (
    <InputScreen
      rawIdea={rawIdea}
      onChangeIdea={(value) => {
        setRawIdea(value);
        if (errorMessage) setErrorMessage(null);
      }}
      clarifyingQuestion={clarifyingQuestion}
      clarificationAnswer={clarificationAnswer}
      onChangeClarification={(value) => {
        setClarificationAnswer(value);
        if (errorMessage) setErrorMessage(null);
      }}
      errorMessage={errorMessage}
      onSubmit={handleSubmit}
      onRetry={handleSubmit}
      onResetClarification={() => {
        setClarifyingQuestion(null);
        setClarificationAnswer("");
        setErrorMessage(null);
      }}
      revisingTitle={revisingIdea?.title ?? null}
      revisingEvidenceCount={
        revisingIdea ? completedEvidence(revisingIdea.experiments).length : 0
      }
      onCancelRevise={resetDraft}
      ideas={ideas.filter((i) => i.id !== UNSAVED_IDEA_ID)}
      ideasLoading={ideasLoading}
      onSelectIdea={handleSelectIdea}
      userEmail={session?.user.email ?? null}
      onSignOut={signOut}
      onOpenProfile={() => setScreen("profile")}
      onOpenAsk={supabase && askForgeAvailable(supabase) ? () => openAsk(null) : undefined}
      founderName={profile?.name.trim().split(/\s+/)[0] ?? ""}
      activeJobs={activeJobs}
      onAnswerJob={handleAnswerJob}
      showProfileNudge={!profileHasSubstance(profile)}
    />
  );
}
