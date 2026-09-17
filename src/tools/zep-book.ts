/**
 * zep_book -- create Projektzeit bookings.
 *
 * This is the replacement for the paid ZEP API: the same HTTP call the web
 * form makes, minus the browser.
 */

import { Type } from "typebox";

import { createClient } from "../session.ts";
import { durationBetween } from "../clients/zep-parse.ts";
import { ZepError } from "../clients/zep-client.ts";
import { updateProfile } from "../config.ts";
import type { ZepBookingRequest, ZepFormData, ZepOption } from "../types.ts";
import { errorResult, matchOption, textResult, toHhMm, toIsoDate, type ToolResult } from "./shared.ts";

interface EntryParam {
  von: string;
  bis: string;
  bemerkung?: string;
  datum?: string;
  projekt?: string;
  vorgang?: string;
  taetigkeit?: string;
  ort?: string;
}

interface BookParams {
  profile?: string;
  datum?: string;
  von?: string;
  bis?: string;
  bemerkung?: string;
  projekt?: string;
  vorgang?: string;
  taetigkeit?: string;
  ort?: string;
  entries?: EntryParam[];
  dryRun?: boolean;
}

/** A project plus the Vorgang/Tätigkeit options ZEP offers for it. */
interface ProjectScope {
  readonly project: ZepOption | undefined;
  readonly vorgaenge: ReadonlyArray<ZepOption>;
  readonly taetigkeiten: ReadonlyArray<ZepOption>;
  readonly selectedVorgangId: string | null;
}

