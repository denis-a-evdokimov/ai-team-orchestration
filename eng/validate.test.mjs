import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VALIDATOR_PATH = path.join(REPO_ROOT, 'eng', 'validate.mjs');

function createRepositoryCopy(context) {
  const targetRoot = mkdtempSync(path.join(tmpdir(), 'ai-team-validate-'));
  cpSync(REPO_ROOT, targetRoot, {
    filter: (sourcePath) => path.basename(sourcePath) !== '.git',
    recursive: true,
  });
  context.after(() => rmSync(targetRoot, { force: true, recursive: true }));
  return targetRoot;
}

function runValidator(targetRoot) {
  return spawnSync(process.execPath, [VALIDATOR_PATH], {
    encoding: 'utf8',
    env: {
      ...process.env,
      AI_TEAM_VALIDATE_ROOT: targetRoot,
    },
  });
}

function mutateText(filePath, oldText, newText) {
  const contents = readFileSync(filePath, 'utf8');
  assert.ok(contents.includes(oldText), `Fixture text not found in ${filePath}: ${oldText}`);
  writeFileSync(filePath, contents.replace(oldText, newText), 'utf8');
}

function replaceFrontmatterField(filePath, field, value) {
  const contents = readFileSync(filePath, 'utf8');
  const pattern = new RegExp(`^${field}:.*$`, 'm');
  assert.match(contents, pattern);
  writeFileSync(filePath, contents.replace(pattern, `${field}: '${value}'`), 'utf8');
}

test('validation root override accepts an unmodified temporary repository copy', (context) => {
  const targetRoot = createRepositoryCopy(context);
  const result = runValidator(targetRoot);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Validation passed/);
});

test('validator rejects an unterminated quoted agent description', (context) => {
  const targetRoot = createRepositoryCopy(context);
  const agentPath = path.join(targetRoot, 'agents', 'ai-team-dev.agent.md');
  const contents = readFileSync(agentPath, 'utf8');
  const descriptionLine = contents.split(/\r?\n/).find((line) => line.startsWith('description:'));
  assert.ok(descriptionLine.endsWith("'"));
  writeFileSync(agentPath, contents.replace(descriptionLine, descriptionLine.slice(0, -1)), 'utf8');

  const result = runValidator(targetRoot);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /description must be properly matching-quoted/);
});

test('validator rejects an unterminated quoted skill description', (context) => {
  const targetRoot = createRepositoryCopy(context);
  const skillPath = path.join(targetRoot, 'skills', 'ai-team', 'SKILL.md');
  const contents = readFileSync(skillPath, 'utf8');
  const descriptionLine = contents.split(/\r?\n/).find((line) => line.startsWith('description:'));
  assert.ok(descriptionLine.endsWith("'"));
  writeFileSync(skillPath, contents.replace(descriptionLine, descriptionLine.slice(0, -1)), 'utf8');

  const result = runValidator(targetRoot);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /description must be properly matching-quoted/);
});

test('validator accepts 1024-character agent and skill descriptions', (context) => {
  const targetRoot = createRepositoryCopy(context);
  replaceFrontmatterField(
    path.join(targetRoot, 'agents', 'ai-team-dev.agent.md'),
    'description',
    'a'.repeat(1024),
  );
  replaceFrontmatterField(
    path.join(targetRoot, 'skills', 'ai-team', 'SKILL.md'),
    'description',
    's'.repeat(1024),
  );

  const result = runValidator(targetRoot);
  assert.equal(result.status, 0, result.stderr);
});

test('validator rejects 1025-character agent and skill descriptions', (context) => {
  for (const relativePath of [
    ['agents', 'ai-team-dev.agent.md'],
    ['skills', 'ai-team', 'SKILL.md'],
  ]) {
    const targetRoot = createRepositoryCopy(context);
    replaceFrontmatterField(path.join(targetRoot, ...relativePath), 'description', 'x'.repeat(1025));
    const result = runValidator(targetRoot);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /description must be between .*1024 characters/);
  }
});

test('validator rejects a 9-character skill description', (context) => {
  const targetRoot = createRepositoryCopy(context);
  replaceFrontmatterField(
    path.join(targetRoot, 'skills', 'ai-team', 'SKILL.md'),
    'description',
    '123456789',
  );
  const result = runValidator(targetRoot);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /description must be between 10 and 1024 characters/);
});

