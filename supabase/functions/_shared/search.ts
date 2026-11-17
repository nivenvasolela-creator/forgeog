// Web search used to ground competitor and market claims in real pages.
// Tavily is used because its free plan needs no card; the interface is small
// enough that another provider can be swapped in.

export interface SearchHit {
  title: string;
  url: string;
  /** Short extract of the page relevant to the query. */
  snippet: string;
}

export interface WebSearch {
  label: string;
  search(query: string, maxResults: number): Promise<SearchHit[]>;
}

export function createSearch(
  env: Record<string, string | undefined>
): WebSearch | null {
  const apiKey = env.TAVILY_API_KEY?.trim();
  if (!apiKey) return null;

  return {
    label: "Tavily",
    async search(query, maxResults) {
      const response = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          query: query.slice(0, 380),
          max_results: maxResults,
          search_depth: "basic",
        }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) {
        const detail = (await response.text()).slice(0, 200);
        throw new Error(`Web search failed (${response.status}): ${detail}`);
      }
      const body = (await response.json()) as {
        results?: Array<{ title?: unknown; url?: unknown; content?: unknown }>;
      };
      const hits: SearchHit[] = [];
      for (const r of body.results ?? []) {
        if (typeof r.url !== "string" || !/^https?:\/\//.test(r.url)) continue;
        hits.push({
          url: r.url,
          title:
            typeof r.title === "string" && r.title.trim() ? r.title.trim() : r.url,
          snippet:
            typeof r.content === "string"
              ? r.content.replace(/\s+/g, " ").trim().slice(0, 600)
              : "",
        });
      }
      return hits;
    },
  };
}
