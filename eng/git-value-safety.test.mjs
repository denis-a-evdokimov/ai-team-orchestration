import assert from 'node:assert/strict';
import test from 'node:test';

import {
  expectedBaseRef,
  validateBaseRef,
  validateBranchName,
  validateCloneDestination,
  validateGitPlanCoordinates,
  validateRemoteName,
  validateRemoteUrl,
} from './git-value-safety.mjs';

const VALID_PLAN = {
  baseRef: 'refs/remotes/upstream/main',
  baseRemote: 'upstream',
  baseRemoteUrl: 'https://github.com/example/project.git',
  cloneDestination: 'project-dev',
  pushRemote: 'origin',
  pushRemoteUrl: 'git@github.com:contributor/project.git',
  targetBranch: 'main',
  workingBranch: 'feature/sprint-1',
};

test('safe Git plan coordinates accept normal and fork workflows', () => {
  assert.equal(validateGitPlanCoordinates(VALID_PLAN), true);
  assert.equal(validateGitPlanCoordinates({
    ...VALID_PLAN,
    baseRemote: 'origin',
    baseRemoteUrl: 'https://github.com/example/project.git',
    baseRef: 'refs/remotes/origin/main',
    pushRemoteUrl: 'https://github.com/example/project.git',
  }), true);
  assert.equal(expectedBaseRef('origin', 'release/2.0'), 'refs/remotes/origin/release/2.0');
  assert.equal(validateRemoteUrl('ssh://git@example.com:2222/org/repo.git'), 'ssh://git@example.com:2222/org/repo.git');
});

test('remote names reject shell syntax whitespace control characters and leading options', () => {
  for (const value of ['origin;evil', 'origin | evil', 'origin\nother', '-origin', '$(evil)', '`evil`']) {
    assert.throws(() => validateRemoteName(value), /whitespace|metacharacters|match/);
  }
});

test('branch names reject shell syntax and unsafe Git forms', () => {
  for (const value of ['feature/ok;evil', 'feature/has space', '-feature', 'feature//gap', 'feature/$(evil)', 'HEAD^{commit}']) {
    assert.throws(() => validateBranchName(value), /whitespace|metacharacters|slash-separated/);
  }
});

test('base ref must be the exact remote tracking ref', () => {
  assert.equal(validateBaseRef('refs/remotes/upstream/main', 'upstream', 'main'), 'refs/remotes/upstream/main');
  for (const value of ['upstream/main', 'refs/tags/main', 'HEAD', 'refs/remotes/upstream/main^{commit}']) {
    assert.throws(() => validateBaseRef(value, 'upstream', 'main'), /must be exactly|metacharacters/);
  }
});

test('remote URLs reject credentials queries fragments local paths and unsafe segments', () => {
  for (const value of [
    'https://user:pass@example.com/org/repo.git',
    'https://example.com/org/repo.git?token=x',
    'https://example.com/org/../repo.git',
    'C:/repo',
    '../repo',
    'file:///repo',
    'https://example.com/org/repo.git;evil',
  ]) {
    assert.throws(() => validateRemoteUrl(value), /whitespace|metacharacters|credential-free|credentials|query|unsafe/);
  }
});

test('clone destinations accept one portable new directory name', () => {
  for (const value of ['project-dev', 'qa_2', 'release.2', 'a'.repeat(64)]) {
    assert.equal(validateCloneDestination(value), value);
  }
  for (const value of [
    '../project',
    'nested/project',
    'project.',
    '-project',
    'project dev',
    'CON',
    'con.md',
    'Nul.txt',
    'COM1',
    'lpt9.log',
    'CLOCK$',
    'a'.repeat(65),
  ]) {
    assert.throws(
      () => validateCloneDestination(value),
      /whitespace|metacharacters|portable relative directory-name/,
    );
  }
});

test('different base and push URLs require different remote names', () => {
  assert.throws(
    () => validateGitPlanCoordinates({ ...VALID_PLAN, pushRemote: 'upstream' }),
    /Different base and push URLs require different remote names/,
  );
});

test('working branch must differ from target branch', () => {
  assert.throws(
    () => validateGitPlanCoordinates({ ...VALID_PLAN, workingBranch: 'main' }),
    /must differ/,
  );
});
