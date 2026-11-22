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

function pluginPath(targetRoot, ...segments) {
  return path.join(targetRoot, 'plugins', 'ai-team-orchestration', ...segments);
}

function mutateText(filePath, oldText, newText) {
  const contents = readFileSync(filePath, 'utf8');
  assert.ok(contents.includes(oldText), `Fixture text not found: ${oldText}`);
  writeFileSync(filePath, contents.replace(oldText, newText), 'utf8');
}

function mutatePlugin(targetRoot, mutation) {
  const manifestPath = pluginPath(targetRoot, 'plugin.json');
  const plugin = JSON.parse(readFileSync(manifestPath, 'utf8'));
  mutation(plugin);
  writeFileSync(manifestPath, `${JSON.stringify(plugin, null, 2)}\n`, 'utf8');
}

function assertRejected(targetRoot, pattern) {
  const result = runValidator(targetRoot);
  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stderr, pattern);
}

test('validator accepts the plugin repository', (context) => {
  const targetRoot = createRepositoryCopy(context);
  const result = runValidator(targetRoot);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Validation passed/);
});

test('bundled agents intentionally omit tools and model', (context) => {
  for (const field of ['tools', 'model']) {
    const targetRoot = createRepositoryCopy(context);
    mutateText(
      pluginPath(targetRoot, 'com.github.copilot', 'agents', 'ai-team-dev.md'),
      "name: 'ai-team-dev'",
      `name: 'ai-team-dev'\n${field}: 'unexpected'`,
    );
    assertRejected(targetRoot, new RegExp(`unsupported frontmatter field "${field}"`));
  }
});

test('bundled agents opt in to repository instructions as subagents', (context) => {
  for (const replacement of [
    '',
    'include-custom-instructions: false',
    'include-custom-instructions:true',
    'include-custom-instructions: \u00a0true',
  ]) {
    const targetRoot = createRepositoryCopy(context);
    mutateText(
      pluginPath(targetRoot, 'com.github.copilot', 'agents', 'ai-team-qa.md'),
      'include-custom-instructions: true',
      replacement,
    );
    assertRejected(targetRoot, /must contain exactly "include-custom-instructions: true"/);
  }
});

test('validator enforces the three stable agent IDs and file names', (context) => {
  for (const renamedFile of ['dev.md', 'ai-team-dev.agent.md']) {
    const targetRoot = createRepositoryCopy(context);
    const agentPath = pluginPath(targetRoot, 'com.github.copilot', 'agents', 'ai-team-dev.md');
    writeFileSync(
      pluginPath(targetRoot, 'com.github.copilot', 'agents', renamedFile),
      readFileSync(agentPath, 'utf8'),
      'utf8',
    );
    rmSync(agentPath);
    assertRejected(targetRoot, /com\.github\.copilot\/agents must contain exactly: ai-team-dev\.md/);
  }
});

test('validator enforces the skill identity and frontmatter', (context) => {
  for (const mutation of [
    ['name: ai-team-orchestration', 'name: ai-team', /must match folder name|name line must be exactly/],
    ["description: 'Bootstrap", "tools: []\ndescription: 'Bootstrap", /unsupported frontmatter field "tools"/],
  ]) {
    const targetRoot = createRepositoryCopy(context);
    mutateText(pluginPath(targetRoot, 'skills', 'ai-team-orchestration', 'SKILL.md'), mutation[0], mutation[1]);
    assertRejected(targetRoot, mutation[2]);
  }
});

test('validator rejects unresolved relative Markdown links', (context) => {
  const targetRoot = createRepositoryCopy(context);
  mutateText(
    pluginPath(targetRoot, 'skills', 'ai-team-orchestration', 'SKILL.md'),
    '[anti-patterns](./references/anti-patterns.md)',
    '[anti-patterns](./references/missing.md)',
  );
  assertRejected(targetRoot, /unresolved relative Markdown link/);
});

test('validator rejects plugin links that leave the installed payload', (context) => {
  const targetRoot = createRepositoryCopy(context);
  mutateText(
    pluginPath(targetRoot, 'README.md'),
    '## Origin',
    '[License](../../LICENSE)\n\n## Origin',
  );
  assertRejected(targetRoot, /links outside plugins\/ai-team-orchestration/);
});

test('validator requires an Agent Plugins 1.0 manifest', (context) => {
  for (const [mutation, pattern] of [
    [(plugin) => { plugin.agents = 'agents/'; }, /field "agents" is not part of Agent Plugins 1\.0/],
    [(plugin) => { delete plugin.$schema; }, /field "\$schema" must be exactly/],
    [(plugin) => { delete plugin.description; }, /field "description" must be a non-empty string/],
    [(plugin) => { plugin.author = 'Denis Evdokimov'; }, /field "author" must be an object/],
  ]) {
    const targetRoot = createRepositoryCopy(context);
    mutatePlugin(targetRoot, mutation);
    assertRejected(targetRoot, pattern);
  }
});

test('validator keeps only plugin files in the plugin root', (context) => {
  const targetRoot = createRepositoryCopy(context);
  writeFileSync(pluginPath(targetRoot, 'NOTES.md'), '# Notes\n', 'utf8');
  assertRejected(targetRoot, /plugins\/ai-team-orchestration must contain exactly/);
});

test('validator keeps exactly one copy of plugin content', (context) => {
  for (const relativePath of [
    ['plugin.json'],
    ['skills', 'ai-team-orchestration', 'SKILL.md'],
    ['agents', 'ai-team-dev.agent.md'],
  ]) {
    const targetRoot = createRepositoryCopy(context);
    const copyPath = path.join(targetRoot, ...relativePath);
    cpSync(pluginPath(targetRoot, 'plugin.json'), copyPath, { force: true });
    assertRejected(targetRoot, /is plugin content outside plugins\/ai-team-orchestration/);
  }
});

test('validator rejects linked skill content', (context) => {
  const targetRoot = createRepositoryCopy(context);
  const linkedPath = pluginPath(targetRoot, 'skills', 'ai-team-orchestration', 'references', 'linked.md');
  try {
    symlinkSync(
      pluginPath(targetRoot, 'README.md'),
      linkedPath,
      process.platform === 'win32' ? 'file' : undefined,
    );
  } catch (error) {
    context.skip(`Symbolic links are unavailable: ${error.message}`);
    return;
  }
  assertRejected(targetRoot, /must not be a symbolic link/);
});

test('formal workflow references are not part of the lightweight skill', (context) => {
  const targetRoot = createRepositoryCopy(context);
  for (const fileName of ['delivery-workflow.md', 'safe-git-values.md']) {
    assert.equal(
      readFileSync(pluginPath(targetRoot, 'skills', 'ai-team-orchestration', 'SKILL.md'), 'utf8')
        .includes(fileName),
      false,
    );
  }
  const result = runValidator(targetRoot);
  assert.equal(result.status, 0, result.stderr);
});