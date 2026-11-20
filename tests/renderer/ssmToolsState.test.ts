import { describe, it, expect } from 'vitest';
import { ssmToolsReadiness, shouldPollSsmTools } from '../../src/renderer/src/lib/ssmToolsState';

describe('ssmToolsReadiness', () => {
  it('walks missing -> outdated -> ready', () => {
    expect(ssmToolsReadiness(null)).toBe('checking');
    expect(ssmToolsReadiness({ aws: { found: true }, plugin: { found: false } })).toBe('missing');
    expect(ssmToolsReadiness({ aws: { found: false }, plugin: { found: true, ok: true } })).toBe('missing');
    expect(ssmToolsReadiness({ aws: { found: true }, plugin: { found: true, ok: false } })).toBe('outdated');
    expect(ssmToolsReadiness({ aws: { found: true }, plugin: { found: true, ok: true } })).toBe('ready');
  });
  it('polls only while something is missing and visible', () => {
    expect(shouldPollSsmTools('missing', true)).toBe(true);
    expect(shouldPollSsmTools('outdated', true)).toBe(true);
    expect(shouldPollSsmTools('ready', true)).toBe(false);
    expect(shouldPollSsmTools('checking', true)).toBe(false);
    expect(shouldPollSsmTools('missing', false)).toBe(false);
  });
});
