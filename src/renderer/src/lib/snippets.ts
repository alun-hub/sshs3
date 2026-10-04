import { formatDateTime } from './format';

export interface SnippetContext {
  host: string;
  user: string;
}

/** Fills `{{host}}`, `{{user}}` and `{{date}}`; unknown variables are left untouched. */
export function expandSnippet(command: string, ctx: SnippetContext, now: Date = new Date()): string {
  return command.replace(/\{\{\s*(host|user|date)\s*\}\}/g, (_m, name: string) => {
    if (name === 'host') return ctx.host;
    if (name === 'user') return ctx.user;
    return formatDateTime(now);
  });
}
