import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

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
  return spawnSync(process.execPath, [path.join(targetRoot, 'eng', 'validate.mjs')], {
    cwd: targetRoot,
    encoding: 'utf8',
  });
}

function mutateText(filePath, oldText, newText) {
  const contents = readFileSync(filePath, 'utf8');
  assert.ok(contents.includes(oldText), `Fixture text not found: ${oldText}`);
  writeFileSync(filePath, contents.replace(oldText, newText), 'utf8');
}

test('validator accepts the lightweight canonical repository', (context) => {
  const targetRoot = createRepositoryCopy(context);
  const result = runValidator(targetRoot);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Validation passed/);
});

test('bundled agents intentionally omit tools and model', (context) => {
  for (const field of ['tools', 'model']) {
    const targetRoot = createRepositoryCopy(context);
    const agentPath = path.join(targetRoot, 'agents', 'ai-team-dev.agent.md');
    mutateText(
      agentPath,
      "name: 'ai-team-dev'",
      `name: 'ai-team-dev'\n${field}: 'unexpected'`,
    );
    const result = runValidator(targetRoot);
    assert.equal(result.status, 1);
    assert.match(result.stderr, new RegExp(`unsupported frontmatter field "${field}"`));
  }
});

test('validator enforces the three stable agent IDs', (context) => {
  const targetRoot = createRepositoryCopy(context);
  const agentPath = path.join(targetRoot, 'agents', 'ai-team-dev.agent.md');
  const renamedPath = path.join(targetRoot, 'agents', 'dev.agent.md');
  writeFileSync(renamedPath, readFileSync(agentPath, 'utf8'), 'utf8');
  rmSync(agentPath);
  const result = runValidator(targetRoot);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /agents\/ must contain exactly these agent IDs/);
});

test('validator enforces canonical skill identity and frontmatter', (context) => {
  for (const mutation of [
    ["name: ai-team", "name: ai-team-orchestration", /must match folder name|canonical frontmatter name/],
    ["description: 'Bootstrap", "tools: []\ndescription: 'Bootstrap", /unsupported frontmatter field "tools"/],
  ]) {
    const targetRoot = createRepositoryCopy(context);
    const skillPath = path.join(targetRoot, 'skills', 'ai-team', 'SKILL.md');
    mutateText(skillPath, mutation[0], mutation[1]);
    const result = runValidator(targetRoot);
    assert.equal(result.status, 1);
    assert.match(result.stderr, mutation[2]);
  }
});

test('validator rejects unresolved relative Markdown links', (context) => {
  const targetRoot = createRepositoryCopy(context);
  const skillPath = path.join(targetRoot, 'skills', 'ai-team', 'SKILL.md');
  mutateText(
    skillPath,
    '[anti-patterns](./references/anti-patterns.md)',
    '[anti-patterns](./references/missing.md)',
  );
  const result = runValidator(targetRoot);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /unresolved relative Markdown link/);
});

test('validator requires exact plugin roots and sync ownership', (context) => {
  for (const mutation of [
    (plugin) => {
      plugin.agents = 'skills/';
    },
    (plugin) => {
      delete plugin.description;
    },
  ]) {
    const targetRoot = createRepositoryCopy(context);
    const pluginPath = path.join(targetRoot, 'plugin.json');
    const plugin = JSON.parse(readFileSync(pluginPath, 'utf8'));
    mutation(plugin);
    writeFileSync(pluginPath, `${JSON.stringify(plugin, null, 2)}\n`, 'utf8');
    const result = runValidator(targetRoot);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /must be exactly "agents\/"|description|managed plugin fields/);
  }
});

test('validator rejects linked skill content', (context) => {
  const targetRoot = createRepositoryCopy(context);
  const linkedPath = path.join(targetRoot, 'skills', 'ai-team', 'references', 'linked.md');
  try {
    symlinkSync(
      path.join(targetRoot, 'README.md'),
      linkedPath,
      process.platform === 'win32' ? 'file' : undefined,
    );
  } catch (error) {
    context.skip(`Symbolic links are unavailable: ${error.message}`);
    return;
  }
  const result = runValidator(targetRoot);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /must not be a symbolic link/);
});

test('formal workflow references are not part of the lightweight skill', (context) => {
  const targetRoot = createRepositoryCopy(context);
  for (const fileName of ['delivery-workflow.md', 'safe-git-values.md']) {
    assert.equal(
      readFileSync(path.join(targetRoot, 'skills', 'ai-team', 'SKILL.md'), 'utf8')
        .includes(fileName),
      false,
    );
  }
  const result = runValidator(targetRoot);
  assert.equal(result.status, 0, result.stderr);
});
