/**
 * Optional signal on a write stream: `targetTouched` is false until the provider has actually opened (and so
 * truncated) or replaced the target. `TransferPipeline` uses it to decide whether a failed transfer may delete
 * the target: a stream that never touched it must leave an existing file alone (a cancelled S3 overwrite, a
 * read-only local file that could not be opened, an SFTP file whose lazy open never happened).
 */
export interface TargetTouchedSignal {
  readonly targetTouched: boolean;
}

/** Streams without the signal count as touched, which keeps the earlier "clean up the partial file" behaviour. */
export function wasTargetTouched(stream: unknown): boolean {
  const flag = (stream as Partial<TargetTouchedSignal> | null | undefined)?.targetTouched;
  return typeof flag === 'boolean' ? flag : true;
}

/** Adds the `targetTouched` getter to a stream object that is not one of our own classes. */
export function defineTargetTouched<T extends object>(stream: T, isTouched: () => boolean): T & TargetTouchedSignal {
  Object.defineProperty(stream, 'targetTouched', { get: isTouched, configurable: true });
  return stream as T & TargetTouchedSignal;
}
