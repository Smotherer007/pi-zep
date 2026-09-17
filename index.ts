/**
 * pi ZEP Extension
 *
 * A ZEP time-tracking client that talks to the zep-online.de web UI's own
 * PHP endpoint instead of the paid ZEP REST API.
 *
 * Tools:
 *   - zep_doctor:   diagnose config, session and reachability without spending a login attempt
 *   - zep_setup:    store userid/password/Mandant
 *   - zep_login:    log in (password, or adopt a browser tab session)
 *   - zep_status:   show config, log in, prove the session works
 *   - zep_profile:  list/switch/delete profiles, clear cached sessions
 *   - zep_projects: list projects and their Vorgänge/Tätigkeiten
 *   - zep_week:     read the Projektzeiten week overview
 *   - zep_book:     create bookings (one or several blocks)
 *   - zep_delete:   delete a booking
 *   - zep_plan:     read the capacity planning (Einplanung / Kapa-Planung)
 *   - zep_plan_set: write planned hours into the Einplanung matrix
 *
 * Design:
 *   - types.ts                  plain data shapes
 *   - config.ts                 profile + session persistence (~/.pi)
 *   - clients/zep-client.ts     HTTP session handling and the booking call
 *   - clients/zep-parse.ts      tolerant parsers for ZEP's HTML/JSON
 *   - formatting/formatters.ts  domain data -> text
 *   - tools/*.ts                one tool per file
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { loadConfig } from "./src/config.ts";
import { ZepDoctorTool } from "./src/tools/zep-doctor.ts";
import { ZepSetupTool } from "./src/tools/zep-setup.ts";
import { ZepLoginTool } from "./src/tools/zep-login.ts";
import { ZepStatusTool } from "./src/tools/zep-status.ts";
import { ZepProfileTool } from "./src/tools/zep-profile.ts";
import { ZepProjectsTool } from "./src/tools/zep-projects.ts";
import { ZepWeekTool } from "./src/tools/zep-week.ts";
import { ZepBookTool } from "./src/tools/zep-book.ts";
import { ZepDeleteTool } from "./src/tools/zep-delete.ts";
import { ZepPlanTool } from "./src/tools/zep-plan.ts";
import { ZepPlanSetTool } from "./src/tools/zep-plan-set.ts";

export default function (pi: ExtensionAPI) {
  loadConfig();

  pi.registerTool(ZepDoctorTool);
  pi.registerTool(ZepSetupTool);
  pi.registerTool(ZepLoginTool);
  pi.registerTool(ZepStatusTool);
  pi.registerTool(ZepProfileTool);
  pi.registerTool(ZepProjectsTool);
  pi.registerTool(ZepWeekTool);
  pi.registerTool(ZepBookTool);
  pi.registerTool(ZepDeleteTool);
  pi.registerTool(ZepPlanTool);
  pi.registerTool(ZepPlanSetTool);
}
