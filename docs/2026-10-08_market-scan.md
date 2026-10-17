# Site Notes - market scan 2026-10-08

Question (MJ): there are plenty of annotators; why is ours different, which niche can it win, is it a good human<->AI and
human<->human feedback loop, can it make USD 2,500/month?

Sources: Perplexity Deep Research thread https://www.perplexity.ai/search/37aa8bad-dc9c-4d70-b8e8-f27549427c70
(534 sources, run 2026-10-08) plus four vendor pages fetched with curl and read verbatim. Levels: `[4 HIGH]` = vendor page
read verbatim + Perplexity; `[2 LOW]` = Perplexity only (its sources not opened here); Latka numbers are estimates.

## Who already closes the human -> AI agent loop

| Tool | What it does | Price | Level |
|---|---|---|---|
| Pastel (usepastel.com/agents) | "Your agent picks up open comments, the exact element they're pinned to, and any images your reviewers attached. It makes the changes and marks comments as resolved." MCP, Cursor / Claude / ChatGPT | Pro USD 35, Team 119, Enterprise 450 | loop [4 HIGH]; prices [2 LOW] |
| FasterFixes (faster-fixes.com/pricing) | widget + dashboard + MCP for Claude Code, Cursor, Codex; agents fetch feedback and update status | "$0 self-hosted, $20/mo flat rate"; Agency USD 99 | prices [4 HIGH]; AGPL, MCP scope [2 LOW] |
| Agentation (agentation.dev) | click element -> structured context; with MCP "Agent resolves with a summary" | free for internal use; commercial license to redistribute | [4 HIGH] |
| PinAppAI (pinappai.com) | agent applies changes, "/changes/ page generated", before/after per change, "Approve / Reject / Request change" | not read | [4 HIGH] |
| Stagewise, React Grab, Onlook, Vercel Toolbar, Lovable/Bolt visual edit | developer- or platform-side element -> agent context; per-hunk accept/reject (Stagewise) | mostly open source / platform plans | [2 LOW] |

Classic tools (BugHerd USD 42-125, Userback 39-89, Marker.io from ~39, Superflow 24-34/seat, Atarim 67) target agencies,
mostly without a repository-writing agent bridge. [2 LOW]

Revenue (Latka estimates via Perplexity, [2 LOW]): Marker.io ~USD 492k (2024), BugHerd ~USD 2.5M, Usersnap ~USD 6.5M (2024),
Pastel USD 142.8k (2020). Ruttl AppSumo launch USD 40-60k in 5 days (one-off). SMB SaaS churn 3-7%/month (generic benchmark).
No standalone market-size figure for visual website feedback exists; bug-tracking software ~USD 0.6-0.7B (2025-26). [2 LOW]

## What is left that only Site Notes does (as far as verified)
Per element on the live page: green marker of what the agent changed, Keep / Revert, "Changes" view with the rest dimmed;
hub self-hosted inside each site (PHP + SQLite, no account, secret link); export grouped by page with `data-src` source
hints; works with any agent via a CLI, no MCP needed. Each piece exists somewhere (Pastel: agent loop; PinAppAI: per-change
approve/reject; FasterFixes: self-host); the combination was not found. [2 LOW | Perplexity "no product satisfies all"]
A combination is a feature, not a moat: Pastel or FasterFixes can add Keep/Revert. [1 SPECULATIVE]

## USD 2,500 / month, arithmetic (computed 2026-10-08)

| Price / month | Customers needed | New paying per month to get there in 12 months at 3% / 5% / 8% churn |
|---|---|---|
| 19 | 132 | 12.9 / 14.3 / 16.6 |
| 29 | 86 | 8.4 / 9.4 / 10.9 |
| 49 | 51 | 5.0 / 5.6 / 6.5 |
| 99 | 25 | 2.5 / 2.7 / 3.2 |
| 250 | 10 | 1.0 / 1.1 / 1.3 |
| 500 | 5 | 0.5 / 0.5 / 0.6 |

Formula: N(t) = (a/c)(1-(1-c)^t), a = new paying per month, c = monthly churn.
