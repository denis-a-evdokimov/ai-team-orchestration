import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

function runGit(cwd, args, env = process.env) {
  return spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    env,
  });
}

function requireGit(cwd, args, env = process.env) {
  const result = runGit(cwd, args, env);
  assert.equal(
    result.status,
    0,
    `git ${args.join(' ')} failed:\n${result.stdout}\n${result.stderr}`,
  );
  return result;
}

function installHook(hooksDirectory, name, markerPath) {
  mkdirSync(hooksDirectory, { recursive: true });
  const hookPath = path.join(hooksDirectory, name);
  const portableMarker = markerPath.replaceAll('\\', '/').replaceAll("'", "'\"'\"'");
  writeFileSync(hookPath, `#!/bin/sh\nprintf touched > '${portableMarker}'\n`, 'utf8');
  chmodSync(hookPath, 0o755);
}

function createCommittedRepository(repositoryPath) {
  requireGit(path.dirname(repositoryPath), ['init', '--initial-branch=main', repositoryPath]);
  requireGit(repositoryPath, ['config', 'user.name', 'Safe Git Test']);
  requireGit(repositoryPath, ['config', 'user.email', 'safe-git@example.invalid']);
  writeFileSync(path.join(repositoryPath, 'tracked.txt'), 'initial\n', 'utf8');
  requireGit(repositoryPath, ['add', 'tracked.txt']);
  requireGit(repositoryPath, ['commit', '-m', 'initial']);
}

