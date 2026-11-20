// Client side of Ask FORGE (the founder's chat) and the Telegram connection.
// Both live on the hosted API; the chat history is read straight from the
// database (each founder can only read their own rows).
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Language } from "./i18n";

const API_URL = import.meta.env.VITE_API_URL?.trim() ?? "";

export type ChatAction =
  | { type: "run_analysis"; ideaText: string }
  | { type: "open_idea"; ideaId: string; title: string }
  | { type: "build_sprint"; ideaId: string; title: string }
  | { type: "edit_profile" };

export interface ChatSource {
  title: string;
  url: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources: ChatSource[];
  actions: ChatAction[];
  channel: "web" | "telegram";
  created_at: string;
  /** Set on a local message that failed to send. */
  failed?: boolean;
}

export function askForgeAvailable(sb: SupabaseClient | null): boolean {
  return Boolean(sb && API_URL);
}

async function callApi<T>(
  sb: SupabaseClient,
  action: string,
  body: Record<string, unknown>,
): Promise<T> {
  const { data } = await sb.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Your session has expired. Sign in again.");
  const response = await fetch(`${API_URL}?action=${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const json = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) {
    throw new Error(json.error || `Request failed with status ${response.status}.`);
  }
  return json;
}

const HISTORY_LIMIT = 60;

export async function loadChat(sb: SupabaseClient): Promise<ChatMessage[]> {
  const { data, error } = await sb
    .from("chat_messages")
    .select("id, role, content, data, channel, created_at")
    .order("created_at", { ascending: false })
    .limit(HISTORY_LIMIT);
  if (error) throw new Error(error.message);
  return (data ?? []).reverse().map((row) => {
    const extra = (row.data ?? {}) as { sources?: ChatSource[]; actions?: ChatAction[] };
    return {
      id: row.id as string,
      role: row.role as ChatMessage["role"],
      content: row.content as string,
      sources: Array.isArray(extra.sources) ? extra.sources : [],
      actions: Array.isArray(extra.actions) ? extra.actions : [],
      channel: row.channel as ChatMessage["channel"],
      created_at: row.created_at as string,
    };
  });
}

export async function sendChat(
  sb: SupabaseClient,
  message: string,
  ideaId: string | null,
  language: Language,
): Promise<{ reply: string; sources: ChatSource[]; actions: ChatAction[] }> {
  return callApi(sb, "chat", { message, ideaId, language });
}

export async function clearChat(sb: SupabaseClient): Promise<void> {
  const { data } = await sb.auth.getSession();
  const userId = data.session?.user.id;
  if (!userId) return;
  const { error } = await sb.from("chat_messages").delete().eq("user_id", userId);
  if (error) throw new Error(error.message);
}

// ---------------------------------------------------------------------------
// Telegram
// ---------------------------------------------------------------------------

export interface TelegramStatus {
  connected: boolean;
  briefEnabled: boolean;
}

let telegramReady: Promise<boolean> | null = null;

/** True when the server has a Telegram bot set up (asked once per visit). */
export function telegramAvailable(): Promise<boolean> {
  if (!API_URL) return Promise.resolve(false);
  telegramReady ??= fetch(API_URL)
    .then((r) => r.json())
    .then((h: { telegram?: boolean }) => h.telegram === true)
    .catch(() => false);
  return telegramReady;
}

export async function getTelegramStatus(sb: SupabaseClient): Promise<TelegramStatus> {
  const { data, error } = await sb
    .from("telegram_links")
    .select("chat_id, brief_enabled")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return { connected: Boolean(data?.chat_id), briefEnabled: data?.brief_enabled ?? true };
}

export async function createTelegramLink(sb: SupabaseClient): Promise<string> {
  const { url } = await callApi<{ url: string }>(sb, "telegram_link", {});
  return url;
}

export async function setBriefEnabled(sb: SupabaseClient, enabled: boolean): Promise<void> {
  const { data } = await sb.auth.getSession();
  const userId = data.session?.user.id;
  if (!userId) return;
  const { error } = await sb
    .from("telegram_links")
    .update({ brief_enabled: enabled })
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
}

export async function disconnectTelegram(sb: SupabaseClient): Promise<void> {
  const { data } = await sb.auth.getSession();
  const userId = data.session?.user.id;
  if (!userId) return;
  const { error } = await sb.from("telegram_links").delete().eq("user_id", userId);
  if (error) throw new Error(error.message);
}
