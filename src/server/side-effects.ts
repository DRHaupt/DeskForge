/**
 * Global switch for outward side effects (queued jobs, outgoing email).
 * Turned off by the demo seed so loading sample data never emails anyone.
 * Tests use their own in-memory transports instead.
 */
let enabled = process.env.NODE_ENV !== "test";
let emailEnabled = true;

export function sideEffectsEnabled() {
  return enabled;
}
export function emailSideEffectsEnabled() {
  return emailEnabled;
}
export function setSideEffects(on: boolean) {
  enabled = on;
  emailEnabled = on;
}
/** Tests: keep in-process email (memory transport) while queueing is off. */
export function setQueueing(on: boolean) {
  enabled = on;
}