export const ZepBookTool = {
  name: "zep_book",
  label: "ZEP Book",
  description:
    "Book time in ZEP (Projektzeiten) over plain HTTP. Give a day with 'datum' (default today) and either one von/bis pair or an 'entries' array for several blocks. Project and Vorgang accept an id or part of the label. Use dryRun to see the exact request without saving. ZEP rejects a booking that would exceed the Vorgang's planned hours; such a rejection is reported, never retried silently.",
  parameters: Type.Object({
    profile: Type.Optional(
      Type.String({ description: "ZEP profile to use. Defaults to the active profile." }),
    ),
    datum: Type.Optional(
      Type.String({ description: "Day to book (YYYY-MM-DD or DD.MM.YYYY). Defaults to today." }),
    ),
    von: Type.Optional(Type.String({ description: "Start time, e.g. '08:00'." })),
    bis: Type.Optional(Type.String({ description: "End time, e.g. '12:00'." })),
    bemerkung: Type.Optional(
      Type.String({
        description:
          "Comment. Convention: include the ticket/story numbers (e.g. '4711 Ladeanzeige, 4712 Fach-HU-Nummer').",
      }),
    ),
    projekt: Type.Optional(
      Type.String({
        description:
          "Project id (e.g. '413' for Contoso) or part of its label (e.g. 'Contoso'). Falls back to the project ZEP has selected for this user.",
      }),
    ),
    vorgang: Type.Optional(
      Type.String({
        description:
          "Vorgang id (e.g. '3284') or part of its label (e.g. '90-01'). Falls back to the Vorgang ZEP has selected for this user.",
      }),
    ),
    taetigkeit: Type.Optional(
      Type.String({
        description: "Activity code, usually 'co' (Consulting), 'co_nb' (non-billable) or 're' (Reisen). Defaults to the last used one.",
      }),
    ),
    ort: Type.Optional(
      Type.String({
        description:
          "Location code, e.g. 'D-Office' (office), 'D' (inland away) or 'D-3M'. The default 'NULL' is the first place of work (Erste Tätigkeitsstätte).",
      }),
    ),
    entries: Type.Optional(
      Type.Array(
        Type.Object({
          von: Type.String({ description: "Start time, e.g. '13:00'." }),
          bis: Type.String({ description: "End time, e.g. '17:00'." }),
          bemerkung: Type.Optional(Type.String({ description: "Comment for this block." })),
          datum: Type.Optional(Type.String({ description: "Overrides the top-level datum." })),
          projekt: Type.Optional(Type.String({ description: "Overrides the top-level projekt." })),
          vorgang: Type.Optional(Type.String({ description: "Overrides the top-level vorgang." })),
          taetigkeit: Type.Optional(Type.String({ description: "Overrides the top-level taetigkeit." })),
          ort: Type.Optional(Type.String({ description: "Overrides the top-level ort." })),
        }),
        { description: "Several blocks in one call, e.g. 08:00-12:00 and 13:00-17:00." },
      ),
    ),
    dryRun: Type.Optional(
      Type.Boolean({
        description: "Resolve everything and show exactly what would be sent, without saving.",
      }),
    ),
  }),

  async execute(_toolCallId: string, params: BookParams): Promise<ToolResult> {
    try {
      if (!params.entries?.length && (!params.von || !params.bis)) {
        return errorResult("Give 'von' and 'bis', or an 'entries' array.");
      }

      const handle = await createClient(params.profile);
      const { client, profileName } = handle;
      const { form } = await client.loadForm();

      const entries: EntryParam[] = params.entries?.length
        ? params.entries
        : [{ von: params.von!, bis: params.bis!, bemerkung: params.bemerkung }];

      // Which projects does this call touch?
      const wantedRefs = new Set<string>();
      for (const entry of entries) {
        const ref = entry.projekt ?? params.projekt;
        if (ref) wantedRefs.add(ref.trim());
      }

      const scopes = new Map<string, ProjectScope>();
      const baseProjectId = form.selected.projektId;

      const scopeFor = async (projectId: string, current: ZepFormData): Promise<ProjectScope> => {
        const cached = scopes.get(projectId);
        if (cached) return cached;

        // The page only renders Vorgänge for the project it was rendered for.
        let scopeForm = current;
        if (projectId !== current.selected.projektId) {
          const refreshed = await client.refreshFormForProject(projectId);
          if (refreshed.vorgaenge.length) {
            scopeForm = {
              ...current,
              vorgaenge: refreshed.vorgaenge,
              taetigkeiten: refreshed.taetigkeiten.length ? refreshed.taetigkeiten : current.taetigkeiten,
              selected: { ...current.selected, projektId: projectId },
            };
          }
        }

        const scope: ProjectScope = {
          project: current.projects.find((p) => p.id === projectId),
          vorgaenge: scopeForm.vorgaenge,
          taetigkeiten: scopeForm.taetigkeiten,
          selectedVorgangId:
            scopeForm.selected.projektId === projectId ? scopeForm.selected.vorgangId : null,
        };
        scopes.set(projectId, scope);
        return scope;
      };

      // Resolve every project reference up front so all Vorgang lists are known.
      for (const ref of wantedRefs) {
        const resolved = matchOption(form.projects, ref);
        if (!resolved) {
          return errorResult(
            `No project matches "${ref}". Known projects: ${form.projects
              .map((p) => `${p.id}=${p.label}`)
              .join(" | ")}`,
          );
        }
        await scopeFor(resolved.id, form);
      }

      if (baseProjectId && !scopes.has(baseProjectId)) {
        scopes.set(baseProjectId, {
          project: form.projects.find((p) => p.id === baseProjectId),
          vorgaenge: form.vorgaenge,
          taetigkeiten: form.taetigkeiten,
          selectedVorgangId: form.selected.vorgangId,
        });
      }

      // ------------------------------------------------------------ build plan
      const planned: Array<{ request: ZepBookingRequest; label: string }> = [];

      for (const entry of entries) {
        const date = toIsoDate(entry.datum ?? params.datum);
        const from = toHhMm(entry.von);
        const to = toHhMm(entry.bis);
        const duration = durationBetween(from, to);
        if (!duration) {
          return errorResult(`Invalid time range ${from}-${to} on ${date}: end must be after start.`);
        }

        const projektRef = entry.projekt ?? params.projekt;
        const projectId = projektRef
          ? matchOption(form.projects, projektRef)?.id
          : form.selected.projektId;

        if (!projectId) {
          return errorResult(
            "No project determined. Pass 'projekt' (id or label), or book once manually so ZEP preselects one.",
          );
        }

        const scope = scopes.get(projectId) ?? (await scopeFor(projectId, form));

        const vorgangRef = entry.vorgang ?? params.vorgang;
        const vorgangId =
          (vorgangRef ? matchOption(scope.vorgaenge, vorgangRef)?.id : undefined) ??
          scope.selectedVorgangId ??
          (scope.vorgaenge.length === 1 ? scope.vorgaenge[0]!.id : undefined);

        if (!vorgangId) {
          return errorResult(
            `No Vorgang determined for project ${projectId}. Available: ${scope.vorgaenge
              .map((v) => `${v.id}=${v.label}`)
              .join(" | ") || "(none readable)"}`,
          );
        }

        const taetigkeit = resolveTaetigkeit(scope, entry.taetigkeit ?? params.taetigkeit);
        const ort = entry.ort ?? params.ort ?? "NULL";
        const comment = entry.bemerkung ?? params.bemerkung ?? "";

        const vorgangLabel = scope.vorgaenge.find((v) => v.id === vorgangId)?.label;
        // Always state the place of work that goes onto the wire: 'NULL' is
        // the default (Erste Tätigkeitsstätte) and is exactly what a booking
        // without an explicit ort gets, so it must not be invisible here.
        const ortLabel = form.orte.find((o) => o.id === ort)?.label;

        planned.push({
          request: {
            date,
            from,
            to,
            duration,
            projektId: projectId,
            vorgangId,
            taetigkeit,
            comment,
            ort,
          },
          label:
            `${date}  ${from}-${to}  (${duration})\n` +
            `         project ${projectId}${scope.project ? ` "${scope.project.label}"` : ""}\n` +
            `         Vorgang ${vorgangId}${vorgangLabel ? ` "${vorgangLabel}"` : ""}\n` +
            `         Tätigkeit ${taetigkeit}, Ort ${ort}` +
            `${ortLabel && ortLabel !== ort ? ` (${ortLabel})` : ""}` +
            `${comment ? `\n         "${comment}"` : ""}`,
        });
      }

      if (params.dryRun) {
        return textResult(
          `DRY RUN - nothing saved (session: ${handle.sessionSource}).\n\n${planned
            .map((p) => p.label)
            .join("\n\n")}`,
          { dryRun: true, planned: planned.map((p) => p.request) },
        );
      }

      // ---------------------------------------------------------------- execute
      const results: string[] = [];
      let failures = 0;
      let firstFailure: string | null = null;

      for (const item of planned) {
        const result = await client.book(item.request);
        if (result.ok) {
          results.push(`OK       ${item.request.date} ${item.request.from}-${item.request.to}`);
        } else {
          failures += 1;
          firstFailure ??= result.error ?? "unknown error";
          results.push(
            `REJECTED ${item.request.date} ${item.request.from}-${item.request.to}\n         ${result.error ?? "unknown error"}`,
          );
        }
      }

      if (failures === 0) {
        updateProfile(profileName, {
          lastProjektId: planned[0]!.request.projektId,
          lastVorgangId: planned[0]!.request.vorgangId,
          lastTaetigkeit: planned[0]!.request.taetigkeit,
        });
      }

      const summary =
        `${planned.length - failures}/${planned.length} booking(s) saved.` +
        (failures ? `\nFirst error: ${firstFailure}` : "");

      const text = `${summary}\n\n${results.join("\n")}`;
      return failures ? errorResult(text, { failures }) : textResult(text, { saved: planned.length });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (error instanceof ZepError && error.attemptsLeft !== undefined) {
        return errorResult(`${message} (${error.attemptsLeft} password attempts left)`);
      }
      return errorResult(message);
    }
  },
};

function resolveTaetigkeit(scope: ProjectScope, reference: string | undefined): string {
  if (reference) {
    const match = matchOption(scope.taetigkeiten, reference);
    if (match) return match.id;
  }
  return scope.taetigkeiten.find((t) => t.selected)?.id ?? scope.taetigkeiten[0]?.id ?? "co";
}
