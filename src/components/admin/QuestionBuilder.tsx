"use client";

import { CircleAlert, CircleCheck, Info, LogOut, Plus, Search, ShieldCheck, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { POSITION_LABELS } from "@/lib/baseball/criteria";
import { POSITIONS } from "@/types/baseball";
import type { ValidationReport } from "@/lib/questions/validate-question";
import type { AnswerTest, DraftView, EligibleRow, QuestionList } from "@/server/admin-questions";

// ----- API -------------------------------------------------------------------------------

class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function api<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(path, {
    method: init?.method ?? "GET",
    headers: init?.body !== undefined || (init?.method && init.method !== "GET") ? { "Content-Type": "application/json" } : undefined,
    body: init?.body !== undefined ? JSON.stringify(init.body) : init?.method && init.method !== "GET" ? "{}" : undefined,
    cache: "no-store",
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string } | null)?.error ?? `Request failed (${res.status})`);
  return data as T;
}

interface Options {
  dataset: { source: string; release: string; license: string };
  firstSeason: number;
  lastSeason: number;
  stats: { key: string; label: string }[];
  teams: { id: string; name: string }[];
  franchises: { id: string; name: string }[];
  countries: { name: string; count: number }[];
  usStates: { name: string; count: number }[];
}

// ----- Criteria form ---------------------------------------------------------------------

type CriteriaType =
  | "stat_threshold"
  | "franchise"
  | "team"
  | "position"
  | "season"
  | "debut"
  | "award"
  | "hall_of_fame"
  | "all_star"
  | "world_series_champion"
  | "birthplace";

const CATEGORY_LABELS: Record<CriteriaType, string> = {
  stat_threshold: "Statistical threshold",
  franchise: "Team membership: franchise history",
  team: "Team membership: one team name",
  position: "Position",
  season: "Season or era",
  debut: "Career start",
  award: "Award (MVP / Cy Young)",
  hall_of_fame: "Hall of Fame",
  all_star: "All-Star selection",
  world_series_champion: "World Series champion",
  birthplace: "Birthplace",
};

type Form = Record<string, string>;

const DEFAULT_FORM: Form = {
  type: "stat_threshold",
  stat: "homeRuns",
  scope: "career",
  value: "300",
  franchiseId: "",
  teamId: "",
  position: "c",
  minimumGames: "100",
  from: "1990",
  to: "1999",
  before: "1950",
  award: "mvp",
  minimumSelections: "1",
  year: "",
  minimumTitles: "1",
  country: "Japan",
  state: "",
  birthMode: "country",
};

const int = (s: string) => (s.trim() === "" ? undefined : Number(s));

