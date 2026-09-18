/**
 * Rough, dependency-free password strength heuristic for the master
 * password dialog. Not a substitute for a proper estimator (e.g. zxcvbn) —
 * just enough to nudge users away from an obviously weak master password
 * before they commit to one that can never be reset.
 */
export interface PasswordStrength {
  score: 0 | 1 | 2 | 3 | 4;
  label: 'Very weak' | 'Weak' | 'Fair' | 'Strong' | 'Very strong';
  colorClassName: string;
}

export function estimatePasswordStrength(password: string): PasswordStrength {
  let score = 0;
  if (password.length >= 8) score++;
  if (password.length >= 14) score++;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
  if (/[0-9]/.test(password) && /[^a-zA-Z0-9]/.test(password)) score++;

  const clamped = Math.min(score, 4) as PasswordStrength['score'];
  const labels: PasswordStrength['label'][] = ['Very weak', 'Weak', 'Fair', 'Strong', 'Very strong'];
  const colors = ['bg-red-500', 'bg-orange-500', 'bg-amber-500', 'bg-sky-500', 'bg-emerald-500'];

  return {
    score: clamped,
    label: password ? labels[clamped] : 'Very weak',
    colorClassName: colors[clamped],
  };
}
