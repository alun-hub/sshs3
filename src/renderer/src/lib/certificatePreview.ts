import type { CertificateInfo, CertificatePreviewError } from '../../../shared/types/certificate';
import { formatDateTime } from './dateFormat';

export type CertificateTone = 'ok' | 'warn' | 'bad';

/** One line about the validity period. Dates only: the chain and revocation are not checked. */
export function describeValidity(cert: Pick<CertificateInfo, 'validity' | 'daysLeft' | 'notBefore'>): {
  label: string;
  tone: CertificateTone;
} {
  const days = Math.abs(cert.daysLeft ?? 0);
  const plural = days === 1 ? 'day' : 'days';
  switch (cert.validity) {
    case 'not-yet-valid':
      return { label: `Not valid until ${formatDateTime(cert.notBefore)}`, tone: 'bad' };
    case 'expired':
      return { label: days === 0 ? 'Expired today' : `Expired ${days} ${plural} ago`, tone: 'bad' };
    case 'expiring':
      return { label: days === 0 ? 'Expires today' : `Expires in ${days} ${plural}`, tone: 'warn' };
    default:
      return { label: `Valid, ${days} ${plural} left`, tone: 'ok' };
  }
}

/** What to tell the user when a file yielded no certificate details. */
export function describePreviewError(error: CertificatePreviewError | undefined): string {
  switch (error) {
    case 'too-large':
      return 'This file is larger than 64 KiB, which is too large to preview as a certificate.';
    case 'unreadable':
      return 'The file could not be read or is not a valid certificate.';
    default:
      return 'No certificate was found in this file.';
  }
}