test('validator rejects invalid and overlong skill slugs', (context) => {
  for (const invalidName of ['Invalid Skill', 'a'.repeat(65)]) {
    const targetRoot = createRepositoryCopy(context);
    const oldDirectory = path.join(targetRoot, 'skills', 'ai-team');
    const newDirectory = path.join(targetRoot, 'skills', invalidName);
    renameSync(oldDirectory, newDirectory);
    replaceFrontmatterField(path.join(newDirectory, 'SKILL.md'), 'name', invalidName);
    const result = runValidator(targetRoot);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /folder name must be a lowercase slug between 1 and 64 characters/);
  }
});

test('validator rejects an agent name over 50 characters', (context) => {
  const targetRoot = createRepositoryCopy(context);
  replaceFrontmatterField(
    path.join(targetRoot, 'agents', 'ai-team-dev.agent.md'),
    'name',
    'a'.repeat(51),
  );
  const result = runValidator(targetRoot);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /name must be a lowercase slug between 1 and 50 characters/);
});

test('validator rejects skill files larger than 5 MiB', (context) => {
  const targetRoot = createRepositoryCopy(context);
  const assetPath = path.join(targetRoot, 'skills', 'ai-team', 'references', 'oversized.asset');
  writeFileSync(assetPath, Buffer.alloc((5 * 1024 * 1024) + 1));
  const result = runValidator(targetRoot);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /exceeds the 5242880-byte skill file limit/);
});

test('validator rejects symlinks in a skill tree', (context) => {
  const targetRoot = createRepositoryCopy(context);
  const externalRoot = mkdtempSync(path.join(tmpdir(), 'ai-team-validate-link-'));
  context.after(() => rmSync(externalRoot, { force: true, recursive: true }));
  writeFileSync(path.join(externalRoot, 'sentinel.txt'), 'sentinel\n');
  const linkPath = path.join(targetRoot, 'skills', 'ai-team', 'references', 'linked-directory');
  try {
    symlinkSync(externalRoot, linkPath, process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    context.skip(`Directory links are unavailable: ${error.message}`);
    return;
  }
  const result = runValidator(targetRoot);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /must not be a symbolic link, junction, or reparse point/);
});

test('validator accepts omitted tools and inherits the runtime tool set', (context) => {
  const targetRoot = createRepositoryCopy(context);
  for (const agentId of ['ai-team-dev', 'ai-team-producer', 'ai-team-qa']) {
    const agentContents = readFileSync(
      path.join(targetRoot, 'agents', `${agentId}.agent.md`),
      'utf8',
    );
    assert.doesNotMatch(agentContents, /^tools:/m);
  }

  const result = runValidator(targetRoot);
  assert.equal(result.status, 0, result.stderr);
});

test('validator accepts an empty tools array and concrete runtime tool names', (context) => {
  const targetRoot = createRepositoryCopy(context);
  const devPath = path.join(targetRoot, 'agents', 'ai-team-dev.agent.md');
  const qaPath = path.join(targetRoot, 'agents', 'ai-team-qa.agent.md');
  mutateText(devPath, "description: '", "tools: []\ndescription: '");
  mutateText(
    qaPath,
    "description: '",
    "tools: ['*', 'github/*', 'example-extension/specific-tool']\ndescription: '",
  );

  const result = runValidator(targetRoot);
  assert.equal(result.status, 0, result.stderr);
});

test('validator rejects malformed or unquoted tools entries when tools is present', (context) => {
  const targetRoot = createRepositoryCopy(context);
  const agentPath = path.join(targetRoot, 'agents', 'ai-team-dev.agent.md');
  mutateText(
    agentPath,
    "description: '",
    "tools: ['read', github/*]\ndescription: '",
  );

  const result = runValidator(targetRoot);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /tools must contain only non-empty quoted strings/);
});

test('validator rejects a 501-character plugin description', (context) => {
  const targetRoot = createRepositoryCopy(context);
  const pluginPath = path.join(targetRoot, 'plugin.json');
  const plugin = JSON.parse(readFileSync(pluginPath, 'utf8'));
  plugin.description = 'x'.repeat(501);
  writeFileSync(pluginPath, `${JSON.stringify(plugin, null, 2)}\n`, 'utf8');

  const result = runValidator(targetRoot);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /description.*between 1 and 500 characters/);
});

test('validator rejects an invalid plugin keyword', (context) => {
  const targetRoot = createRepositoryCopy(context);
  const pluginPath = path.join(targetRoot, 'plugin.json');
  const plugin = JSON.parse(readFileSync(pluginPath, 'utf8'));
  plugin.keywords[0] = 'Invalid Keyword';
  writeFileSync(pluginPath, `${JSON.stringify(plugin, null, 2)}\n`, 'utf8');

  const result = runValidator(targetRoot);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /keywords.*lowercase slugs/);
});

