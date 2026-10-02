import { IS_WINDOWS } from './platform';

/**
 * Display helpers for PKCS#11 modules. Raw library paths ("C:\Program Files\OpenSC Project\...\opensc-pkcs11.dll",
 * "/usr/lib64/p11-kit-proxy.so") are meaningful to someone debugging a driver but opaque to everyone else, so
 * the UI leads with a short human name and keeps the path for a tooltip.
 */

const KNOWN_LIBRARIES: Array<{ match: RegExp; name: string }> = [
  { match: /^onepin-opensc-pkcs11$/i, name: 'OpenSC (single PIN)' },
  { match: /^opensc-pkcs11$/i, name: 'OpenSC' },
  { match: /^libykcs11$/i, name: 'YubiKey (PIV)' },
  { match: /^(libiidp11|iidp11)$/i, name: 'Net iD' },
  { match: /^p11-kit-proxy$/i, name: 'p11-kit' },
];

/** Splits on both separators: a Windows path has backslashes, so `split('/')` alone returns the whole path. */
function baseName(p: string): string {
  return p.split(/[\\/]/).pop() || p;
}

/** A short, friendly name for a PKCS#11 module path ("OpenSC", "YubiKey (PIV)", ...). */
export function pkcs11LibDisplayName(pkcs11LibPath: string): string {
  if (!pkcs11LibPath) return 'Security Key';
  const stem = baseName(pkcs11LibPath).replace(/\.(so|dll|dylib)(\.\d+)*$/i, '');
  // The friendly-name table is Windows-only; other platforms keep showing the bare library name as before.
  if (!IS_WINDOWS) return stem || pkcs11LibPath;
  return KNOWN_LIBRARIES.find((k) => k.match.test(stem))?.name ?? (stem || pkcs11LibPath);
}

/** True for a key comment that is really just a library path — ssh-add labels PKCS#11 keys with the module path. */
export function looksLikeLibraryPath(text: string): boolean {
  return /[\\/]/.test(text) && /\.(so|dll|dylib)(\.\d+)*$/i.test(text.trim());
}

/** Default PKCS#11 module when a smartcard profile has none yet: p11-kit (it fronts every registered module), else the first one found. */
export function pickDefaultPkcs11Lib(libs: Array<{ name?: string; path: string }>): string | undefined {
  const p11kit = libs.find((l) => /p11-kit/i.test(l.name ?? '') || /p11-kit-proxy/i.test(l.path));
  return (p11kit ?? libs[0])?.path;
}

/** Example path for an empty PKCS#11 field: the detected default, else a typical one for the platform. */
export function pkcs11PlaceholderPath(detectedDefault?: string): string {
  if (detectedDefault) return detectedDefault;
  return IS_WINDOWS ? 'C:\\Program Files\\OpenSC Project\\OpenSC\\pkcs11\\opensc-pkcs11.dll' : '/usr/lib64/p11-kit-proxy.so';
}
