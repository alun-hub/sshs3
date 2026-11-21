import { beforeEach } from 'vitest';
import { configureResolvedHostNameForTests } from '../../src/main/ssh/resolvedHostName';

/**
 * `buildSSHArguments` resolves the host name of a proxied or jump-host profile with `ssh -G`, which reads the developer's
 * own ~/.ssh/config and runs its `Match exec` commands. No test may depend on that: every test starts with a runner that
 * fails, which makes the resolver fall back to the profile's own host. Tests of the resolver install their own runner.
 */
beforeEach(() => {
  configureResolvedHostNameForTests({
    runner: () => {
      throw new Error('ssh -G is not run in unit tests');
    },
  });
});
