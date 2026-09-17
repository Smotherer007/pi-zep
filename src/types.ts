/**
 * Data types for the pi ZEP extension.
 *
 * Everything here is a plain immutable-shaped interface: no behaviour,
 * no classes. I/O lives in clients/, formatting in formatting/.
 */

// ---------------------------------------------------------------- configuration

/**
 * One ZEP account/mandant ("Mandant" = the tenant path segment, e.g. `zepneoimpulse`).
 */
export interface ZepAccount {
  readonly name: string;
  /** Origin of the ZEP installation, e.g. `https://zep-online.de`. */
  readonly baseUrl: string;
  /** Mandant / client path segment, e.g. `zepneoimpulse`. */
  readonly mandant: string;
  /** ZEP user id as used on the login form, e.g. `patrick.weppelmann`. */
  readonly userid: string;
  readonly password: string;
  /** Last used booking selection, so repeat bookings need fewer parameters. */
  readonly lastProjektId?: string;
  readonly lastVorgangId?: string;
  readonly lastTaetigkeit?: string;
}

export interface ZepConfigFile {
  readonly profiles: Record<string, ZepAccount>;
  readonly activeProfile: string | null;
}

/**
 * Cached server-side session. ZEP binds a session to `CLIENTSESSID`
 * (URL parameter) plus a `PHPSESSID` cookie - both are needed.
 */
export interface ZepSession {
  readonly clientsessid: string;
  /** CSRF-ish token; rotates on every server response. */
  readonly requesttoken: string | null;
  readonly cookies: Record<string, string>;
  readonly savedAt: string;
}

/** Result of a login attempt. */
export interface LoginResult {
  readonly ok: boolean;
  readonly clientsessid?: string;
  readonly message?: string;
  /** Remaining password attempts before ZEP locks the account. */
  readonly attemptsLeft?: number;
}

// ---------------------------------------------------------------- domain

export interface ZepOption {
  readonly id: string;
  readonly label: string;
  readonly selected?: boolean;
  readonly disabled?: boolean;
}

export interface ZepFormData {
  /** Project options from the booking form (#projektId). */
  readonly projects: ReadonlyArray<ZepOption>;
  /** Vorgang (sub-project / work package) options for the currently selected project. */
  readonly vorgaenge: ReadonlyArray<ZepOption>;
  /** Activity options (#taetigkeit). */
  readonly taetigkeiten: ReadonlyArray<ZepOption>;
  /** Location options (#ort). */
  readonly orte: ReadonlyArray<ZepOption>;
  /** Currently selected ids. */
  readonly selected: {
    readonly projektId: string | null;
    readonly vorgangId: string | null;
    readonly taetigkeit: string | null;
    readonly ort: string | null;
  };
}

/** One row of the week overview table. */
export interface ZepBooking {
  /** Server-side id, needed to edit/delete the row. */
  readonly objectId: string | null;
  /** e.g. `Do 17.09.` */
  readonly dayLabel: string;
  /** ISO date when known, e.g. `2026-09-17`. */
  readonly date: string | null;
  readonly from: string;
  readonly to: string;
  readonly duration: string;
  readonly project: string;
  readonly vorgang: string;
  readonly taetigkeit: string;
  readonly billable: boolean;
  readonly comment: string;
  /**
   * Place of work as the table renders it, e.g. `D-Office`.
   *
   * ZEP only draws this cell when there is something to say, so `null` means
   * "no cell rendered" and therefore the default place of work (`NULL`).
   */
  readonly ort: string | null;
}

export interface ZepWeekDay {
  readonly dayLabel: string;
  readonly date: string | null;
  readonly bookings: ReadonlyArray<ZepBooking>;
  /** Sum line: total duration, e.g. `8,00`. */
  readonly total: string | null;
  /** `payments x,00` marker when the day is billable. */
  readonly billableTotal: string | null;
  /** True when the day has no booking at all and no target hours. */
  readonly empty: boolean;
  /** True when the day is under-booked (`pzminuszeit`). */
  readonly underBooked: boolean;
  /** True when the day lies in the future. */
  readonly future: boolean;
  /** True for today. */
  readonly today: boolean;
}

export interface ZepWeek {
  /** Monday of the shown week, ISO date. */
  readonly kwDate: string;
  readonly days: ReadonlyArray<ZepWeekDay>;
}

/** A booking request to send to ZEP. */
export interface ZepBookingRequest {
  readonly date: string;
  readonly from: string;
  readonly to: string;
  readonly duration: string;
  readonly projektId: string;
  readonly vorgangId: string;
  readonly taetigkeit: string;
  readonly comment: string;
  readonly ort?: string;
}

export interface ZepSaveResult {
  readonly ok: boolean;
  /** Server error text, e.g. the "Plan Stunden überschritten" notice. */
  readonly error?: string;
  readonly message?: string;
}

// ---------------------------------------------------------------- tool params

export interface SetupParams {
  name: string;
  userid: string;
  password: string;
  mandant?: string;
  baseUrl?: string;
}

// ------------------------------------------------- capacity planning (Einplanung)

/** One project's planned hours on one day. */
export interface ZepPlanSlice {
  readonly project: string;
  readonly hours: number;
}

/** One day on the Einplanung chart. */
export interface ZepPlanDay {
  /** Day label exactly as ZEP prints it: `Heute`, `Morgen` or `19.09.`. */
  readonly label: string;
  /** Resolved ISO date of that column. */
  readonly date: string;
  /** Available hours from ZEP's `Verfügbarkeit` series, null when absent. */
  readonly available: number | null;
  /** Planned hours from ZEP's `gesamt` series. */
  readonly planned: number;
  /** Planned hours per project on this day, largest first. */
  readonly slices: ReadonlyArray<ZepPlanSlice>;
}

/** A project's planned hours over the whole requested range. */
export interface ZepPlanProject {
  readonly project: string;
  readonly hours: number;
}

/** Result of reading the Einplanung (capacity planning) chart. */
export interface ZepPlan {
  /** Chart title - the employee the plan belongs to. */
  readonly title: string | null;
  /** Requested range, ISO dates. */
  readonly from: string;
  readonly to: string;
  /** Range as ZEP prints it in the chart subtitle. */
  readonly range: string | null;
  /** Sum of the availability series. */
  readonly capacity: number;
  /** Sum of the `gesamt` series. */
  readonly planned: number;
  readonly projects: ReadonlyArray<ZepPlanProject>;
  readonly days: ReadonlyArray<ZepPlanDay>;
}

export interface ZepPlanRequest {
  readonly from: string;
  readonly to: string;
  /** `alle`, `intern` or `kunden` - ZEP's Projekttyp filter. */
  readonly projektTyp?: string;
  /** Project ids for ZEP's Projekt filter. */
  readonly projektIds?: ReadonlyArray<string>;
}

/**
 * One cell of the Einplanung matrix as ZEP stores it.
 *
 * ZEP keeps the plan per project and day, either as hours (`h`) or as a
 * percentage of that day's availability (`%`). `value: null` clears the cell.
 */
export interface ZepPlanEntry {
  readonly projektId: string;
  readonly date: string;
  readonly value: number | null;
  readonly unit: "h" | "%";
  readonly comment?: string;
}

export interface ZepPlanSaveRequest {
  readonly entries: ReadonlyArray<ZepPlanEntry>;
  /** ZEP's "Einplanung auch an Nicht-Arbeitstagen" switch. */
  readonly auchAnNichtArbeitstagen?: boolean;
}
