import { useEffect, useRef, useState } from "react";
import { InputScreen } from "./components/InputScreen";
import { ReportScreen } from "./components/ReportScreen";
import { WorkingScreen } from "./components/WorkingScreen";
import {
  analyzeIdea,
  STRESS_TEST_PHASES,
  type StoredForgeReport,
} from "./lib/analyzeIdea";
import {
  clearStoredReports,
  loadActiveReportId,
  loadStoredReports,
  saveReportToStorage,
  setActiveReportId,
} from "./lib/storage";

type FlowScreen = "input" | "working" | "report";

export default function App() {
  const [recentReports, setRecentReports] = useState<StoredForgeReport[]>(() =>
    loadStoredReports()
  );

  const [activeReport, setActiveReport] = useState<StoredForgeReport | null>(
    () => {
      const saved = loadStoredReports();
      const activeId = loadActiveReportId();
      if (!activeId) return null;
      return saved.find((r) => r.id === activeId) ?? null;
    }
  );

  const [screen, setScreen] = useState<FlowScreen>(() => {
    const saved = loadStoredReports();
    const activeId = loadActiveReportId();
    if (activeId && saved.some((r) => r.id === activeId)) {
      return "report";
    }
    return "input";
  });

  const [rawIdea, setRawIdea] = useState("");
  const [clarifyingQuestion, setClarifyingQuestion] = useState<string | null>(
    null
  );
  const [clarificationAnswer, setClarificationAnswer] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [activePhaseIndex, setActivePhaseIndex] = useState(0);

  const targetPhaseRef = useRef(0);
  const displayPhaseRef = useRef(0);

  // Smoothly step the 6 stress-test phases in order on Screen 2
  useEffect(() => {
    if (screen !== "working") return;

    const timer = window.setInterval(() => {
      setActivePhaseIndex((prev) => {
        const next =
          prev < targetPhaseRef.current
            ? prev + 1
            : prev < STRESS_TEST_PHASES.length - 1
            ? prev
            : prev;
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
    targetPhaseRef.current = 0;
    displayPhaseRef.current = 0;
    setActivePhaseIndex(0);
    setScreen("working");

    try {
      const result = await analyzeIdea(trimmedIdea, {
        clarification: clarificationText?.trim() || undefined,
        onPhase: (phaseIndex) => {
          if (phaseIndex > targetPhaseRef.current) {
            targetPhaseRef.current = phaseIndex;
          }
        },
      });

      if (result.status === "clarification_needed") {
        setClarifyingQuestion(result.question);
        setClarificationAnswer("");
        setScreen("input");
        return;
      }

      // Briefly light up any remaining phases in order before revealing report
      for (let idx = displayPhaseRef.current; idx <= STRESS_TEST_PHASES.length; idx++) {
        setActivePhaseIndex(idx);
        await new Promise((resolve) => window.setTimeout(resolve, 140));
      }

      const newReport: StoredForgeReport = {
        id:
          typeof crypto !== "undefined" && "randomUUID" in crypto
            ? crypto.randomUUID()
            : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        createdAt: new Date().toISOString(),
        rawIdea: trimmedIdea,
        clarification: clarificationText?.trim() || undefined,
        data: result.report,
      };

      const updated = saveReportToStorage(newReport);
      setRecentReports(updated);
      setActiveReport(newReport);
      setScreen("report");
    } catch (err) {
      const msg =
        err instanceof Error && err.message
          ? err.message
          : "Analysis failed unexpectedly. Please try again.";
      setErrorMessage(msg);
      setScreen("input");
    }
  };

  const handleSubmit = () => {
    void runAnalysis(
      rawIdea,
      clarifyingQuestion ? clarificationAnswer : undefined
    );
  };

  const handleRetry = () => {
    void runAnalysis(
      rawIdea,
      clarifyingQuestion ? clarificationAnswer : undefined
    );
  };

  const handleValidateAnother = () => {
    setActiveReportId(null);
    setActiveReport(null);
    setRawIdea("");
    setClarifyingQuestion(null);
    setClarificationAnswer("");
    setErrorMessage(null);
    setScreen("input");
  };

  const handleSelectReport = (report: StoredForgeReport) => {
    setActiveReportId(report.id);
    setActiveReport(report);
    setErrorMessage(null);
    setScreen("report");
  };

  const handleClearHistory = () => {
    clearStoredReports();
    setRecentReports([]);
  };

  if (screen === "working") {
    return (
      <WorkingScreen
        activePhaseIndex={activePhaseIndex}
        ideaPreview={rawIdea.trim()}
      />
    );
  }

  if (screen === "report" && activeReport) {
    return (
      <ReportScreen
        report={activeReport}
        onValidateAnother={handleValidateAnother}
      />
    );
  }

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
      onRetry={handleRetry}
      onResetClarification={() => {
        setClarifyingQuestion(null);
        setClarificationAnswer("");
        setErrorMessage(null);
      }}
      recentReports={recentReports}
      onSelectReport={handleSelectReport}
      onClearHistory={handleClearHistory}
    />
  );
}
