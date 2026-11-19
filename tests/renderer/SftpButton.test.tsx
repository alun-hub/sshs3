// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { SftpButton } from '../../src/renderer/src/components/SftpButton';

afterEach(() => cleanup());

describe('SftpButton', () => {
  it('is shown for a normal profile and for SSH over SSM', () => {
    render(<SftpButton authType="key" onOpen={vi.fn()} />);
    render(<SftpButton authType="key" ssm={{ enabled: true }} onOpen={vi.fn()} />);
    expect(screen.getAllByRole('button', { name: /SFTP/ })).toHaveLength(2);
  });

  it('is not shown for a Session Manager shell profile (no SSH, nothing for SFTP to open)', () => {
    render(<SftpButton authType="key" ssm={{ enabled: true, mode: 'shell' }} onOpen={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /SFTP/ })).toBeNull();
  });
});