test('validator rejects removal of a canonical SHA evidence contract', (context) => {
  const targetRoot = createRepositoryCopy(context);
  const workflowPath = path.join(
    targetRoot,
    'skills',
    'ai-team',
    'references',
    'delivery-workflow.md',
  );
  mutateText(
    workflowPath,
    'Every PR-head change invalidates both SHA-bound gates.',
    'Review evidence is usually refreshed after a change.',
  );

  const result = runValidator(targetRoot);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /must contain canonical contract/);
});

test('validator rejects a hardcoded application base in sprint instructions', (context) => {
  const targetRoot = createRepositoryCopy(context);
  const sprintPath = path.join(
    targetRoot,
    'skills',
    'ai-team',
    'references',
    'sprint-plan-template.md',
  );
  mutateText(
    sprintPath,
    '> Base ref: `<base-ref>`',
    '> Base ref: `origin/main`',
  );

  const result = runValidator(targetRoot);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /branch placeholder "<base-ref>"|hardcoded application branch default "origin\/main"/);
});

test('validator rejects branch commands that ignore the sprint plan values', (context) => {
  const targetRoot = createRepositoryCopy(context);
  const sprintPath = path.join(
    targetRoot,
    'skills',
    'ai-team',
    'references',
    'sprint-plan-template.md',
  );
  mutateText(
    sprintPath,
    'git switch --no-track --create <working-branch> <base-ref>',
    'git switch --no-track --create feature/sprint-N origin/develop',
  );

  const result = runValidator(targetRoot);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /parameterized command/);
});

test('validator rejects a Dev agent that substitutes a default branch', (context) => {
  const targetRoot = createRepositoryCopy(context);
  const devPath = path.join(targetRoot, 'agents', 'ai-team-dev.agent.md');
  mutateText(
    devPath,
    'Never substitute a default branch for the plan\'s base.',
    'Use origin/main when the plan is unclear.',
  );

  const result = runValidator(targetRoot);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /parameterized branch contract term|hardcoded application branch default/);
});

test('validator rejects unsafe tracking of upstream main in contributor instructions', (context) => {
  const targetRoot = createRepositoryCopy(context);
  const contributingPath = path.join(targetRoot, 'CONTRIBUTING.md');
  mutateText(
    contributingPath,
    'git switch --no-track --create feature/sync-ai-team-orchestration-<version> upstream/main',
    'git switch --create feature/sync-ai-team-orchestration-<version> --track upstream/main',
  );

  const result = runValidator(targetRoot);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /stale delivery instruction/);
});

test('validator rejects removal of terminal closeout semantics', (context) => {
  const targetRoot = createRepositoryCopy(context);
  const workflowPath = path.join(
    targetRoot,
    'skills',
    'ai-team',
    'references',
    'delivery-workflow.md',
  );
  mutateText(
    workflowPath,
    'no closeout-of-closeout PR is created',
    'another status PR may be created later',
  );

  const result = runValidator(targetRoot);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /must contain canonical contract/);
});

test('validator rejects stale role titles and the old delivery branch name', (context) => {
  const targetRoot = createRepositoryCopy(context);
  const brainstormPath = path.join(
    targetRoot,
    'skills',
    'ai-team',
    'references',
    'brainstorm-format.md',
  );
  const briefPath = path.join(
    targetRoot,
    'skills',
    'ai-team',
    'references',
    'project-brief-template.md',
  );
  mutateText(brainstormPath, 'Client/Interaction Engineer', 'Frontend Engineer');
  mutateText(briefPath, 'feature/devops-N', 'feature/delivery-N');

  const result = runValidator(targetRoot);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /stale role term "Frontend Engineer"/);
  assert.match(result.stderr, /stale role term "feature\/delivery-N"/);
});

test('validator rejects missing capability symmetry and QA archive path', (context) => {
  const targetRoot = createRepositoryCopy(context);
  const devPath = path.join(targetRoot, 'agents', 'ai-team-dev.agent.md');
  const sprintPath = path.join(
    targetRoot,
    'skills',
    'ai-team',
    'references',
    'sprint-plan-template.md',
  );
  mutateText(devPath, '## Capability Protocol', '## Tool Notes');
  mutateText(
    sprintPath,
    'docs/qa/sprint-N-signoff.md',
    'docs/qa/sprint-N-result.md',
  );

  const result = runValidator(targetRoot);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /must contain canonical section "## Capability Protocol"/);
  assert.match(result.stderr, /canonical QA archive path/);
});
