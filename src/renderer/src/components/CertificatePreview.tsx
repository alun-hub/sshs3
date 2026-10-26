import React from 'react';
import type { CertificateInfo, CertificatePreviewResult } from '../../../shared/types/certificate';
import { describeValidity, type CertificateTone } from '../lib/certificatePreview';
import { classNames } from '../lib/format';
import { formatDateTime } from '../lib/dateFormat';

const TONE_STYLES: Record<CertificateTone, string> = {
  ok: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30',
  warn: 'bg-amber-500/15 text-amber-300 ring-amber-500/30',
  bad: 'bg-red-500/15 text-red-300 ring-red-500/30',
};

const Row: React.FC<{ label: string; children: React.ReactNode; title?: string }> = ({ label, children, title }) => (
  <div className="flex gap-2 text-[11px] leading-relaxed">
    <span className="w-14 shrink-0 text-txt-muted">{label}</span>
    <span className="min-w-0 flex-1 break-words text-txt-primary" title={title}>
      {children}
    </span>
  </div>
);

const Tag: React.FC<{ children: React.ReactNode; warn?: boolean }> = ({ children, warn }) => (
  <span
    className={classNames(
      'rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider ring-1 ring-inset',
      warn ? TONE_STYLES.warn : 'bg-slate-500/15 text-slate-300 ring-slate-500/30'
    )}
  >
    {children}
  </span>
);

const CertificateBlock: React.FC<{ cert: CertificateInfo; detailed: boolean }> = ({ cert, detailed }) => {
  const validity = describeValidity(cert);
  const sans = cert.moreSans > 0 ? [...cert.sans, `+${cert.moreSans} more`] : cert.sans;
  return (
    <div className="space-y-0.5" data-testid="certificate-block">
      <div className="mb-1 flex flex-wrap items-center gap-1">
        <span
          className={classNames(
            'rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset',
            TONE_STYLES[validity.tone]
          )}
        >
          {validity.label}
        </span>
        {cert.isCa && <Tag>CA</Tag>}
        {cert.selfSigned && <Tag>Self-signed</Tag>}
        {cert.weakSignature && <Tag warn>Weak signature</Tag>}
      </div>
      <Row label="Subject">{cert.subject || '—'}</Row>
      <Row label="Issuer">{cert.issuer || '—'}</Row>
      <Row label="Valid">
        {formatDateTime(cert.notBefore)} → {formatDateTime(cert.notAfter)}
      </Row>
      {sans.length > 0 && <Row label="SAN">{sans.join(', ')}</Row>}
      <Row label="Key">
        {[cert.publicKey, cert.signatureAlgorithm].filter(Boolean).join(' · ')}
      </Row>
      {detailed && cert.extendedKeyUsage.length > 0 && <Row label="Usage">{cert.extendedKeyUsage.join(', ')}</Row>}
      {detailed && (
        <>
          <Row label="Serial">{cert.serialNumber}</Row>
          <Row label="SHA-256" title={cert.sha256}>
            <span className="font-mono text-[10px]">{cert.sha256}</span>
          </Row>
        </>
      )}
    </div>
  );
};

/** Human-readable view of the certificates in a file, shown in place of the text snippet. */
export const CertificatePreview: React.FC<{ result: CertificatePreviewResult }> = ({ result }) => {
  const { certs, moreCerts } = result;
  const detailed = certs.length === 1;
  return (
    <div
      data-testid="certificate-preview"
      className="my-2.5 space-y-2 overflow-hidden rounded-xl border border-divider/70 bg-slate-950/70 p-2 select-text"
    >
      {certs.length > 1 && (
        <div className="text-[10px] text-txt-muted">
          {certs.length + moreCerts} certificates{moreCerts > 0 ? ` (first ${certs.length} shown)` : ''}
        </div>
      )}
      {certs.map((cert, index) => (
        <div key={`${index}-${cert.sha256}`} className="border-t border-white/5 pt-2 first:border-t-0 first:pt-0">
          <CertificateBlock cert={cert} detailed={detailed} />
        </div>
      ))}
    </div>
  );
};
