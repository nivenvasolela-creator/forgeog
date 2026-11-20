// Sends founder feedback to the team (admin inbox, plus email/WhatsApp).
import type { SupabaseClient } from "@supabase/supabase-js";
import { callApi } from "./askForge";
import { currentTrackedScreen, track } from "./track";

export type FeedbackKind = "bug" | "idea" | "confusing" | "praise" | "rating" | "other";

export interface FeedbackPayload {
  kind: FeedbackKind;
  rating?: number | null;
  message?: string;
  context?: Record<string, string | number | boolean>;
  contactOk?: boolean;
}

export async function sendFeedback(sb: SupabaseClient, payload: FeedbackPayload): Promise<void> {
  const screen = currentTrackedScreen();
  await callApi(sb, "feedback", {
    kind: payload.kind,
    rating: payload.rating ?? null,
    message: payload.message ?? "",
    screen,
    context: {
      ...payload.context,
      width: window.innerWidth,
      lang: document.documentElement.lang || "en",
    },
    contactOk: payload.contactOk ?? false,
  });
  track("feedback_sent", { kind: payload.kind, rating: payload.rating ?? null });
}
