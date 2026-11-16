import type { StoredForgeReport } from "./analyzeIdea";

export function getVerdictLabel(score: number): string {
  if (score >= 80) return "Strong case to build";
  if (score >= 65) return "Viable with real hurdles";
  if (score >= 45) return "Needs sharper focus before building";
  if (score >= 25) return "Weak foundation as framed";
  return "Do not build as currently framed";
}

export function formatReportAsMarkdown(report: StoredForgeReport): string {
  const { data } = report;
  const verdict = getVerdictLabel(data.idea_score.overall);

  const lines: string[] = [
    "# FORGE Reality-Check Report",
    "",
    `## Summary`,
    data.idea_summary,
    "",
    `## Verdict: ${data.idea_score.overall}/100 — ${verdict}`,
    `Confidence: ${data.idea_score.confidence}`,
    "",
    data.idea_score.rationale,
    "",
    "### Score Breakdown",
    `- Problem clarity: ${data.idea_score.breakdown.problem_clarity}/10`,
    `- Market signal: ${data.idea_score.breakdown.market_signal}/10`,
    `- Founder fit: ${data.idea_score.breakdown.founder_fit}/10`,
    `- Feasibility: ${data.idea_score.breakdown.feasibility}/10`,
    `- Differentiation: ${data.idea_score.breakdown.differentiation}/10`,
    "",
    "## What I Couldn't Verify",
    ...(data.grounding_flags.length > 0
      ? data.grounding_flags.map((f) => `- ${f}`)
      : ["- No major verification flags recorded, though estimates remain unverified."]),
    "",
    "## SWOT Analysis",
    "### Strengths",
    ...(data.swot.strengths.length > 0 ? data.swot.strengths.map((s) => `- ${s}`) : ["- None noted"]),
    "",
    "### Weaknesses",
    ...(data.swot.weaknesses.length > 0 ? data.swot.weaknesses.map((w) => `- ${w}`) : ["- None noted"]),
    "",
    "### Opportunities",
    ...(data.swot.opportunities.length > 0 ? data.swot.opportunities.map((o) => `- ${o}`) : ["- None noted"]),
    "",
    "### Threats",
    ...(data.swot.threats.length > 0 ? data.swot.threats.map((t) => `- ${t}`) : ["- None noted"]),
    "",
    "## Competitors",
    ...(data.competitors.length > 0
      ? data.competitors.map(
          (c) => `- **${c.name}**: ${c.what_they_do}${c.source_url ? ` (${c.source_url})` : ""}`
        )
      : ["- Could not verify competitors from live search sources."]),
    "",
    "## Blueprint",
    `- **Problem**: ${data.blueprint.problem}`,
    `- **Target user**: ${data.blueprint.target_user}`,
    `- **Solution**: ${data.blueprint.solution}`,
    `- **Business model**: ${data.blueprint.business_model}`,
    "",
    "### Key Risks",
    ...(data.blueprint.key_risks.length > 0 ? data.blueprint.key_risks.map((r) => `- ${r}`) : ["- None listed"]),
    "",
    "### Validate Next",
    ...(data.blueprint.validate_next.length > 0
      ? data.blueprint.validate_next.map((v) => `- ${v}`)
      : ["- None listed"]),
    "",
    "## Business Plan",
    `- **TAM [ESTIMATE]**: ${data.business_plan.tam_estimate}`,
    `- **Pricing hypothesis [ESTIMATE]**: ${data.business_plan.pricing_hypothesis}`,
    `- **Go-to-market**: ${data.business_plan.go_to_market}`,
    "",
    "### Key Assumptions [ESTIMATE]",
    ...(data.business_plan.assumptions.length > 0
      ? data.business_plan.assumptions.map((a) => `- ${a}`)
      : ["- None listed"]),
    "",
    "## Sources",
    ...(data.sources.length > 0
      ? data.sources.map((s) => `- [${s.title}](${s.url})`)
      : ["- No verified web sources retrieved."]),
  ];

  return lines.join("\n");
}