/** JSON with sorted keys: Postgres jsonb reorders object keys, so compare content, not key order. */
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as object)
      .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableJson((value as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Form fields → the structured criteria object the server validates (zod) and the game uses. */
function toCriteria(f: Form): Record<string, unknown> {
  switch (f.type as CriteriaType) {
    case "stat_threshold":
      return { type: "stat_threshold", stat: f.stat, scope: f.scope, operator: ">=", value: int(f.value) };
    case "franchise":
      return { type: "franchise", franchiseId: f.franchiseId };
    case "team":
      return { type: "team", teamIds: [f.teamId] };
    case "position":
      return { type: "position", position: f.position, minimumGames: int(f.minimumGames) };
    case "season":
      return { type: "season", from: int(f.from), to: int(f.to) };
    case "debut":
      return { type: "debut", before: int(f.before) };
    case "award":
      return { type: "award", award: f.award };
    case "hall_of_fame":
      return { type: "hall_of_fame" };
    case "all_star":
      return f.year.trim() ? { type: "all_star", minimumSelections: 1, year: int(f.year) } : { type: "all_star", minimumSelections: int(f.minimumSelections) };
    case "world_series_champion":
      return f.year.trim() ? { type: "world_series_champion", minimumTitles: 1, year: int(f.year) } : { type: "world_series_champion", minimumTitles: int(f.minimumTitles) };
    case "birthplace":
      if (f.birthMode === "outside") return { type: "birthplace", excludeCountries: ["USA", "P.R.", "U.S. Virgin Islands", "Guam", "American Samoa"] };
      return f.birthMode === "state" ? { type: "birthplace", country: "USA", state: f.state } : { type: "birthplace", country: f.country };
  }
}

function fromCriteria(c: Record<string, unknown>): Form {
  const f: Form = { ...DEFAULT_FORM, type: String(c.type) };
  const s = (v: unknown) => (v === undefined || v === null ? "" : String(v));
  switch (c.type) {
    case "stat_threshold":
      Object.assign(f, { stat: s(c.stat), scope: s(c.scope), value: s(c.value) });
      break;
    case "franchise":
      f.franchiseId = s(c.franchiseId);
      break;
    case "team":
      f.teamId = s((c.teamIds as string[] | undefined)?.[0]);
      break;
    case "position":
      Object.assign(f, { position: s(c.position), minimumGames: s(c.minimumGames) });
      break;
    case "season":
      Object.assign(f, { from: s(c.from), to: s(c.to) });
      break;
    case "debut":
      f.before = s(c.before);
      break;
    case "award":
      f.award = s(c.award);
      break;
    case "all_star":
      Object.assign(f, { minimumSelections: s(c.minimumSelections), year: s(c.year) });
      break;
    case "world_series_champion":
      Object.assign(f, { minimumTitles: s(c.minimumTitles), year: s(c.year) });
      break;
    case "birthplace":
      if (c.excludeCountries) f.birthMode = "outside";
      else if (c.state) Object.assign(f, { birthMode: "state", state: s(c.state) });
      else Object.assign(f, { birthMode: "country", country: s(c.country) });
      break;
  }
  return f;
}

// ----- Small UI pieces ---------------------------------------------------------------------

const input =
  "h-10 w-full rounded-lg bg-cream-50 px-3 text-[15px] text-ink ring-1 ring-cream-300 focus:outline-none focus:ring-2 focus:ring-stitch-500";

function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="font-semibold text-ink">{label}</span>
      {children}
      {hint && <span className="text-xs text-ink-muted">{hint}</span>}
    </label>
  );
}

const STATUS_STYLES: Record<DraftView["status"], string> = {
  draft: "bg-cream-200 text-ink-muted",
  validated: "bg-single-100 text-single-600",
  published: "bg-turf-100 text-turf-600",
  disabled: "bg-stitch-100 text-stitch-600",
};

