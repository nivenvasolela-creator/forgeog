import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { AuthScreen } from "./components/AuthScreen";
import { InputScreen } from "./components/InputScreen";
import { ReportScreen } from "./components/ReportScreen";
import { WorkingScreen } from "./components/WorkingScreen";
import { analyzeIdea, STRESS_TEST_PHASES, type Idea } from "./lib/analyzeIdea";
import {
  createLocalStore,
  createSupabaseStore,
  deriveTitle,
} from "./lib/store";
import { supabase } from "./lib/supabase";

type FlowScreen = "home" | "working" | "idea";

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

  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [ideasLoading, setIdeasLoading] = useState(true);
  const [screen, setScreen] = useState<FlowScreen>("home");
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
        setErrorMessage(
          `Could not load your saved ideas (${
            err instanceof Error ? err.message : "unknown error"
          }).`
        );
      })
      .finally(() => {
        if (!cancelled) setIdeasLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [authReady, userId, store, resetDraft]);

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

  const runAnalysis = async (ideaText: string, clarificationText?: string) => {
    const trimmedIdea = ideaText.trim();
    if (!trimmedIdea) {
      setErrorMessage(
        "Enter your startup idea first so there is something to test."
      );
      return;
    }

    if (clarifyingQuestion && !clarificationText?.trim()) {
      setErrorMessage("Answer the clarifying question so FORGE can judge the idea.");
      return;
    }

    setErrorMessage(null);
    setSaveWarning(null);
    targetPhaseRef.current = 0;
    displayPhaseRef.current = 0;
    setActivePhaseIndex(0);
    setScreen("working");

    try {
      let accessToken: string | undefined;
      if (supabase) {
        const { data } = await supabase.auth.getSession();
        accessToken = data.session?.access_token;
      }

      const result = await analyzeIdea(trimmedIdea, {
        clarification: clarificationText?.trim() || undefined,
        accessToken,
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
      } catch (saveErr) {
        // The analysis already ran; show it even though it could not be stored.
        const now = new Date().toISOString();
        saved = {
          id: UNSAVED_IDEA_ID,
          title: deriveTitle(result.report, trimmedIdea),
          createdAt: now,
          updatedAt: now,
          versions: [{ id: UNSAVED_IDEA_ID, createdAt: now, ...input }],
        };
        setSaveWarning(
          `This report could not be saved (${
            saveErr instanceof Error ? saveErr.message : "unknown error"
          }). Copy it as Markdown before leaving this page.`
        );
      }

      setIdeas((prev) => [saved, ...prev.filter((i) => i.id !== saved.id)]);
      setActiveIdeaId(saved.id);
      setActiveVersionId(null);
      rememberActiveIdea(saved.id === UNSAVED_IDEA_ID ? null : saved.id);
      resetDraft();
      setScreen("idea");
    } catch (err) {
      const msg =
        err instanceof Error && err.message
          ? err.message
          : "Analysis failed unexpectedly. Please try again.";
      setErrorMessage(msg);
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

  const handleDeleteIdea = async (idea: Idea) => {
    if (
      !window.confirm(
        `Delete "${idea.title}" and all ${idea.versions.length} of its reports? This cannot be undone.`
      )
    ) {
      return;
    }
    try {
      if (idea.id !== UNSAVED_IDEA_ID) await store.deleteIdea(idea.id);
      setIdeas((prev) => prev.filter((i) => i.id !== idea.id));
      if (revisingIdeaId === idea.id) resetDraft();
      goHome();
    } catch (err) {
      setSaveWarning(
        `Could not delete this idea (${
          err instanceof Error ? err.message : "unknown error"
        }).`
      );
    }
  };

  if (!authReady) {
    return (
      <p className="px-4 py-16 text-center text-sm text-[#6B6B65]">Loading...</p>
    );
  }

  if (supabase && !session) {
    return <AuthScreen supabase={supabase} />;
  }

  if (screen === "working") {
    return (
      <WorkingScreen
        activePhaseIndex={activePhaseIndex}
        ideaPreview={rawIdea.trim()}
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
      onCancelRevise={resetDraft}
      ideas={ideas.filter((i) => i.id !== UNSAVED_IDEA_ID)}
      ideasLoading={ideasLoading}
      onSelectIdea={handleSelectIdea}
      userEmail={session?.user.email ?? null}
      onSignOut={signOut}
    />
  );
}
