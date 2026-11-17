/**
 * MUST be imported before `joy-con-webhid`.
 *
 * joy-con-webhid (v0.11) calls `navigator.hid.addEventListener(...)` at module
 * top level. In browsers without WebHID (Firefox, Safari, insecure contexts)
 * that throws during import and would take the whole game down.
 *
 * We record the real support status first, then install an inert stand-in so the
 * library can load. The game checks `hidSupported` before offering the connect
 * button, so the stand-in is never used for actual device access.
 */
export const hidSupported =
  typeof navigator !== 'undefined' && 'hid' in navigator && !!navigator.hid && globalThis.isSecureContext;

export const hidUnsupportedReason = (() => {
  if (typeof navigator === 'undefined') return 'No navigator object.';
  if (!globalThis.isSecureContext) return 'WebHID needs a secure context (https:// or http://localhost).';
  if (!('hid' in navigator)) return 'This browser has no WebHID. Use desktop Chrome or Edge (v89+).';
  return '';
})();

if (typeof navigator !== 'undefined' && !('hid' in navigator && navigator.hid)) {
  const stub = new EventTarget();
  stub.getDevices = async () => [];
  stub.requestDevice = async () => {
    throw new DOMException(hidUnsupportedReason, 'NotSupportedError');
  };
  try {
    Object.defineProperty(navigator, 'hid', { value: stub, configurable: true });
  } catch {
    /* ignore – library import may still fail, caught by the dynamic fallback */
  }
}
