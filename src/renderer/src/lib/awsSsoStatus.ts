import type { AwsSsoStatusInfo } from '@shared/types/awsScan';
import { formatDateTime } from './dateFormat';

export type SsoStatusTone = 'ok' | 'warn' | 'none';

/** One line for the sign-in status row; the tone picks the colour (never colour alone: the text carries it too). */
export function describeSsoStatus(info: AwsSsoStatusInfo | null, checking: boolean): { tone: SsoStatusTone; text: string } {
  if (!info) return { tone: 'none', text: checking ? 'Checking sign-in…' : 'Not signed in' };
  if (info.status === 'valid') return { tone: 'ok', text: `Signed in until ${formatDateTime(info.expiresAt)}` };
  if (info.status === 'expired') return { tone: 'warn', text: 'Sign-in expired. Sign in again.' };
  return { tone: 'none', text: 'Not signed in' };
}
