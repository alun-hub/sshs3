import type { SSHConnectionConfig } from '@shared/types/ssh';
import type { S3Config } from '@shared/types/storage';

export type Tab = 'ssh' | 's3' | 'k8s';

/** The profile being created or edited in the form shown inside the manager. */
export type EditingState = { type: Tab; config?: SSHConnectionConfig | S3Config };
