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
});
