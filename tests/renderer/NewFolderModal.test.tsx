// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { NewFolderModal } from '../../src/renderer/src/components/FileManager/NewFolderModal';

describe('NewFolderModal Component', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders nothing when open is false', () => {
    const { container } = render(
      <NewFolderModal
        open={false}
        currentPath="/home/user"
        sourceType="local"
        onClose={vi.fn()}
        onCreate={vi.fn()}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders modal with folder name input when open is true', () => {
    render(
      <NewFolderModal
        open={true}
        currentPath="/home/user"
        sourceType="local"
        onClose={vi.fn()}
        onCreate={vi.fn()}
      />
    );

    expect(screen.getByText('Create New Folder')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('New folder name')).toBeInTheDocument();
    expect(screen.getByText('Create')).toBeInTheDocument();
    expect(screen.getByText('Cancel')).toBeInTheDocument();
  });

  it('renders bucket-specific title and placeholder for S3 root', () => {
    render(
      <NewFolderModal
        open={true}
        currentPath="/"
        sourceType="s3"
        onClose={vi.fn()}
        onCreate={vi.fn()}
      />
    );

    expect(screen.getByText('Create S3 Bucket')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('my-new-bucket')).toBeInTheDocument();
  });

  it('submits trimmed folder name and closes modal', async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();

    render(
      <NewFolderModal
        open={true}
        currentPath="/var/log"
        sourceType="sftp"
        onClose={onClose}
        onCreate={onCreate}
      />
    );

    const input = screen.getByPlaceholderText('New folder name');
    fireEvent.change(input, { target: { value: '  new-directory  ' } });
    fireEvent.click(screen.getByText('Create'));

    await waitFor(() => {
      expect(onCreate).toHaveBeenCalledWith('new-directory');
      expect(onClose).toHaveBeenCalled();
    });
  });

  it('shows error if S3 bucket name is invalid', async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();

    render(
      <NewFolderModal
        open={true}
        currentPath="/"
        sourceType="s3"
        onClose={onClose}
        onCreate={onCreate}
      />
    );

    const input = screen.getByPlaceholderText('my-new-bucket');
    fireEvent.change(input, { target: { value: 'INVALID_UPPERCASE' } });
    fireEvent.click(screen.getByText('Create'));

    expect(await screen.findByText(/Bucket names must be/i)).toBeInTheDocument();
    expect(onCreate).not.toHaveBeenCalled();
  });

  it('calls onClose when cancel is clicked', () => {
    const onClose = vi.fn();
    render(
      <NewFolderModal
        open={true}
        currentPath="/home"
        sourceType="local"
        onClose={onClose}
        onCreate={vi.fn()}
      />
    );

    fireEvent.click(screen.getByText('Cancel'));
    expect(onClose).toHaveBeenCalled();
  });
});
