// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { K8sLoginModal } from '../../src/renderer/src/components/K8s/K8sLoginModal';
import type { K8sWebLoginResult } from '../../src/shared/types/kubernetes';

const loginResult: K8sWebLoginResult = {
  success: true,
  contextName: 'team-a/api/alice',
  clusterName: 'api',
  userName: 'alice/api',
  server: 'https://api.cluster.example.com:6443',
  namespace: 'team-a',
  projects: ['team-a'],
};

const SERVER = 'https://api.cluster.example.com:6443';

describe('K8sLoginModal browser sign-in', () => {
  const probe = vi.fn();
  const webLogin = vi.fn();
  const webLoginCancel = vi.fn();
  const pasteLogin = vi.fn();
  const onClose = vi.fn();
  const onSuccess = vi.fn();

  beforeEach(() => {
    probe.mockReset().mockResolvedValue({ supported: false });
    webLogin.mockReset().mockResolvedValue(loginResult);
    webLoginCancel.mockReset().mockResolvedValue(undefined);
    pasteLogin.mockReset().mockResolvedValue(loginResult);
    onClose.mockReset();
    onSuccess.mockReset();
    window.multissh = {
      ...(window.multissh || {}),
      k8sOpenShiftProbe: probe,
      k8sOpenShiftWebLogin: webLogin,
      k8sOpenShiftWebLoginCancel: webLoginCancel,
      k8sLogin: pasteLogin,
    } as never;
  });

  afterEach(() => cleanup());

  const renderModal = (open = true) => render(<K8sLoginModal open={open} onClose={onClose} onSuccess={onSuccess} />);
  const tokenLabel = () => screen.getByText(/API Token/, { selector: 'label' });
  const typeServer = (value = SERVER) =>
    fireEvent.change(screen.getByLabelText('API server URL'), { target: { value } });

  it('keeps the paste flow only when the cluster has no OpenShift OAuth server', async () => {
    renderModal();
    typeServer();
    await waitFor(() => expect(probe).toHaveBeenCalledWith(SERVER, false), { timeout: 3000 });
    expect(screen.queryByTestId('openshift-web-login')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Paste oc login command')).toBeInTheDocument();
  });

  it('marks the token as required for the paste flow when browser sign-in is not available', async () => {
    renderModal();
    typeServer();
    await waitFor(() => expect(probe).toHaveBeenCalled(), { timeout: 3000 });
    expect(screen.getByLabelText('Token')).toBeRequired();
    expect(screen.queryByText('(not needed for browser sign-in)')).not.toBeInTheDocument();
    expect(within(tokenLabel()).getByText('*')).toBeInTheDocument();
  });

  it('shows the token as not needed once browser sign-in is available', async () => {
    probe.mockResolvedValue({ supported: true });
    renderModal();
    typeServer();
    expect(await screen.findByText('(not needed for browser sign-in)', {}, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.getByLabelText('Token')).not.toBeRequired();
    expect(within(tokenLabel()).queryByText('*')).not.toBeInTheDocument();
  });

  it('still requires a token for the paste submit even when browser sign-in is available', async () => {
    probe.mockResolvedValue({ supported: true });
    renderModal();
    typeServer();
    await screen.findByText('(not needed for browser sign-in)', {}, { timeout: 3000 });

    fireEvent.click(screen.getByRole('button', { name: /log in & connect/i }));
    expect(await screen.findByText('Token is required')).toBeInTheDocument();
    expect(pasteLogin).not.toHaveBeenCalled();
  });

  it('does not probe while closed or before a server is entered', async () => {
    renderModal(false);
    await new Promise((resolve) => setTimeout(resolve, 800));
    expect(probe).not.toHaveBeenCalled();
  });

  it('shows the browser button when the cluster supports it and signs in', async () => {
    probe.mockResolvedValue({ supported: true });
    renderModal();
    typeServer();
    fireEvent.change(screen.getByLabelText('Default project / namespace'), { target: { value: 'team-a' } });

    const button = await screen.findByRole('button', { name: /sign in with browser/i }, { timeout: 3000 });
    fireEvent.click(button);

    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith(loginResult));
    expect(webLogin).toHaveBeenCalledWith({ server: SERVER, insecureSkipTlsVerify: false, namespace: 'team-a' });
    expect(onClose).toHaveBeenCalled();
    expect(pasteLogin).not.toHaveBeenCalled();
  });

  it('starts the browser sign-in with Enter in the server field when no token is entered', async () => {
    probe.mockResolvedValue({ supported: true });
    renderModal();
    typeServer();
    await screen.findByRole('button', { name: /sign in with browser/i }, { timeout: 3000 });

    fireEvent.keyDown(screen.getByLabelText('API server URL'), { key: 'Enter' });
    await waitFor(() => expect(webLogin).toHaveBeenCalledTimes(1));
    expect(pasteLogin).not.toHaveBeenCalled();
  });

  it('shows the error and keeps the paste fields when browser sign-in fails', async () => {
    probe.mockResolvedValue({ supported: true });
    webLogin.mockRejectedValue(new Error("Error invoking remote method 'k8s:openshift-web-login': Error: Timed out waiting for the browser sign-in."));
    renderModal();
    typeServer();
    fireEvent.click(await screen.findByRole('button', { name: /sign in with browser/i }, { timeout: 3000 }));

    expect(await screen.findByText('Timed out waiting for the browser sign-in.')).toBeInTheDocument();
    expect(onSuccess).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByLabelText('API server URL')).toHaveValue(SERVER);
    expect(screen.getByLabelText('Paste oc login command')).toBeInTheDocument();
  });

  it('cancels a pending sign-in with Escape instead of closing the dialog, silently', async () => {
    probe.mockResolvedValue({ supported: true });
    let reject!: (err: Error) => void;
    webLogin.mockReturnValue(new Promise((_resolve, rej) => (reject = rej)));
    renderModal();
    typeServer();
    fireEvent.click(await screen.findByRole('button', { name: /sign in with browser/i }, { timeout: 3000 }));
    await screen.findByText(/Waiting for browser sign-in/);

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(webLoginCancel).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();

    reject(new Error('OpenShift browser sign-in was cancelled'));
    await waitFor(() => expect(screen.queryByText(/Waiting for browser sign-in/)).not.toBeInTheDocument());
    expect(screen.queryByText(/was cancelled/)).not.toBeInTheDocument();

    // With nothing pending, Escape closes the dialog as before.
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('still logs in with a pasted token', async () => {
    renderModal();
    fireEvent.change(screen.getByLabelText('Paste oc login command'), {
      target: { value: `oc login --token=sha256~pasted --server=${SERVER}` },
    });
    fireEvent.click(screen.getByRole('button', { name: /log in & connect/i }));

    await waitFor(() => expect(pasteLogin).toHaveBeenCalled());
    expect(pasteLogin).toHaveBeenCalledWith(expect.objectContaining({ server: SERVER, token: 'sha256~pasted' }));
    expect(webLogin).not.toHaveBeenCalled();
    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith(loginResult));
  });
});
