import { DateTime } from 'luxon';

// Provides the ambient `DateTime` global (src/globals.d.ts), as the Code-node sandbox does.
globalThis.DateTime = DateTime;
