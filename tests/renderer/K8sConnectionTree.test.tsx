// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { K8sConnectionTree } from '../../src/renderer/src/components/ConnectionModal/K8sConnectionTree';

describe('K8sConnectionTree', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (window as any).multissh = {
      k8sListContexts: vi.fn().mockResolvedValue([
        {
          contextName: 'minikube',
          clusterName: 'minikube',
          server: 'https://192.168.49.2:8443',
          user: 'minikube',
          isCurrent: true,
          namespaces: [],
        },
      ]),
      k8sListNamespaces: vi.fn().mockResolvedValue([
        { name: 'default', pods: [] },
      ]),
      k8sListPods: vi.fn().mockResolvedValue([
        {
          name: 'nginx-pod',
          namespace: 'default',
          phase: 'Running',
          containers: [
            {
              name: 'nginx',
              image: 'nginx:alpine',
              ready: true,
              state: 'running',
              ports: [{ containerPort: 80 }],
            },
          ],
        },
      ]),
      k8sListPortForwards: vi.fn().mockResolvedValue([]),
      onK8sPortForwardEvent: vi.fn().mockReturnValue(() => {}),
      k8sReload: vi.fn().mockResolvedValue(undefined),
      k8sLogin: vi.fn().mockResolvedValue({
        success: true,
        contextName: 'default/api-test-com:6443/user',
        clusterName: 'api-test-com:6443',
        userName: 'user/api-test-com:6443',
        server: 'https://api.test.com:6443',
        namespace: 'default',
        projects: ['default'],
      }),
      onK8sConfigChanged: vi.fn().mockReturnValue(() => {}),
    };
  });

  afterEach(() => {
    cleanup();
  });

  it('renders context, expands namespace, and triggers onBrowseFiles when Files button is clicked', async () => {
    const handleBrowseFiles = vi.fn();
    const handleExec = vi.fn();
    const handleViewLogs = vi.fn();

    render(
      <K8sConnectionTree
        onBrowseFiles={handleBrowseFiles}
        onExec={handleExec}
        onViewLogs={handleViewLogs}
      />
    );

    // Context should load
    expect(await screen.findByText('minikube')).toBeInTheDocument();

    // Click context to expand namespaces
    await act(async () => {
      fireEvent.click(screen.getByText('minikube'));
    });
    expect(await screen.findByText('default')).toBeInTheDocument();

    // Click namespace to expand pods
    await act(async () => {
      fireEvent.click(screen.getByText('default'));
    });
    expect(await screen.findByText('nginx-pod')).toBeInTheDocument();

    // Click pod to expand containers
    await act(async () => {
      fireEvent.click(screen.getByText('nginx-pod'));
    });
    expect(await screen.findByText('nginx')).toBeInTheDocument();

    // Find and click "Files" button
    const filesBtn = screen.getByTitle('Browse container filesystem');
    expect(filesBtn).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(filesBtn);
    });

    expect(handleBrowseFiles).toHaveBeenCalledWith({
      contextName: 'minikube',
      namespace: 'default',
      podName: 'nginx-pod',
      containerName: 'nginx',
    });
  });

  it('does not show OpenShift login button when enableOpenShift is false or omitted', async () => {
    render(<K8sConnectionTree enableOpenShift={false} />);

    expect(await screen.findByText('minikube')).toBeInTheDocument();
    expect(screen.queryByTitle('Log in to OpenShift or Kubernetes with token')).not.toBeInTheDocument();
    expect(screen.queryByText('OpenShift Login')).not.toBeInTheDocument();
  });

  it('does not show OpenShift login button in empty state when enableOpenShift is false', async () => {
    (window as any).multissh.k8sListContexts.mockResolvedValueOnce([]);

    render(<K8sConnectionTree enableOpenShift={false} />);

    expect(await screen.findByText('No contexts found in ~/.kube/config')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /OpenShift \/ Kubernetes Login/ })).not.toBeInTheDocument();
  });

  it('opens OpenShift Login modal and performs token login when enableOpenShift is true', async () => {
    render(<K8sConnectionTree enableOpenShift={true} />);

    expect(await screen.findByText('minikube')).toBeInTheDocument();

    const loginBtn = screen.getByTitle('Log in to OpenShift or Kubernetes with token');
    expect(loginBtn).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(loginBtn);
    });

    expect(screen.getByText('OpenShift / Kubernetes Token Login')).toBeInTheDocument();

    // Paste an oc login command
    const pasteArea = screen.getByPlaceholderText(/oc login --token=/);
    await act(async () => {
      fireEvent.change(pasteArea, {
        target: { value: 'oc login --token=sha256~secret123 --server=https://api.mycluster.com:6443 --insecure-skip-tls-verify' },
      });
    });

    // Check that server and token fields auto-populated
    expect(screen.getByPlaceholderText('https://api.mycluster.example.com:6443')).toHaveValue('https://api.mycluster.com:6443');
    expect(screen.getByPlaceholderText('sha256~...')).toHaveValue('sha256~secret123');

    // Click submit
    const submitBtn = screen.getByRole('button', { name: /Log in & Connect/ });
    await act(async () => {
      fireEvent.click(submitBtn);
    });

    expect((window as any).multissh.k8sLogin).toHaveBeenCalledWith({
      server: 'https://api.mycluster.com:6443',
      token: 'sha256~secret123',
      namespace: undefined,
      insecureSkipTlsVerify: true,
    });
  });

  it('shows OpenShift / Kubernetes Login button when no contexts exist and enableOpenShift is true', async () => {
    (window as any).multissh.k8sListContexts.mockResolvedValueOnce([]);

    render(<K8sConnectionTree enableOpenShift={true} />);

    expect(await screen.findByText('No contexts found in ~/.kube/config')).toBeInTheDocument();
    const loginBtn = screen.getByRole('button', { name: /OpenShift \/ Kubernetes Login/ });
    expect(loginBtn).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(loginBtn);
    });

    expect(screen.getByText('OpenShift / Kubernetes Token Login')).toBeInTheDocument();
  });
});