test('fixed Safe Git commands resist configuration-driven scope expansion', (context) => {
  const root = mkdtempSync(path.join(tmpdir(), 'ai-team-safe-git-'));
  context.after(() => rmSync(root, { force: true, recursive: true }));

  const seed = path.join(root, 'seed');
  const remote = path.join(root, 'remote.git');
  const clone = path.join(root, 'clone');
  createCommittedRepository(seed);
  writeFileSync(path.join(seed, '.gitattributes'), '*.txt filter=unexpected\n', 'utf8');
  requireGit(seed, ['add', '.gitattributes']);
  requireGit(seed, ['commit', '-m', 'add filter attribute']);
  requireGit(root, ['init', '--bare', '--initial-branch=main', remote]);
  requireGit(seed, ['remote', 'add', 'publish', remote]);
  requireGit(seed, ['push', 'publish', 'main']);

  const globalConfig = path.join(root, 'global.gitconfig');
  const globalHooks = path.join(root, 'global-hooks');
  const cloneHookMarker = path.join(root, 'clone-hook-ran');
  const filterMarker = path.join(root, 'filter-ran');
  installHook(globalHooks, 'post-checkout', cloneHookMarker);
  installHook(root, 'filter-command', filterMarker);
  const isolatedEnvironment = {
    ...process.env,
    GIT_CONFIG_GLOBAL: globalConfig,
  };
  requireGit(root, ['config', '--global', 'core.hooksPath', globalHooks], isolatedEnvironment);
  requireGit(
    root,
    [
      'config',
      '--global',
      'filter.unexpected.smudge',
      path.join(root, 'filter-command').replaceAll('\\', '/'),
    ],
    isolatedEnvironment,
  );
  requireGit(root, ['config', '--global', 'filter.unexpected.required', 'true'], isolatedEnvironment);
  requireGit(
    root,
    ['config', '--global', 'remote.upstream.url', 'https://example.invalid/unexpected.git'],
    isolatedEnvironment,
  );
  const collision = runGit(
    root,
    ['config', '--get-regexp', 'remote.upstream'],
    isolatedEnvironment,
  );
  assert.equal(collision.status, 0);
  assert.notEqual(collision.stdout, '');
  requireGit(
    root,
    ['config', '--global', '--unset-all', 'remote.upstream.url'],
    isolatedEnvironment,
  );
  const conditionalConfig = path.join(root, 'conditional.gitconfig');
  const cloneGitDirectory = path.join(clone, '.git').replaceAll('\\', '/');
  writeFileSync(
    conditionalConfig,
    `[core]\n\tfsmonitor = ${path.join(root, 'filter-command').replaceAll('\\', '/')}\n`,
    'utf8',
  );
  writeFileSync(
    globalConfig,
    `\n[includeIf "gitdir/i:${cloneGitDirectory}"]\n\tpath = ${conditionalConfig.replaceAll('\\', '/')}\n`,
    { encoding: 'utf8', flag: 'a' },
  );

  requireGit(root, [
    '-c',
    'core.hooksPath=.git/disabled-hooks',
    '-c',
    'fetch.bundleURI=',
    '-c',
    'remote.upstream.serverOption=',
    'clone',
    '--template=',
    '--no-checkout',
    '--no-tags',
    '--no-recurse-submodules',
    '--single-branch',
    '--branch',
    'main',
    '--origin',
    'upstream',
    '--upload-pack=git-upload-pack',
    '--',
    remote,
    clone,
  ], isolatedEnvironment);
  assert.equal(existsSync(cloneHookMarker), false);
  assert.equal(existsSync(filterMarker), false);
  const conditionalFsmonitor = runGit(
    clone,
    ['config', '--get-all', 'core.fsmonitor'],
    isolatedEnvironment,
  );
  assert.equal(conditionalFsmonitor.status, 0);
  assert.notEqual(conditionalFsmonitor.stdout, '');
  writeFileSync(conditionalConfig, '', 'utf8');
  assert.equal(
    runGit(clone, ['config', '--get-all', 'core.fsmonitor'], isolatedEnvironment).status,
    1,
  );

  const privateAttributes = path.join(clone, '.git', 'info', 'attributes');
  mkdirSync(path.dirname(privateAttributes), { recursive: true });
  writeFileSync(
    privateAttributes,
    '* -text -filter -diff -ident -working-tree-encoding\n',
    'utf8',
  );
  requireGit(clone, [
    '-c',
    'core.hooksPath=.git/disabled-hooks',
    '-c',
    'core.sparseCheckout=false',
    '-c',
    'core.sparseCheckoutCone=false',
    'checkout',
    '--force',
    'main',
  ], isolatedEnvironment);
  assert.equal(existsSync(cloneHookMarker), false);
  assert.equal(existsSync(filterMarker), false);

  const refs = requireGit(clone, ['show-ref']).stdout.trim().split(/\r?\n/);
  assert.equal(refs.length, 2);
  const refEntries = new Map(refs.map((line) => line.split(' ')).map(([oid, ref]) => [ref, oid]));
  assert.equal(refEntries.get('refs/heads/main'), refEntries.get('refs/remotes/upstream/main'));

  const fsmonitorMarker = path.join(root, 'fsmonitor-ran');
  installHook(root, 'fsmonitor-hook', fsmonitorMarker);
  const fsmonitorHook = path.join(root, 'fsmonitor-hook').replaceAll('\\', '/');
  requireGit(clone, ['config', 'core.fsmonitorHookVersion', '2']);
  requireGit(clone, ['config', 'core.fsmonitor', fsmonitorHook]);
  requireGit(clone, ['update-index', '--fsmonitor']);
  rmSync(fsmonitorMarker, { force: true });
  requireGit(clone, ['status', '--porcelain=v1']);
  assert.equal(existsSync(fsmonitorMarker), true);
  assert.notEqual(requireGit(clone, ['config', '--get-all', 'core.fsmonitor']).stdout, '');
  requireGit(clone, ['config', '--unset-all', 'core.fsmonitor']);
  requireGit(clone, ['config', '--unset-all', 'core.fsmonitorHookVersion']);
  requireGit(clone, ['update-index', '--no-fsmonitor']);

  requireGit(clone, ['update-index', '--assume-unchanged', 'tracked.txt']);
  assert.match(requireGit(clone, ['ls-files', '-v']).stdout, /^[a-z] tracked\.txt$/m);
  requireGit(clone, ['update-index', '--no-assume-unchanged', 'tracked.txt']);
  requireGit(clone, ['update-index', '--skip-worktree', 'tracked.txt']);
  assert.match(requireGit(clone, ['ls-files', '-v']).stdout, /^S tracked\.txt$/m);
  requireGit(clone, ['update-index', '--no-skip-worktree', 'tracked.txt']);
  for (const line of requireGit(clone, ['ls-files', '-v']).stdout.trim().split(/\r?\n/)) {
    assert.match(line, /^H /);
  }

  requireGit(clone, ['config', 'status.showUntrackedFiles', 'no']);
  writeFileSync(path.join(clone, 'untracked.txt'), 'untracked\n', 'utf8');
  const ordinaryStatus = requireGit(clone, ['status', '--porcelain=v1']).stdout;
  assert.equal(ordinaryStatus, '');
  const fixedStatus = requireGit(clone, [
    '-c',
    'core.ignoreStat=false',
    'status',
    '--porcelain=v1',
    '--untracked-files=all',
    '--ignore-submodules=none',
  ]).stdout;
  assert.match(fixedStatus, /\?\? untracked\.txt/);
  rmSync(path.join(clone, 'untracked.txt'));

  const submoduleSeed = path.join(root, 'submodule-seed');
  const submoduleRemote = path.join(root, 'submodule.git');
  createCommittedRepository(submoduleSeed);
  requireGit(root, ['init', '--bare', '--initial-branch=main', submoduleRemote]);
  requireGit(submoduleSeed, ['remote', 'add', 'publish', submoduleRemote]);
  requireGit(submoduleSeed, ['push', 'publish', 'main']);
  requireGit(clone, [
    '-c',
    'protocol.file.allow=always',
    'submodule',
    'add',
    '--',
    submoduleRemote,
    'submodule',
  ]);
  requireGit(clone, ['add', '.gitmodules', 'submodule']);
  requireGit(clone, ['config', 'user.name', 'Safe Git Test']);
  requireGit(clone, ['config', 'user.email', 'safe-git@example.invalid']);
  requireGit(clone, ['commit', '-m', 'add submodule']);
  requireGit(clone, ['config', 'diff.ignoreSubmodules', 'all']);
  requireGit(clone, ['config', 'submodule.submodule.ignore', 'all']);
  writeFileSync(path.join(clone, 'submodule', 'tracked.txt'), 'modified\n', 'utf8');
  assert.equal(requireGit(clone, ['status', '--porcelain=v1']).stdout, '');
  const submoduleStatus = requireGit(clone, [
    '-c',
    'core.ignoreStat=false',
    'status',
    '--porcelain=v1',
    '--untracked-files=all',
    '--ignore-submodules=none',
  ]).stdout;
  assert.match(submoduleStatus, /[Mm] submodule/);
  writeFileSync(path.join(clone, 'submodule', 'tracked.txt'), 'initial\n', 'utf8');

  writeFileSync(path.join(seed, 'tracked.txt'), 'updated\n', 'utf8');
  requireGit(seed, ['add', 'tracked.txt']);
  requireGit(seed, ['commit', '-m', 'update']);
  requireGit(seed, ['push', 'publish', 'main']);
  requireGit(clone, ['config', 'remote.upstream.fetch', '+refs/heads/*:refs/expanded/*']);
  requireGit(clone, ['config', 'fetch.prune', 'true']);
  requireGit(clone, ['config', 'fetch.pruneTags', 'true']);
  requireGit(clone, ['config', 'fetch.bundleURI', 'https://127.0.0.1:1/unexpected']);
  requireGit(clone, ['update-ref', 'refs/keep/local', 'refs/heads/main']);
  requireGit(clone, ['tag', 'keep-local-tag']);
  const fetchHookMarker = path.join(root, 'fetch-hook-ran');
  installHook(path.join(clone, '.git', 'hooks'), 'reference-transaction', fetchHookMarker);

  const fetchResult = requireGit(clone, [
    '-c',
    'core.hooksPath=.git/disabled-hooks',
    '-c',
    'fetch.bundleURI=',
    '-c',
    'fetch.prune=false',
    '-c',
    'fetch.pruneTags=false',
    '-c',
    'fetch.recurseSubmodules=false',
    '-c',
    'fetch.writeCommitGraph=false',
    '-c',
    'gc.auto=0',
    '-c',
    'maintenance.auto=false',
    '-c',
    'remote.upstream.prune=false',
    '-c',
    'remote.upstream.pruneTags=false',
    '-c',
    'remote.upstream.serverOption=',
    'fetch',
    '--refmap=',
    '--no-tags',
    '--no-recurse-submodules',
    '--upload-pack=git-upload-pack',
    'upstream',
    '+refs/heads/main:refs/remotes/upstream/main',
  ]);
  assert.doesNotMatch(fetchResult.stderr, /bundle|127\.0\.0\.1/);
  assert.equal(existsSync(fetchHookMarker), false);
  assert.equal(requireGit(clone, ['for-each-ref', '--format=%(refname)', 'refs/expanded']).stdout, '');
  requireGit(clone, ['show-ref', '--verify', '--', 'refs/keep/local']);
  requireGit(clone, ['show-ref', '--verify', '--', 'refs/tags/keep-local-tag']);

  requireGit(remote, ['--git-dir=.', 'config', 'receive.advertisePushOptions', 'true']);
  rmSync(cloneHookMarker, { force: true });
  requireGit(clone, [
    '-c',
    'core.hooksPath=.git/disabled-hooks',
    'switch',
    '--create',
    'feature/safe',
  ], isolatedEnvironment);
  assert.equal(existsSync(cloneHookMarker), false);
  writeFileSync(path.join(clone, 'feature.txt'), 'feature\n', 'utf8');
  requireGit(clone, ['add', 'feature.txt']);
  requireGit(clone, ['config', 'user.name', 'Safe Git Test']);
  requireGit(clone, ['config', 'user.email', 'safe-git@example.invalid']);
  requireGit(clone, ['commit', '-m', 'feature']);
  requireGit(clone, ['tag', '--annotate', 'unexpected-tag', '--message', 'unexpected']);
  requireGit(clone, ['config', 'remote.upstream.mirror', 'true']);
  requireGit(clone, ['config', '--add', 'remote.upstream.push', 'refs/tags/*:refs/tags/*']);
  requireGit(clone, ['config', 'push.followTags', 'true']);
  requireGit(clone, ['config', 'push.pushOption', 'unexpected-option']);
  requireGit(clone, ['config', 'push.recurseSubmodules', 'on-demand']);
  const pushHookMarker = path.join(root, 'push-hook-ran');
  installHook(path.join(clone, '.git', 'hooks'), 'pre-push', pushHookMarker);

  requireGit(clone, [
    '-c',
    'core.hooksPath=.git/disabled-hooks',
    '-c',
    'push.followTags=false',
    '-c',
    'push.gpgSign=false',
    '-c',
    'push.negotiate=false',
    '-c',
    'push.pushOption=',
    '-c',
    'push.recurseSubmodules=no',
    '-c',
    'remote.upstream.mirror=false',
    'push',
    '--no-follow-tags',
    '--no-signed',
    '--no-verify',
    '--recurse-submodules=no',
    '--receive-pack=git-receive-pack',
    '--set-upstream',
    'upstream',
    'refs/heads/feature/safe:refs/heads/feature/safe',
  ]);
  assert.equal(existsSync(pushHookMarker), false);
  requireGit(remote, ['--git-dir=.', 'show-ref', '--verify', '--', 'refs/heads/feature/safe']);
  assert.equal(
    runGit(remote, ['--git-dir=.', 'show-ref', '--verify', '--quiet', 'refs/tags/unexpected-tag']).status,
    1,
  );
});
