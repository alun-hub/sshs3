import { useEffect, useState } from 'react';
import { isCertificateFileName } from '../../../shared/certificateFileName';
import type { CertificatePreviewResult } from '../../../shared/types/certificate';

/**
 * Loads the certificate facts for a hovered file. The main process reads and parses the file, so nothing
 * but those facts reaches the renderer (a .pem often holds a private key too). Only files named like a
 * certificate are looked at; `undefined` means no certificate (yet).
 */
export function useCertificatePreview(
  providerId: string | undefined,
  filePath: string,
  enabled: boolean
): CertificatePreviewResult | undefined {
  const [result, setResult] = useState<CertificatePreviewResult>();

  useEffect(() => {
    setResult(undefined);
    if (!enabled || !providerId || !window.multissh?.certificatePreview || !isCertificateFileName(filePath)) {
      return undefined;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      window.multissh
        .certificatePreview(providerId, filePath)
        .then((res) => {
          if (!cancelled && res.certs.length > 0) setResult(res);
        })
        .catch(() => {
          // No preview; the card shows what it always did.
        });
    }, 40);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [providerId, filePath, enabled]);

  return result;
}
