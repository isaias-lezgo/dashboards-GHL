# Bitácora — copiloto más robusto (2026-11-02)

Copia del ledger de ejecución (`.superpowers/sdd/…/progress.md`), archivada al cerrar la rama: cada `Ruling:` es una decisión tomada en nombre del dueño, con su costo si está mal.

```
# SDD ledger — plan: docs/superpowers/plans/2026-11-02-copiloto-robusto.md
Spec: docs/superpowers/specs/2026-11-02-copiloto-robusto-design.md (approved 2026-11-02). Executor: inline (owner chose "directo").

Pre-flight (shared interfaces):
- T1→T3/T4/T8: T1 adds "conversations" to SOURCES, "age" to BUCKETS, days_ago_* to FILTER_OPS, "matrix" to VIZ_TYPES; Record<SourceId,…>/exhaustive switches in semantic/engine/labels/viz must compile in T1. Ruling: T1 adds minimal stubs (conversations source with no rows/fields; age/days_ago throw QueryError "unsupported" until T3/T4; matrix falls back to table until T9) — keeps tsc green per task — cost if wrong: stubs replaced in later tasks, none user-visible since nothing can create such widgets before T13's prompt.
- T2→T3: EngineContext.customFieldTypes (T2) consumed by customFieldType/isDateField (T3) — consistent.
- T3→T4/T5: dateValue/isDateField(ctx)/fieldValuesWithFallbacks consumed by engine — consistent.
- T4→T5→T9: QueryResult.margins (T4), meta.undated (T4), meta.seriesLabels/valueKind/ratio/pipelineIgnored + QueryRow.parts (T5), meta.conversations (T8) consumed by viz (T9) — consistent; QueryMeta extended additively (optional fields).
- T7→T8: ConversationRow/contactMessageDates (T7) consumed by T8; ConversationState lives in lib/conversation-index.ts — consistent.
- T11→T13: save_term kind "field" (T11) referenced by prompt (T13) — consistent.
Task 1: complete (commits 41f10bc..b76ef8d, tests: bash -c 'pnpm -s verify:capabilities && pnpm -s verify:widgets && npx tsc --noEmit' → ✅ lib/widgets — all assertions passed)
Task 2: complete (commits b76ef8d..866c7e5, tests: bash -c 'pnpm -s verify:capabilities && pnpm -s verify:sync-store && npx tsc --noEmit' → ✅ verify:sync-store OK)
Task 3: Ruling: plan said "update all 7 existing isDateField callers" in Task 3 — engine (planDims/validateFields), validate.ts and describe.ts callers are updated in the tasks that own those files (4, 6, 10) because they need more than ctx (catalog, related dims) — cost if wrong: none user-visible; until then custom dates are not accepted by those paths.
Task 3: Ruling: gt/gte/lt/lte on dates now compare dateValue with toDate(value), so a bare "2026-10-01" is the LOCAL day start (before: Date.parse = UTC midnight, i.e. 18:00 the previous day in Mexico) — matches how every panel range is resolved (local days) — cost if wrong: a filter boundary moves by the UTC offset (≤ 6 h).
Task 3: complete (commits 866c7e5..77d21e0, tests: bash -c 'pnpm -s verify:capabilities && pnpm -s verify:widgets && npx tsc --noEmit' → ✅ lib/widgets — all assertions passed)
Task 4: Ruling: the undated warning ("N oportunidades sin «X» no aparecen") fires only for CUSTOM date windows, not native secondary dates (closedAt, dueDate) — an open opportunity without closedAt is the normal state; warning there would flood every "ventas por fecha de cierre" card. Spec §3.3 scopes the rule to custom fields — cost if wrong: native secondary-date cards stay silent about rows they leave out (as before).
Task 4: Ruling: a date-bucketed "contact.<date>" dimension is now bucketed (before it grouped raw timestamps as categories) and an empty date bucket is labelled "Sin <campo>" instead of "(sin valor)" — both only affect specs that could not be read before — cost if wrong: a label change on date axes with missing dates.
Task 4: complete (commits 77d21e0..f51bf5c, tests: bash -c 'pnpm -s verify:capabilities && pnpm -s verify:widgets && pnpm -s check:widget-parity amir-cherit hausmen && npx tsc --noEmit' → ✅ El motor reproduce los tableros en todas las comprobaciones.)
Task 5: complete (commits f51bf5c..ebaf7ab, tests: bash -c 'pnpm -s verify:capabilities && pnpm -s verify:widgets && pnpm -s check:widget-parity amir-cherit hausmen && npx tsc --noEmit' → ✅ El motor reproduce los tableros en todas las comprobaciones.)
Task 6: Ruling: `count` and `contacts` metrics now accept the conversations source (needed by validation of conversation widgets; T8 builds the source) — conversations are counted, never valued — cost if wrong: none; no other metric reads conversations.
Task 6: Ruling: plan's test "category axis must exist in every series" used `tags`, which opportunities also have; used `city` (contacts only) to exercise the rule — cost if wrong: none (test fixture choice).
Task 6: complete (commits ebaf7ab..eafb81e, tests: bash -c 'pnpm -s verify:capabilities && pnpm -s verify:widgets && npx tsc --noEmit' → ✅ lib/widgets — all assertions passed)
Task 7: Ruling: dropped `lastInboundAt` from ConversationRow/ContactMessageDates (plan listed it) — GHL only says the LAST message's direction; when a conversation ends outbound the last inbound date is unknowable without opening every thread (VAEO's whole cost saving). Contact message dates are lastOutboundAt + lastMessageAt; "esperando respuesta" is `waitingReply` — cost if wrong: "último mensaje del cliente" questions get "esperando respuesta"/lastMessageAt instead of an exact date.
Task 7: Ruling: a failed search PAGE fails the whole load (error frame → card error + retry), unlike VAEO which kept the partial walk — a partial walk silently pushes real contacts into "más de N días o sin mensajes" — cost if wrong: one flaky GHL page costs a retry. A failed THREAD keeps lastOutboundAt null and is counted (`threadErrors`) so the card can say so.
Task 7: live check (lezgo-suite, days=7): 196 conversations, 180 with lastOutboundAt, 70 waiting reply, 0 thread errors, not truncated, oldest message inside the window; 51 s including the dev compile.
Task 7: complete (commits eafb81e..7beb019, tests: bash -c 'pnpm -s verify:capabilities && npx tsc --noEmit' → ✅ capabilities — all assertions passed)
Task 8: Ruling: only preview_widget and get_widget_data await the conversation load (plan also listed create_widgets/update_widget) — those two only validate against the catalog and never compute a number; the card's own load starts when the widget lands on the active tab — cost if wrong: none; the copilot previews before creating (prompt rule 1).
Task 8: Ruling: a contact with no message (or no outbound) in the window reads "beyond": its own age range "Más de N días o sin mensajes"; ranges that start past the window are dropped for message dates (a "Más de 60 días" column could never hold anything with 60 days loaded) — cost if wrong: one fewer empty column.
Task 8: Ruling: the related-filter cache key now includes the conversation window (days + row count), else a set computed on 60 days of messages would answer for 120 — cost if wrong: none.
Task 8: complete (commits 7beb019..78d4864, tests: bash -c 'pnpm -s verify:capabilities && pnpm -s verify:widgets && npx tsc --noEmit' → ✅ lib/widgets — all assertions passed)
Task 9: no unit tests for React components (repo convention); verified: tsc clean; pilot panel re-rendered after the change matches the pre-change screenshot (only animation-timing differences; same widgets, numbers and layout). `pnpm lint` cannot run: eslint is not installed in this repo (pre-existing).
Task 9: Ruling: conversation-source drills open the CONTACTS of those conversations (the drawer has no conversation view; contacts are what a person acts on) — cost if wrong: a drill shows contacts instead of conversation rows.
Task 9: Ruling: fixed colors use dashboard-ui tokens: Ganada #22c55e (palette green), Abierta STRUCTURAL_NAVY, Perdida #ef4444; absent keys ("Sin …", "(sin valor)", "… o sin mensajes") grey #94a3b8 — the classic Ventas tab colors won amber/open violet; the spec (VAEO's picture) asked green/slate/red — cost if wrong: panel and classic tab disagree on the won color.
Task 9: FOUND (pre-existing, for Task 15): a date axis with `limit` folds later weeks into "Otros" (the owner's "Leads por semana y origen" shows an ~8 mil "Otros" bar at the end of a weekly axis).
Task 9: complete (commits 78d4864..f30c551, tests: bash -c 'pnpm -s verify:capabilities && pnpm -s verify:widgets && npx tsc --noEmit' → ✅ lib/widgets — all assertions passed)
Task 10: Ruling: the plan's pinned series description ("…, por semana · periodo del panel") is written in the panel's existing pill style instead: "Contactos (contactos por fecha de creación) y Oportunidades (oportunidades por fecha de creación) · por semana · hereda fechas" — same separators and period words as every other card — cost if wrong: wording only.
Task 10: Ruling: combined-field chips keep the existing value quoting ("= «Valle»") — cost if wrong: none.
Task 10: complete (commits f30c551..9945680, tests: bash -c 'pnpm -s verify:capabilities && pnpm -s verify:widgets && npx tsc --noEmit' → ✅ lib/widgets — all assertions passed)
Task 11: Ruling: when resolve_term finds a combined reading, the field_name readings it joins are left out of the materiallyDifferent comparison (two disjoint "Sucursal …" fields are one concept, not rival definitions) — cost if wrong: a split concept no longer triggers a question by itself; the copilot still offers the combined reading via ask_user per the prompt.
Task 11: check:strict-tools run (approved in spec §4, ~$0.05): "✅ compila: 8 herramientas strict".
Task 11: complete (commits 9945680..f998499, tests: bash -c 'pnpm -s verify:capabilities && pnpm -s verify:widgets && npx tsc --noEmit' → ✅ lib/widgets — all assertions passed)
Task 12: complete (commits f998499..790ddcf, tests: bash -c 'pnpm -s verify:capabilities && pnpm -s verify:widgets && npx tsc --noEmit' → ✅ lib/widgets — all assertions passed)
Task 13: complete (commits 790ddcf..73f8189, tests: bash -c 'pnpm -s verify:capabilities && pnpm -s verify:widgets && npx tsc --noEmit' → ✅ lib/widgets — all assertions passed)
Task 14: Ruling: the route's walk moved to lib/conversation-index-load.ts (server-only) so the reference script reads conversations through the SAME code as the panel — cost if wrong: none (route behavior unchanged).
Task 14: Ruling: "días desde" counts CALENDAR days (the panel's Spanish labels: "hace 8 días" = eight dates ago); VAEO counts elapsed 24 h periods. The strict check uses calendar days and reports VAEO's rule apart: on lezgo-suite live, 1 opportunity would change cell — cost if wrong: a card can differ from VAEO's by one bucket for records near a boundary.
Task 14: Ruling: the plan's "ventas por mes de Fecha de Cierre via closedAt" check used lastStatusChangeAt instead — closedAt is empty on all four accounts (1 key, all "sin fecha") — cost if wrong: none; native secondary-date bucketing is what is exercised.
Task 14: results — lezgo-suite: estado por mes 33/33, ventas 14/14, sin atención (live, 1052 conversations in 31 s, 0 thread errors) 9/9; condesa 28/28, 5/5, combined channel 9/9; stanza 13/13, 3/3, combined 11/11; rise-29 16/16, 1/1, combined 50/50.
Task 14: complete (commits 73f8189..23df9ce, tests: bash -c 'pnpm -s check:vaeo-reference && pnpm -s verify:capabilities && npx tsc --noEmit' → ✅ capabilities — all assertions passed)
Task 15: app verification on lezgo-suite (copilot ~$1.5 in API calls, part of the approved plan's verification):
 - saved pilot panel opens unchanged, console clean;
 - owner's prompt "contactos y oportunidades por semana en una sola gráfica" → one line chart, two series, each on its own creation date ✓;
 - "oportunidades por estado por mes de creación" → stacked bars Ganada/Abierta/Perdida with fixed colors ✓;
 - "de los contactos de cada mes, ¿qué % tiene oportunidad?" → ratio line in %, "Cuenta hasta hoy…" note, cohort explained ✓;
 - matrix asesor × etapa with totals and heat ✓ (after fix B below);
 - "sin atención" → conversations loaded, matrix with "Más de 60 días o sin mensajes" column + critical KPI ✓ (after fix A);
 - two-axis request → one-sentence no + ask_user with 3 alternatives, built only the chosen table ✓ (after fix C);
 - Asistente IA tab: aggregate + chart in chat, unchanged ✓.
Task 15: fixes found driving the app, each with a failing test first (verify-capabilities "fixes found in the app"):
 - pre-existing: a date axis with `limit` folded RECENT weeks into "Otros" → keeps the most recent N periods + notice;
 - multi-series charts had no legend → SeriesLegend; stacked-bar month labels collided → tilted like single bars;
 - copilot replies used spec/field names (stacked_bar, outcome, lastStageChangeAt) → prompt rule;
 - A: lastStageChangeAt/lastStatusChangeAt were bucketable but not filterable → copilot fell back to updatedAt (wrong) → added to NATIVE_FIELDS;
 - B: a matrix folded columns past 6 into "Otros" (Ganado/Perdido hidden in "Otros 373") → RunOptions.viz, matrices keep up to 20 columns;
 - C: a multi-series TABLE was refused for mixed units → tables may mix units, each column formatted by its own kind;
 - D: closedAt is empty on lezgo-suite (0%), copilot put all won value in "Sin fecha" → catalog lists % of data per opportunity date + prompt rule; copilot then fixed the table itself (lastStatusChangeAt, 100%).
Task 15: complete (commits 23df9ce..20556ef, tests: bash -c 'pnpm -s verify:capabilities && pnpm -s verify:widgets && pnpm -s check:widget-parity amir-cherit hausmen && npx tsc --noEmit' → ✅ El motor reproduce los tableros en todas las comprobaciones.)
Task 16: Ruling: the eval runner now loads conversations (same walk as the route, once per account, read-only GHL) and passes customFieldTypes, otherwise r07/r08 could never pass — cost if wrong: the eval makes ~1 extra minute of read-only GHL calls on lezgo-suite.
Task 16: Ruling: the catalog also gives each custom DATE field's fill share ("cf:Fecha de Cierre (oportunidad, 67% con dato)") — lezgo-suite types 14 DATE fields, most nearly empty — cost if wrong: a few more tokens in the cached catalog.
Task 16: Step 3 (paid eval) NOT run — needs the owner's budget approval; asked in the final message.
Task 16: complete (commits 20556ef..08dffca, tests: bash -c 'pnpm -s verify:capabilities && pnpm -s verify:widgets && npx tsc --noEmit' → ✅ lib/widgets — all assertions passed)
Final: fixed days_ago filters not validated (field must be a date, value a whole number) + series filter fallbacks unvalidated — "days_ago filters must be on a date and carry a whole number of days", "series filter fallbacks are validated like the query's" RED→GREEN, suite verify:capabilities + verify:widgets green
Final: fixed a card measured over whatever window the session loaded (a 90-day sibling widened a 60-day card) — "a 60-day card measures 60 days even when the session loaded 90 for a sibling" RED→GREEN, suites green
Final: fixed every card recomputing on each conversation progress frame — engine reads a per-load stable state (stableForEngine), counters go to the loading notice as a prop — "progress frames do not change what the engine sees" RED→GREEN, suites green
Final: fixed "Actualizar" never refreshing conversations — the page resets the index when the dashboard data changes and the next ensure loads again (planEnsure) — "after a reset (Actualizar) the index loads again…" RED→GREEN (pure plan tested; the 3-line page effect verified in the app)
Final review: fresh reviewer (Fable) — 0 Critical, 4 Important (all fixed above), 11 Minor.
Final: minor (deferred): a bare "yyyy-MM-dd" custom DATE value reads one day early east of UTC (harmless in Mexico/UTC).
Final: minor (deferred): customFieldType scans every type per row per call (O(rows × fields)); precompute a lowercase map.
Final: minor (deferred): a limited date axis also drops the "(sin valor)" group without saying so.
Final: minor (deferred): a matrix drops a limit-folded "Otros" row, so row totals stop adding up to the grand total.
Final: minor (deferred): multi-series category axes ignore q.sort (a stage/outcome axis loses natural order).
Final: minor (deferred): the related-filter cache key omits ctx.now, so a days_ago related condition cached before midnight answers for the next day until the data changes.
Final: minor (deferred): a ratio whose numerators are all 0 renders "Sin datos" instead of 0 %.
Final: minor (deferred): two series with the same label collapse in the chart and drill into the wrong source (validation could require unique labels).
Final: minor (deferred): the filter bar dedupes controls by first field only, so a combined-field control and a plain one on that field collide.
Final: minor (deferred): an opportunity.X dimension with fallbacks escapes validation and errors at run time (an error card, not a silent number).
Final: minor (deferred): a thread whose last 50 messages are all inbound keeps lastOutboundAt null ("beyond") even if an older outbound exists.
Final: minor (deferred): during the thread phase the loading notice stays at "N revisadas" and looks stuck (threads counter not shown).
Final: Ruling: SeriesLegend vs CLAUDE.md's "no encoding that requires a legend" — stands: two series on one axis have no legend-free form; the convention targets encodings that could avoid one — cost if wrong: one small legend row per multi-series card.
Final: Ruling: no upper bound on conversation days — stands: the owner said "no lo limitemos"; the cost lands on the requesting tenant's own GHL budget and the card warns — cost if wrong: a very long load the user asked for.
Final: Ruling: outcome colors differ from the classic Ventas tab — stands (Task 9 ruling) — cost if wrong: two shades for "ganada" across tabs.
Final: Ruling: calendar-day "días desde" vs VAEO's 24 h periods — stands (Task 14 ruling, 1 of 39 on live data) — cost if wrong: one-bucket differences near boundaries.
Final: Ruling: lastInboundAt dropped — stands (Task 7 ruling).
Final: Ruling: drills on conversation rows open their contacts — stands (Task 9 ruling).
```
