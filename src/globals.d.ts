import type { DateTime as LuxonDateTime } from 'luxon';

// The n8n Code-node sandbox injects Luxon's DateTime as a global (no import, no require);
// `tests/setup.ts` provides it at test time.
declare global {
  var DateTime: typeof LuxonDateTime;
  type DateTime = LuxonDateTime;
}
