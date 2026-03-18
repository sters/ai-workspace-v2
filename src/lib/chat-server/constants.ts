/** Maximum output buffer chunks before trimming */
export const BUFFER_HIGH = 5000;
/** Number of chunks to keep after trim */
export const BUFFER_LOW = 3000;
/** GC: max age (ms) for exited sessions before cleanup */
export const GC_MAX_AGE_MS = 10 * 60 * 1000;
/** GC: max number of exited sessions to keep */
export const GC_MAX_EXITED = 10;
/** GC interval (ms) */
export const GC_INTERVAL_MS = 60 * 1000;