function StatusChip({ status }: { status: DraftView["status"] }) {
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider ${STATUS_STYLES[status]}`}>
      {status}
    </span>
  );
}

function Panel({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="rounded-2xl bg-cream-100 p-5 text-ink shadow-xl shadow-black/20 sm:p-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="font-display text-xl font-semibold">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

// ----- Sign in ------------------------------------------------------------------------------

function SignIn({ onSignedIn, enabled }: { onSignedIn: () => void; enabled: boolean }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!enabled) {
    return (
      <Panel title="Question Builder is off">
        <p className="text-[15px] leading-relaxed">
          Set an <code className="rounded bg-cream-200 px-1">ADMIN_PASSWORD</code> environment variable (12+ characters) on the server
          to turn it on. See the README.
        </p>
      </Panel>
    );
  }
  return (
    <Panel title="Sign in">
      <form
        className="flex flex-col gap-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            await api("/api/admin/session", { method: "POST", body: { password } });
            setPassword("");
            onSignedIn();
          } catch (err) {
            setError(err instanceof Error ? err.message : "Sign-in failed.");
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="Admin password">
          <input type="password" autoComplete="current-password" className={input} value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        {error && <p className="text-sm font-medium text-stitch-600">{error}</p>}
        <Button type="submit" loading={busy} icon={<ShieldCheck className="size-4" aria-hidden />}>
          Sign in
        </Button>
      </form>
    </Panel>
  );
}

// ----- Validation report ---------------------------------------------------------------------

function Report({ report, current, onUsePick }: { report: ValidationReport; current: boolean; onUsePick: (id: string) => void }) {
  const ready = report.status === "ready";
  return (
    <div className="flex flex-col gap-4 text-[15px]">
      {!current && (
        <p className="flex items-start gap-2 rounded-lg bg-triple-100 px-3 py-2 text-sm text-triple-600">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden /> This report is for an earlier version. Save and validate again.
        </p>
      )}
      <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-[auto_1fr]">
        <dt className="text-ink-muted">Question status</dt>
        <dd className={`flex items-center gap-1.5 font-semibold ${ready ? "text-turf-600" : "text-stitch-600"}`}>
          {ready ? <CircleCheck className="size-4" aria-hidden /> : <CircleAlert className="size-4" aria-hidden />}
          {ready ? "Valid: ready to publish" : "Not ready to publish"}
        </dd>
        <dt className="text-ink-muted">Eligible players</dt>
        <dd className="font-mono font-semibold">{report.eligibleCount.toLocaleString("en-US")}</dd>
        <dt className="text-ink-muted">Criteria</dt>
        <dd>{report.criteriaSummary}</dd>
        <dt className="text-ink-muted">Data source</dt>
        <dd>{report.dataSource}</dd>
        <dt className="text-ink-muted">Top-5 Bunt rule</dt>
        <dd>{report.topFive.supported ? (report.topFive.enabled ? "Enabled" : "Off for this question") : `Not applicable: ${report.topFive.reason}`}</dd>
        <dt className="text-ink-muted">Plákata pick</dt>
        <dd>
          {report.plakataPick ? `${report.plakataPick.name} (${report.plakataPick.playerId})` : "Not chosen"}
          {report.suggestedPick && report.suggestedPick.playerId !== report.plakataPick?.playerId && (
            <button
              type="button"
              className="ml-2 text-sm font-semibold text-stitch-600 underline underline-offset-2"
              onClick={() => onUsePick(report.suggestedPick!.playerId)}
            >
              Use suggestion: {report.suggestedPick.name} ({report.suggestedPick.games} g)
            </button>
          )}
        </dd>
      </dl>
      {report.topFive.leaders.length > 0 && (
        <div>
          <h3 className="mb-1 text-sm font-semibold">Top-5 leaders (always a Bunt)</h3>
          <ol className="text-sm">
            {report.topFive.leaders.map((l) => (
              <li key={l.playerId}>
                <span className="font-mono text-ink-muted">#{l.rank}</span> {l.name} · <span className="font-mono">{l.value.toLocaleString("en-US")}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
      {[
        { items: report.errors, tone: "text-stitch-600", Icon: CircleAlert, label: "Errors" },
        { items: report.warnings, tone: "text-triple-600", Icon: TriangleAlert, label: "Warnings" },
        { items: report.coverage, tone: "text-ink-muted", Icon: Info, label: "Data coverage" },
      ]
        .filter((g) => g.items.length > 0)
        .map(({ items, tone, Icon, label }) => (
          <div key={label}>
            <h3 className="mb-1 text-sm font-semibold">{label}</h3>
            <ul className="flex flex-col gap-1 text-sm">
              {items.map((m) => (
                <li key={m} className={`flex items-start gap-2 ${tone}`}>
                  <Icon className="mt-0.5 size-4 shrink-0" aria-hidden /> {m}
                </li>
              ))}
            </ul>
          </div>
        ))}
      <p className="text-xs text-ink-muted">Validated {new Date(report.validatedAt).toLocaleString()}</p>
    </div>
  );
}

// ----- Eligible answers table ---------------------------------------------------------------

function EligibleTable({ draftId, refreshKey, onUsePick }: { draftId: string; refreshKey: string; onUsePick: (id: string) => void }) {
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<"stat" | "name" | "games" | "">("");
  const [data, setData] = useState<{ total: number; page: number; pageSize: number; sort: string; rows: EligibleRow[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({ page: String(page), ...(query ? { q: query } : {}), ...(sort ? { sort } : {}) });
    api<typeof data>(`/api/admin/questions/${draftId}/eligible?${params}`)
      .then((d) => !cancelled && (setData(d), setError(null)))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : "Couldn't load answers."));
    return () => {
      cancelled = true;
    };
  }, [draftId, page, query, sort, refreshKey]);

  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const hasStat = data?.rows.some((r) => r.stat) ?? false;
  return (
    <div className="flex flex-col gap-3">
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setPage(1);
          setQuery(q.trim());
        }}
      >
        <div className="relative min-w-0 flex-1">
          <Search className="absolute left-3 top-3 size-4 text-ink-muted" aria-hidden />
          <input className={`${input} pl-9`} placeholder="Search eligible players" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <select className={`${input} w-auto`} value={sort} onChange={(e) => (setSort(e.target.value as typeof sort), setPage(1))} aria-label="Sort">
          <option value="">Default order</option>
          {hasStat && <option value="stat">By statistic</option>}
          <option value="name">By name</option>
          <option value="games">By games played</option>
        </select>
      </form>
      {error && <p className="text-sm text-stitch-600">{error}</p>}
      {data && (
        <>
          <p className="text-sm text-ink-muted">
            {data.total.toLocaleString("en-US")} {query ? "matching" : "eligible"} players · page {data.page} of {pages}
          </p>
          <div className="overflow-x-auto rounded-xl ring-1 ring-cream-300">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="bg-cream-200 text-[11px] uppercase tracking-wider text-ink-muted">
                <tr>
                  <th className="px-3 py-2">Player</th>
                  <th className="px-3 py-2">Evidence</th>
                  {hasStat && <th className="px-3 py-2 text-right">{data.rows[0]?.stat?.label}</th>}
                  <th className="px-3 py-2">Expected</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-cream-300 bg-cream-50">
                {data.rows.map((r) => (
                  <tr key={r.playerId}>
                    <td className="px-3 py-2">
                      <span className="font-semibold">{r.name}</span>
                      <span className="block font-mono text-xs text-ink-muted">
                        {r.playerId} · {r.years}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-ink-muted">{r.evidence}</td>
                    {hasStat && (
                      <td className="px-3 py-2 text-right font-mono">
                        {r.stat?.value?.toLocaleString("en-US") ?? "–"}
                        {r.rank !== null && <span className="block text-xs text-ink-muted">#{r.rank}</span>}
                      </td>
                    )}
                    <td className="px-3 py-2">
                      {r.topFive ? <span className="font-semibold">Bunt (Top 5)</span> : r.plakataPick ? <span className="font-semibold text-stitch-600">Plákata (pick)</span> : (r.expectedTier ?? "–")}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {!r.plakataPick && !r.topFive && (
                        <button type="button" className="text-xs font-semibold text-stitch-600 underline underline-offset-2" onClick={() => onUsePick(r.playerId)}>
                          Make pick
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              Previous
            </Button>
            <Button variant="secondary" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
              Next
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

// ----- Test an answer ------------------------------------------------------------------------

function TestAnswer({ draftId }: { draftId: string }) {
  const [name, setName] = useState("");
  const [result, setResult] = useState<AnswerTest | null>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-3">
      <form
        className="flex gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          setError(null);
          try {
            setResult(await api<AnswerTest>(`/api/admin/questions/${draftId}/test-answer`, { method: "POST", body: { input: name } }));
          } catch (err) {
            setError(err instanceof Error ? err.message : "Test failed.");
          }
        }}
      >
        <input className={input} placeholder="Type a player name, as a player would" value={name} onChange={(e) => setName(e.target.value)} />
        <Button type="submit" variant="secondary">
          Test
        </Button>
      </form>
      {error && <p className="text-sm text-stitch-600">{error}</p>}
      {result && (
        <div className="flex flex-col gap-2 text-sm">
          <p className="font-medium">{result.message}</p>
          {result.players.map((p) => (
            <div key={p.playerId} className="rounded-xl bg-cream-50 p-3 ring-1 ring-cream-300">
              <p className="font-semibold">
                {p.name} <span className="font-mono text-xs text-ink-muted">({p.playerId}, {p.years})</span>
              </p>
              <p className={p.qualifies ? "text-turf-600" : "text-stitch-600"}>{p.qualifies ? "Qualifies" : "Does not qualify"}: {p.evidence}</p>
              {p.stat && (
                <p className="text-ink-muted">
                  {p.stat.label}: {p.stat.value?.toLocaleString("en-US") ?? "no record"}
                  {p.rank !== null && ` (rank #${p.rank})`}
                </p>
              )}
              {p.expected && (
                <p className="font-semibold">
                  Expected: {p.expected.label} (+{p.expected.points}){p.expected.overrideApplied ? " · Top-5 Bunt override" : ""}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ----- Editor ----------------------------------------------------------------------------------

function Editor({ draft, options, onChanged }: { draft: DraftView | null; options: Options; onChanged: (d: DraftView) => void }) {
  const [prompt, setPrompt] = useState(draft?.prompt ?? "");
  const [form, setForm] = useState<Form>(draft ? fromCriteria(draft.criteria as Record<string, unknown>) : DEFAULT_FORM);
  const [pick, setPick] = useState(draft?.plakataPick ?? "");
  const [topFive, setTopFive] = useState(draft?.topFiveOverride ?? true);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const isStat = form.type === "stat_threshold";
  const set = (k: string) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const run = async (label: string, fn: () => Promise<DraftView>, success: string) => {
    setBusy(label);
    setMessage(null);
    try {
      const saved = await fn();
      onChanged(saved);
      setMessage({ tone: "ok", text: success });
    } catch (err) {
      setMessage({ tone: "error", text: err instanceof Error ? err.message : "Something went wrong." });
    } finally {
      setBusy(null);
    }
  };
  const body = () => ({ prompt, criteria: toCriteria(form), plakataPick: pick.trim() || null, topFiveOverride: isStat && topFive });
  const save = () =>
    draft
      ? api<DraftView>(`/api/admin/questions/${draft.id}`, { method: "PUT", body: body() })
      : api<DraftView>("/api/admin/questions", { method: "POST", body: body() });

  const usePick = (id: string) => setPick(id);
  const dirty =
    !draft ||
    stableJson({ ...body(), prompt: prompt.trim() }) !==
      stableJson({ prompt: draft.prompt, criteria: draft.criteria, plakataPick: draft.plakataPick, topFiveOverride: draft.topFiveOverride });

  return (
    <div className="flex flex-col gap-6">
      <Panel title={draft ? "Edit question" : "New question"} aside={draft && <StatusChip status={draft.status} />}>
        <div className="flex flex-col gap-4">
          <Field label="Question text" hint='Write it the way players will see it, e.g. "Name an MLB player who hit at least 300 career home runs."'>
            <textarea className={`${input} h-20 py-2`} value={prompt} onChange={(e) => setPrompt(e.target.value)} maxLength={200} />
          </Field>
          <Field label="Category" hint="The structured rule below, not the text, decides which answers count.">
            <select className={input} value={form.type} onChange={set("type")}>
              {(Object.keys(CATEGORY_LABELS) as CriteriaType[]).map((t) => (
                <option key={t} value={t}>
                  {CATEGORY_LABELS[t]}
                </option>
              ))}
            </select>
          </Field>

          <div className="grid gap-4 sm:grid-cols-3">
            {isStat && (
              <>
                <Field label="Statistic">
                  <select className={input} value={form.stat} onChange={set("stat")}>
                    {options.stats.map((s) => (
                      <option key={s.key} value={s.key}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Scope">
                  <select className={input} value={form.scope} onChange={set("scope")}>
                    <option value="career">Career total</option>
                    <option value="season">Single season (best season)</option>
                  </select>
                </Field>
                <Field label="At least (≥)">
                  <input className={input} inputMode="numeric" value={form.value} onChange={set("value")} />
                </Field>
              </>
            )}
            {form.type === "franchise" && (
              <Field label="Franchise">
                <select className={input} value={form.franchiseId} onChange={set("franchiseId")}>
                  <option value="">Choose…</option>
                  {options.franchises.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            {form.type === "team" && (
              <Field label="Team (one name / era)">
                <select className={input} value={form.teamId} onChange={set("teamId")}>
                  <option value="">Choose…</option>
                  {options.teams.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            {form.type === "position" && (
              <>
                <Field label="Position">
                  <select className={input} value={form.position} onChange={set("position")}>
                    {POSITIONS.map((p) => (
                      <option key={p} value={p}>
                        {POSITION_LABELS[p]}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Minimum games there">
                  <input className={input} inputMode="numeric" value={form.minimumGames} onChange={set("minimumGames")} />
                </Field>
              </>
            )}
            {form.type === "season" && (
              <>
                <Field label="From season">
                  <input className={input} inputMode="numeric" value={form.from} onChange={set("from")} />
                </Field>
                <Field label="To season" hint="Same as 'from' for a single season.">
                  <input className={input} inputMode="numeric" value={form.to} onChange={set("to")} />
                </Field>
              </>
            )}
            {form.type === "debut" && (
              <Field label="Career began before">
                <input className={input} inputMode="numeric" value={form.before} onChange={set("before")} />
              </Field>
            )}
            {form.type === "award" && (
              <Field label="Award">
                <select className={input} value={form.award} onChange={set("award")}>
                  <option value="mvp">MVP</option>
                  <option value="cyYoung">Cy Young</option>
                </select>
              </Field>
            )}
            {form.type === "all_star" && (
              <>
                <Field label="Specific year (optional)">
                  <input className={input} inputMode="numeric" value={form.year} onChange={set("year")} />
                </Field>
                <Field label="Or: at least N selections">
                  <input className={input} inputMode="numeric" value={form.minimumSelections} onChange={set("minimumSelections")} disabled={!!form.year.trim()} />
                </Field>
              </>
            )}
            {form.type === "world_series_champion" && (
              <>
                <Field label="Specific year (optional)">
                  <input className={input} inputMode="numeric" value={form.year} onChange={set("year")} />
                </Field>
                <Field label="Or: at least N titles">
                  <input className={input} inputMode="numeric" value={form.minimumTitles} onChange={set("minimumTitles")} disabled={!!form.year.trim()} />
                </Field>
              </>
            )}
            {form.type === "birthplace" && (
              <>
                <Field label="Born">
                  <select className={input} value={form.birthMode} onChange={set("birthMode")}>
                    <option value="country">In a country</option>
                    <option value="state">In a U.S. state</option>
                    <option value="outside">Outside the U.S. and its territories</option>
                  </select>
                </Field>
                {form.birthMode === "country" && (
                  <Field label="Country">
                    <select className={input} value={form.country} onChange={set("country")}>
                      {options.countries.map((c) => (
                        <option key={c.name} value={c.name}>
                          {c.name} ({c.count})
                        </option>
                      ))}
                    </select>
                  </Field>
                )}
                {form.birthMode === "state" && (
                  <Field label="State">
                    <select className={input} value={form.state} onChange={set("state")}>
                      <option value="">Choose…</option>
                      {options.usStates.map((c) => (
                        <option key={c.name} value={c.name}>
                          {c.name} ({c.count})
                        </option>
                      ))}
                    </select>
                  </Field>
                )}
              </>
            )}
          </div>

          <label className={`flex items-start gap-3 text-sm ${isStat ? "" : "opacity-60"}`}>
            <input type="checkbox" className="mt-1 size-4 accent-[var(--color-stitch-500)]" checked={isStat && topFive} disabled={!isStat} onChange={(e) => setTopFive(e.target.checked)} />
            <span>
              <span className="font-semibold">Automatically award Bunt to the top five statistical performers.</span>
              <span className="block text-ink-muted">
                {isStat ? "On by default. Ties at fifth place are all included." : "Only statistical questions have a meaningful top five."}
              </span>
            </span>
          </label>

          <Field label="Plákata pick (player id)" hint="The question's one 100-point deep cut. Validate to get a suggestion, or use “Make pick” in the answer table.">
            <input className={`${input} font-mono`} value={pick} onChange={(e) => setPick(e.target.value)} placeholder="e.g. sexsori01" />
          </Field>

          {message && <p className={`text-sm font-medium ${message.tone === "ok" ? "text-turf-600" : "text-stitch-600"}`}>{message.text}</p>}

          <div className="flex flex-wrap gap-2">
            <Button loading={busy === "save"} disabled={!!busy || !dirty} onClick={() => run("save", save, "Draft saved.")}>
              Save draft
            </Button>
            {draft && (
              <>
                <Button
                  variant="secondary"
                  loading={busy === "validate"}
                  disabled={!!busy || dirty}
                  onClick={() => run("validate", () => api<DraftView>(`/api/admin/questions/${draft.id}/validate`, { method: "POST" }), "Validation finished.")}
                >
                  Validate question
                </Button>
                <Button
                  variant="secondary"
                  loading={busy === "publish"}
                  disabled={!!busy || dirty || draft.status !== "validated"}
                  onClick={() => run("publish", () => api<DraftView>(`/api/admin/questions/${draft.id}/publish`, { method: "POST" }), "Published: it can now appear in random games and future dailies.")}
                >
                  Publish
                </Button>
                {draft.live && (
                  <Button
                    variant="secondary"
                    loading={busy === "toggle"}
                    disabled={!!busy}
                    onClick={() =>
                      run(
                        "toggle",
                        () => api<DraftView>(`/api/admin/questions/${draft.id}/${draft.live!.active ? "disable" : "enable"}`, { method: "POST" }),
                        draft.live!.active ? "Disabled: it won't be picked for new games." : "Re-enabled.",
                      )
                    }
                  >
                    {draft.live.active ? "Disable" : "Enable"}
                  </Button>
                )}
              </>
            )}
          </div>
          {draft?.live && (
            <p className="text-xs text-ink-muted">
              Live: version {draft.live.version} ({draft.live.active ? "in rotation" : "disabled"}). Edits publish as a new version; past games keep theirs.
            </p>
          )}
        </div>
      </Panel>

      {draft?.validation && (
        <Panel title="Validation results">
          <Report report={draft.validation} current={draft.validationCurrent} onUsePick={usePick} />
        </Panel>
      )}
      {draft && !dirty && (
        <>
          <Panel title="Test an answer">
            <TestAnswer draftId={draft.id} />
          </Panel>
          <Panel title="Valid answers (admin only)">
            <EligibleTable draftId={draft.id} refreshKey={draft.updatedAt} onUsePick={usePick} />
          </Panel>
        </>
      )}
    </div>
  );
}

// ----- Page -------------------------------------------------------------------------------------

export function QuestionBuilder() {
  const [session, setSession] = useState<{ enabled: boolean; authenticated: boolean } | null>(null);
  const [list, setList] = useState<QuestionList | null>(null);
  const [options, setOptions] = useState<Options | null>(null);
  const [selected, setSelected] = useState<string | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadSession = useCallback(async () => {
    try {
      setSession(await api("/api/admin/session"));
    } catch {
      setError("Couldn't reach the server.");
    }
  }, []);
  const loadList = useCallback(async () => {
    try {
      const [l, o] = await Promise.all([api<QuestionList>("/api/admin/questions"), api<Options>("/api/admin/options")]);
      setList(l);
      setOptions(o);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setSession((s) => (s ? { ...s, authenticated: false } : s));
      else setError(e instanceof Error ? e.message : "Couldn't load questions.");
    }
  }, []);

  useEffect(() => {
    loadSession(); // eslint-disable-line react-hooks/set-state-in-effect -- initial fetch
  }, [loadSession]);
  useEffect(() => {
    if (session?.authenticated) loadList(); // eslint-disable-line react-hooks/set-state-in-effect -- fetch after sign-in
  }, [session?.authenticated, loadList]);

  const current = selected && selected !== "new" ? (list?.drafts.find((d) => d.id === selected) ?? null) : null;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-6 sm:px-6 sm:py-10">
      <header className="flex items-center justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-stitch-400">Plákata admin</p>
          <h1 className="font-display text-3xl font-semibold text-cream-50">Question Builder</h1>
        </div>
        {session?.authenticated && (
          <Button
            variant="ghost"
            icon={<LogOut className="size-4" aria-hidden />}
            onClick={async () => {
              await api("/api/admin/session", { method: "DELETE" });
              setList(null);
              setSession((s) => (s ? { ...s, authenticated: false } : s));
            }}
          >
            Sign out
          </Button>
        )}
      </header>

      {error && <p className="rounded-lg bg-stitch-600/20 px-4 py-3 text-cream-100">{error}</p>}
      {session && !session.authenticated && (
        <div className="max-w-md">
          <SignIn enabled={session.enabled} onSignedIn={loadSession} />
        </div>
      )}

      {session?.authenticated && list && options && (
        <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
          <aside className="flex flex-col gap-4">
            <Button icon={<Plus className="size-4" aria-hidden />} onClick={() => setSelected("new")}>
              New question
            </Button>
            <Panel title="Your questions">
              {list.drafts.length === 0 ? (
                <p className="text-sm text-ink-muted">No custom questions yet.</p>
              ) : (
                <ul className="flex flex-col gap-1">
                  {list.drafts.map((d) => (
                    <li key={d.id}>
                      <button
                        type="button"
                        onClick={() => setSelected(d.id)}
                        className={`w-full rounded-lg px-3 py-2 text-left text-sm transition hover:bg-cream-200 ${selected === d.id ? "bg-cream-200" : ""}`}
                      >
                        <span className="line-clamp-2 font-medium">{d.prompt || "(untitled)"}</span>
                        <span className="mt-1 flex items-center gap-2">
                          <StatusChip status={d.status} />
                          {d.live && <span className="text-xs text-ink-muted">v{d.live.version}</span>}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
            <Panel title={`Built-in questions (${list.bank.length})`}>
              <p className="mb-2 text-xs text-ink-muted">Read-only here: edit src/data/question-bank.ts and run questions:sync.</p>
              <ul className="flex max-h-72 flex-col gap-1 overflow-y-auto text-xs">
                {list.bank.map((b) => (
                  <li key={b.slug} className="flex justify-between gap-2">
                    <span className="truncate">{b.prompt.replace(/^Name (an MLB player|a player|a pitcher) /, "")}</span>
                    <span className="shrink-0 font-mono text-ink-muted">{b.eligibleCount.toLocaleString("en-US")}</span>
                  </li>
                ))}
              </ul>
            </Panel>
          </aside>
          <main>
            {selected === null ? (
              <Panel title="Pick a question">
                <p className="text-[15px] text-ink-muted">Choose a question on the left, or start a new one.</p>
              </Panel>
            ) : (
              <Editor
                key={selected === "new" ? "new" : `${current?.id}`}
                draft={current}
                options={options}
                onChanged={(d) => {
                  setSelected(d.id);
                  setList((l) => (l ? { ...l, drafts: [d, ...l.drafts.filter((x) => x.id !== d.id)] } : l));
                }}
              />
            )}
          </main>
        </div>
      )}
    </div>
  );
}
