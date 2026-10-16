/** navigator.vibrate, guarded: iOS Safari and desktop browsers don't support it, and some block it without a user gesture. */
export function vibrate(pattern) {
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') navigator.vibrate(pattern);
  } catch { /* unsupported / blocked */ }
}
