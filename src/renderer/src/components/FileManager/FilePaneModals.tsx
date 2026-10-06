import React from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { FileEntry } from '@shared/types/storage';
import { parentPath } from '../../lib/format';
import { ChmodModal } from './ChmodModal';
import { PropertiesModal } from './PropertiesModal';
import { TagsModal } from './TagsModal';
import { BucketPolicyModal } from './BucketPolicyModal';
import { VersionsModal } from './VersionsModal';
import { PresignedUrlModal } from './PresignedUrlModal';
import { NewFolderModal } from './NewFolderModal';
import { AddToDotfilePoolModal } from './AddToDotfilePoolModal';
import { FileEditorModal } from './FileEditorModal';
import { DirectorySyncModal, type DirectorySyncModalSource } from './DirectorySyncModal';
import { SearchModal } from './SearchModal';
import { GitCloneModal } from './GitCloneModal';
import type { PaneSource } from './types';

type SetFlag = Dispatch<SetStateAction<boolean>>;

export interface FilePaneModalsProps {
  source: PaneSource;
  currentPath: string;
  selectedEntries: FileEntry[];
  isBucketEntry: boolean;
  isS3ObjectEntry: boolean;
  selectedAreAllFiles: boolean;
  otherPane?: DirectorySyncModalSource;
  chmodOpen: boolean;
  setChmodOpen: SetFlag;
  propertiesOpen: boolean;
  setPropertiesOpen: SetFlag;
  tagsOpen: boolean;
  setTagsOpen: SetFlag;
  bucketPolicyOpen: boolean;
  setBucketPolicyOpen: SetFlag;
  versionsOpen: boolean;
  setVersionsOpen: SetFlag;
  presignedOpen: boolean;
  setPresignedOpen: SetFlag;
  editorEntry: FileEntry | null;
  editorTailMode: boolean;
  onCloseEditor: () => void;
  newFolderOpen: boolean;
  setNewFolderOpen: SetFlag;
  handleCreateFolderCommit: (name: string) => Promise<void>;
  addToDotfilesOpen: boolean;
  setAddToDotfilesOpen: SetFlag;
  setDotfilesFeedback: Dispatch<SetStateAction<string | null>>;
  syncModalOpen: boolean;
  setSyncModalOpen: SetFlag;
  searchOpen: boolean;
  setSearchOpen: SetFlag;
  gitCloneOpen: boolean;
  setGitCloneOpen: SetFlag;
  gitCloneTargetDir: string | null;
  setGitCloneTargetDir: Dispatch<SetStateAction<string | null>>;
  load: (force?: boolean) => Promise<void> | void;
  onPathChange: (path: string) => void;
}

/** Every modal a file pane can open (chmod, properties, S3 tags/policy/versions, editor, sync, search, git clone, …). */
export const FilePaneModals: React.FC<FilePaneModalsProps> = ({
  source,
  currentPath,
  selectedEntries,
  isBucketEntry,
  isS3ObjectEntry,
  selectedAreAllFiles,
  otherPane,
  chmodOpen,
  setChmodOpen,
  propertiesOpen,
  setPropertiesOpen,
  tagsOpen,
  setTagsOpen,
  bucketPolicyOpen,
  setBucketPolicyOpen,
  versionsOpen,
  setVersionsOpen,
  presignedOpen,
  setPresignedOpen,
  editorEntry,
  editorTailMode,
  onCloseEditor,
  newFolderOpen,
  setNewFolderOpen,
  handleCreateFolderCommit,
  addToDotfilesOpen,
  setAddToDotfilesOpen,
  setDotfilesFeedback,
  syncModalOpen,
  setSyncModalOpen,
  searchOpen,
  setSearchOpen,
  gitCloneOpen,
  setGitCloneOpen,
  gitCloneTargetDir,
  setGitCloneTargetDir,
  load,
  onPathChange,
}) => (
  <>
    <ChmodModal
      open={chmodOpen}
      providerId={source.providerId}
      entries={selectedEntries}
      onClose={() => setChmodOpen(false)}
      onSaved={() => void load()}
    />

    <PropertiesModal
      open={propertiesOpen}
      providerId={source.providerId}
      sourceType={source.sourceType}
      entries={selectedEntries}
      onClose={() => setPropertiesOpen(false)}
      onSaved={() => void load()}
    />

    {(isBucketEntry || isS3ObjectEntry) && selectedEntries.length === 1 && (
      <TagsModal
        open={tagsOpen}
        providerId={source.providerId}
        targetPath={selectedEntries[0].path}
        targetName={selectedEntries[0].name}
        onClose={() => setTagsOpen(false)}
      />
    )}

    {isBucketEntry && selectedEntries.length === 1 && (
      <BucketPolicyModal
        open={bucketPolicyOpen}
        providerId={source.providerId}
        bucketPath={selectedEntries[0].path}
        bucketName={selectedEntries[0].name}
        onClose={() => setBucketPolicyOpen(false)}
      />
    )}

    {(isBucketEntry || isS3ObjectEntry) && selectedEntries.length === 1 && (
      <VersionsModal
        open={versionsOpen}
        providerId={source.providerId}
        mode={isBucketEntry ? 'bucket' : 'object'}
        targetPath={selectedEntries[0].path}
        targetName={selectedEntries[0].name}
        onClose={() => setVersionsOpen(false)}
        onSaved={() => void load()}
      />
    )}

    {presignedOpen && selectedAreAllFiles && (
      <PresignedUrlModal
        open={presignedOpen}
        providerId={source.providerId}
        entries={selectedEntries.map((e) => ({ path: e.path, name: e.name }))}
        onClose={() => setPresignedOpen(false)}
      />
    )}

    <FileEditorModal
      open={editorEntry !== null}
      providerId={source.providerId}
      sourceType={source.sourceType}
      entry={editorEntry}
      isTailMode={editorTailMode}
      onClose={onCloseEditor}
      onSaved={() => void load()}
    />

    <NewFolderModal
      open={newFolderOpen}
      currentPath={currentPath}
      sourceType={source.sourceType}
      onClose={() => setNewFolderOpen(false)}
      onCreate={handleCreateFolderCommit}
    />

    <AddToDotfilePoolModal
      open={addToDotfilesOpen}
      sourceProviderId={source.providerId}
      entry={selectedEntries[0] || null}
      onClose={() => setAddToDotfilesOpen(false)}
      onSuccess={(msg) => {
        setDotfilesFeedback(msg);
        setTimeout(() => setDotfilesFeedback(null), 4000);
      }}
    />

    <DirectorySyncModal
      open={syncModalOpen}
      onClose={() => setSyncModalOpen(false)}
      initialSource={
        selectedEntries.length === 1 && selectedEntries[0].isDirectory
          ? {
              providerId: source.providerId,
              sourceType: source.sourceType,
              label: source.label,
              path: selectedEntries[0].path,
            }
          : null
      }
      otherPane={otherPane ?? null}
    />

    {source.sourceType !== 'k8s' && (
      <SearchModal
        open={searchOpen}
        providerId={source.providerId}
        sourceType={source.sourceType}
        rootPath={currentPath}
        onClose={() => setSearchOpen(false)}
        onJumpToFile={(path) => onPathChange(parentPath(path))}
      />
    )}

    {gitCloneOpen && (
      <GitCloneModal
        targetPath={gitCloneTargetDir || currentPath}
        providerId={source.providerId}
        onClose={() => {
          setGitCloneOpen(false);
          setGitCloneTargetDir(null);
        }}
        onCloned={() => void load(true)}
      />
    )}
  </>
);
