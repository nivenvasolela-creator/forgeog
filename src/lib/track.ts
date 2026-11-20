// Product analytics: what founders use, where they get stuck, and what breaks.
// Events go to FORGE's own database (no third-party tracker). Only signed-in
// founders are counted, events are sent in small batches, and tracking never
// throws or slows the app.
import type { SupabaseClient } from "@supabase/supabase-js";

interface PendingEvent {
  name: string;
  screen: string | null;
  props: Record<string, unknown>;
  session_id: string;
  user_id: string;
  created_at: string;
}

let client: SupabaseClient | null = null;
let userId: string | null = null;
let currentScreen: string | null = null;
let queue: PendingEvent[] = [];
let timer: number | undefined;
let errorsThisSession = 0;

const SESSION_KEY = "forge_session_v1";
const FLUSH_MS = 4000;
const MAX_QUEUE = 50;

function sessionId(): string {
  try {
    let id = window.sessionStorage.getItem(SESSION_KEY);
    if (!id) {
      id = Math.random().toString(36).slice(2) + Date.now().toString(36);
      window.sessionStorage.setItem(SESSION_KEY, id);
    }
    return id;
  } catch {
    return "no-session";
  }
}

/** Keeps props small and free of anything that is not a short value. */
function clean(props: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(props).slice(0, 12)) {
    if (typeof v === "string") out[k] = v.slice(0, 200);
    else if (typeof v === "number" || typeof v === "boolean" || v === null) out[k] = v;
  }
  return out;
}

async function flush(): Promise<void> {
  timer = undefined;
  if (!client || queue.length === 0) return;
  const batch = queue;
  queue = [];
  try {
    await client.from("events").insert(batch);
  } catch {
    // Analytics must never get in the founder's way.
  }
}

function schedule(): void {
  if (queue.length >= MAX_QUEUE) {
    void flush();
    return;
  }
  if (timer === undefined) timer = window.setTimeout(() => void flush(), FLUSH_MS);
}

/** Records one event for the signed-in founder. Safe to call anywhere. */
export function track(name: string, props: Record<string, unknown> = {}): void {
  if (!client || !userId) return;
  queue.push({
    name,
    screen: currentScreen,
    props: clean(props),
    session_id: sessionId(),
    user_id: userId,
    created_at: new Date().toISOString(),
  });
  schedule();
}

/** Records a screen change (and remembers it for later events). */
export function trackScreen(screen: string): void {
  if (screen === currentScreen) return;
  currentScreen = screen;
  track("screen_view", { screen });
}

export function currentTrackedScreen(): string | null {
  return currentScreen;
}

/** Starts or stops tracking as the founder signs in and out. */
export function setTrackingUser(sb: SupabaseClient | null, id: string | null): void {
  const wasSignedOut = !userId;
  client = sb;
  userId = id;
  if (id && wasSignedOut) {
    let firstThisSession = true;
    try {
      firstThisSession = !window.sessionStorage.getItem(`${SESSION_KEY}_opened`);
      window.sessionStorage.setItem(`${SESSION_KEY}_opened`, "1");
    } catch {
      // Count it anyway.
    }
    if (firstThisSession) {
      track("app_open", {
        lang: document.documentElement.lang || "en",
        mobile: window.matchMedia("(max-width: 640px)").matches,
      });
    }
  }
}

let listening = false;

/** Sends queued events when the tab is hidden, and records crashes. Call once. */
export function startTracking(): void {
  if (listening) return;
  listening = true;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void flush();
  });
  const report = (message: string) => {
    if (errorsThisSession++ >= 10) return;
    track("client_error", { message });
  };
  window.addEventListener("error", (e) => report(String(e.message || "Unknown error")));
  window.addEventListener("unhandledrejection", (e) => {
    const reason = (e as PromiseRejectionEvent).reason;
    report(reason instanceof Error ? reason.message : String(reason));
  });
}
