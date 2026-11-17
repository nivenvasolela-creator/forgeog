// Who is calling, and how often. Plain fetch so it runs in Node and Deno.

export type UserCheck =
  | { status: "ok"; userId: string }
  | { status: "invalid" }
  | { status: "unreachable" };

/** Asks Supabase Auth who owns the bearer token in an Authorization header. */
export async function verifyUser(
  supabaseUrl: string,
  publicKey: string,
  authorizationHeader: string | null | undefined
): Promise<UserCheck> {
  const header = authorizationHeader ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return { status: "invalid" };
  try {
    const response = await fetch(`${supabaseUrl.replace(/\/+$/, "")}/auth/v1/user`, {
      headers: { apikey: publicKey, Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (response.status === 401 || response.status === 403) {
      return { status: "invalid" };
    }
    if (!response.ok) return { status: "unreachable" };
    const user = (await response.json()) as { id?: unknown };
    return typeof user.id === "string"
      ? { status: "ok", userId: user.id }
      : { status: "invalid" };
  } catch {
    return { status: "unreachable" };
  }
}

export const RATE_LIMIT_WINDOW_SECONDS = 10 * 60;
export const DEFAULT_RATE_LIMIT_MAX = 10;

/** Sliding window kept in memory: fine for one long-lived server process. */
export function createMemoryRateLimiter(max: number) {
  const log = new Map<string, number[]>();
  const windowMs = RATE_LIMIT_WINDOW_SECONDS * 1000;
  return (key: string): boolean => {
    const now = Date.now();
    const recent = (log.get(key) ?? []).filter((t) => now - t < windowMs);
    const allowed = recent.length < max;
    if (allowed) recent.push(now);
    log.set(key, recent);
    if (log.size > 5000) {
      for (const [k, times] of log) {
        if (times.every((t) => now - t >= windowMs)) log.delete(k);
      }
    }
    return allowed;
  };
}

/**
 * Counts the run in the database, for hosts whose processes do not live long
 * enough to remember (edge functions). Returns false when over the limit.
 * If the database cannot be reached the run is allowed rather than blocked.
 */
export async function recordRunInDatabase(
  supabaseUrl: string,
  serviceKey: string,
  userId: string,
  max: number
): Promise<boolean> {
  try {
    const response = await fetch(
      `${supabaseUrl.replace(/\/+$/, "")}/rest/v1/rpc/record_analysis_run`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
        },
        body: JSON.stringify({
          p_user_id: userId,
          p_max: max,
          p_window_seconds: RATE_LIMIT_WINDOW_SECONDS,
        }),
        signal: AbortSignal.timeout(10_000),
      }
    );
    if (!response.ok) {
      console.error("rate limit check failed:", response.status, await response.text());
      return true;
    }
    return (await response.json()) !== false;
  } catch (err) {
    console.error("rate limit check failed:", err);
    return true;
  }
}

export const MESSAGES = {
  sessionExpired: "Your session has expired. Sign in again to run an analysis.",
  authUnreachable:
    "Could not reach the sign-in service to check your session. Try again in a moment.",
  rateLimited: "Too many analyses in a short time. Wait a few minutes and try again.",
};
