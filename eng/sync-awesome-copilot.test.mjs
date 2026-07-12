import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  appendFileSync,
  cpSync,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  syncAwesomeCopilot as syncAwesomeCopilotCore,
  transformSkillMarkdown,
} from './sync-awesome-copilot.mjs';

const CANONICAL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const AGENT_IDS = ['ai-team-dev', 'ai-team-producer', 'ai-team-qa'];
const TARGET_PLUGIN_RELATIVE = path.join(
  'plugins',
  'ai-team-orchestration',
  '.github',
  'plugin',
  'plugin.json',
);
const QUIET = () => {};

function writeJson(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function runGit(targetRoot, ...argumentsList) {
  const result = spawnSync('git', ['-C', targetRoot, ...argumentsList], { encoding: 'utf8' });
  assert.equal(result.status, 0, `git ${argumentsList.join(' ')} failed:\n${result.stderr}`);
  return result.stdout.trim();
}

function initializeGitRepository(root, branch = 'feature/sync-test') {
  runGit(root, 'init', '-b', branch);
  runGit(root, 'config', 'user.name', 'Sync Test');
  runGit(root, 'config', 'user.email', 'sync-test@example.invalid');
  runGit(root, 'config', 'commit.gpgsign', 'false');
  runGit(root, 'config', 'core.autocrlf', 'false');
  runGit(root, 'config', 'core.eol', 'lf');
  runGit(root, 'add', '-A');
  runGit(root, 'commit', '-m', 'fixture');
}

function setUpstreamMain(root, commit = 'HEAD') {
  runGit(root, 'update-ref', 'refs/remotes/upstream/main', commit);
}

function commitAll(root, message = 'fixture update') {
  runGit(root, 'add', '-A');
  runGit(root, 'commit', '-m', message);
}

function registerCleanup(context, root) {
  context.after(() => rmSync(root, { force: true, recursive: true }));
}

function createSourceFixture(branch = 'feature/source-test') {
  const sourceRoot = mkdtempSync(path.join(tmpdir(), 'ai-team-sync-source-'));
  const managedPaths = [
    'plugin.json',
    'eng/awesome-copilot-sync.json',
    ...AGENT_IDS.map((agentId) => `agents/${agentId}.agent.md`),
    'skills/ai-team',
  ];
  for (const portablePath of managedPaths) {
    const sourcePath = path.join(CANONICAL_ROOT, ...portablePath.split('/'));
    const targetPath = path.join(sourceRoot, ...portablePath.split('/'));
    mkdirSync(path.dirname(targetPath), { recursive: true });
    cpSync(sourcePath, targetPath, { recursive: true });
  }
  const scriptTarget = path.join(sourceRoot, 'eng', 'sync-awesome-copilot.mjs');
  mkdirSync(path.dirname(scriptTarget), { recursive: true });
  cpSync(fileURLToPath(new URL('./sync-awesome-copilot.mjs', import.meta.url)), scriptTarget);
  cpSync(
    fileURLToPath(new URL('./path-safety.mjs', import.meta.url)),
    path.join(sourceRoot, 'eng', 'path-safety.mjs'),
  );
  initializeGitRepository(sourceRoot, branch);
  return sourceRoot;
}

function createTargetFixture(branch = 'feature/sync-test') {
  const targetRoot = mkdtempSync(path.join(tmpdir(), 'ai-team-awesome-sync-'));
  for (const directory of ['agents', 'skills', 'plugins']) {
    mkdirSync(path.join(targetRoot, directory), { recursive: true });
  }
  writeJson(path.join(targetRoot, 'package.json'), { name: 'awesome-copilot', private: true });

  const pluginPath = path.join(targetRoot, TARGET_PLUGIN_RELATIVE);
  writeJson(pluginPath, {
    name: 'ai-team-orchestration',
    description: 'Outdated target description',
    version: '0.0.0',
    keywords: ['outdated'],
    author: { name: 'Outdated Author' },
    license: 'UNLICENSED',
    repository: 'https://github.com/github/awesome-copilot',
    agents: ['./agents/ai-team-dev.md', './agents/ai-team-producer.md', './agents/ai-team-qa.md'],
    skills: ['./skills/ai-team-orchestration/'],
    targetOnly: { preserve: true },
  });

  const targetSkillRoot = path.join(targetRoot, 'skills', 'ai-team-orchestration');
  mkdirSync(targetSkillRoot, { recursive: true });
  writeFileSync(path.join(targetSkillRoot, 'SKILL.md'), 'outdated\r\n', 'utf8');
  writeFileSync(path.join(targetSkillRoot, 'stale.txt'), 'remove me\r\n', 'utf8');
  writeFileSync(path.join(targetRoot, 'agents', 'ai-team-dev.agent.md'), 'outdated\r\n', 'utf8');
  initializeGitRepository(targetRoot, branch);
  runGit(targetRoot, 'remote', 'add', 'upstream', 'https://github.com/github/awesome-copilot.git');
  setUpstreamMain(targetRoot);
  return { pluginPath, targetRoot, targetSkillRoot };
}

function readManifest(sourceRoot) {
  return JSON.parse(readFileSync(path.join(sourceRoot, 'eng', 'awesome-copilot-sync.json'), 'utf8'));
}

function writeManifest(sourceRoot, manifest) {
  writeJson(path.join(sourceRoot, 'eng', 'awesome-copilot-sync.json'), manifest);
  commitAll(sourceRoot, 'mutate manifest');
}

function createDirectoryLink(targetPath, linkPath) {
  mkdirSync(path.dirname(linkPath), { recursive: true });
  symlinkSync(targetPath, linkPath, process.platform === 'win32' ? 'junction' : 'dir');
}

function testSyncOptions(options) {
  if (!options.write) {
    return options;
  }
  const outputRoot = mkdtempSync(path.join(tmpdir(), 'ai-team-sync-patch-output-'));
  const output = path.join(outputRoot, 'sync.patch');
  return {
    ...options,
    output,
    patchConsumer: ({ patch }) => {
      const targetRoot = options.targetRoot;
      const check = spawnSync('git', ['-C', targetRoot, 'apply', '--check', '--whitespace=nowarn', '-'], { input: patch });
      assert.equal(check.status, 0, check.stderr?.toString());
      const apply = spawnSync('git', ['-C', targetRoot, 'apply', '--whitespace=nowarn', '-'], { input: patch });
      assert.equal(apply.status, 0, apply.stderr?.toString());
      rmSync(outputRoot, { force: true, recursive: true });
    },
  };
}

function syncAwesomeCopilot(options) {
  const result = syncAwesomeCopilotCore(testSyncOptions(options));
  if (options.write) {
    const check = syncAwesomeCopilotCore({
      logger: QUIET,
      sourceRoot: options.sourceRoot,
      targetRoot: options.targetRoot,
    });
    return { ...result, aligned: check.aligned };
  }
  return result;
}

test('skill transform changes only the unique frontmatter name line', () => {
  const source = [
    '---',
    'name: ai-team',
    "description: 'Example'",
    '---',
    '',
    'The body keeps name: ai-team unchanged.',
    '',
  ].join('\r\n');
  const transformed = transformSkillMarkdown(source, 'ai-team', 'ai-team-orchestration');
  assert.match(transformed, /^---\nname: ai-team-orchestration\n/);
  assert.match(transformed, /The body keeps name: ai-team unchanged\./);
  assert.doesNotMatch(transformed, /\r/);
  assert.throws(
    () => transformSkillMarkdown(
      source.replace("description: 'Example'", "name: ai-team\r\ndescription: 'Example'"),
      'ai-team',
      'ai-team-orchestration',
    ),
    /exactly one name field/,
  );
  assert.throws(
    () => transformSkillMarkdown(
      source.replace('name: ai-team', "name: 'ai-team'"),
      'ai-team',
      'ai-team-orchestration',
    ),
    /must be exactly/,
  );
});

test('check, write, repeated write, and provenance are deterministic', (context) => {
  const sourceRoot = createSourceFixture();
  const fixture = createTargetFixture();
  registerCleanup(context, sourceRoot);
  registerCleanup(context, fixture.targetRoot);

  const initialCheck = syncAwesomeCopilot({ logger: QUIET, sourceRoot, targetRoot: fixture.targetRoot });
  assert.equal(initialCheck.aligned, false);
  assert.equal(initialCheck.sourceHead, runGit(sourceRoot, 'rev-parse', 'HEAD'));
  assert.equal(initialCheck.pluginVersion, '2.0.0');
  assert.ok(initialCheck.drift.some((item) => item.kind === 'missing'));
  assert.ok(initialCheck.drift.some((item) => item.kind === 'changed'));
  assert.ok(initialCheck.drift.some((item) => item.kind === 'extra'
    && item.relativePath.endsWith('/stale.txt')));

  const driftCli = spawnSync(
    process.execPath,
    [path.join(sourceRoot, 'eng', 'sync-awesome-copilot.mjs'), '--target', fixture.targetRoot],
    { encoding: 'utf8' },
  );
  assert.equal(driftCli.status, 1);
  assert.match(driftCli.stdout, /managed drift item/);
  assert.match(driftCli.stdout, /Source HEAD: [a-f0-9]{40,64}/);
  assert.match(driftCli.stdout, /Plugin version: 2\.0\.0/);

  const logs = [];
  const writeResult = syncAwesomeCopilot({
    logger: (message) => logs.push(message),
    sourceRoot,
    targetRoot: fixture.targetRoot,
    write: true,
  });
  assert.equal(writeResult.aligned, true);
  assert.ok(logs.includes(`Source HEAD: ${writeResult.sourceHead}`));
  assert.ok(logs.includes('Plugin version: 2.0.0'));
  assert.equal(existsSync(path.join(fixture.targetSkillRoot, 'stale.txt')), false);
  assert.match(
    readFileSync(path.join(fixture.targetSkillRoot, 'SKILL.md'), 'utf8'),
    /^---\nname: ai-team-orchestration\n/,
  );

  const sourcePlugin = JSON.parse(readFileSync(path.join(sourceRoot, 'plugin.json'), 'utf8'));
  const targetPlugin = JSON.parse(readFileSync(fixture.pluginPath, 'utf8'));
  for (const field of ['description', 'version', 'keywords', 'author', 'license']) {
    assert.deepEqual(targetPlugin[field], sourcePlugin[field]);
  }
  assert.equal(targetPlugin.repository, 'https://github.com/github/awesome-copilot');
  assert.deepEqual(targetPlugin.targetOnly, { preserve: true });

  assert.equal(
    syncAwesomeCopilot({ logger: QUIET, sourceRoot, targetRoot: fixture.targetRoot }).aligned,
    true,
  );
  const alignedCli = spawnSync(
    process.execPath,
    [path.join(sourceRoot, 'eng', 'sync-awesome-copilot.mjs'), '--target', fixture.targetRoot],
    { encoding: 'utf8' },
  );
  assert.equal(alignedCli.status, 0);
  assert.match(alignedCli.stdout, /checkout is aligned/);
  commitAll(fixture.targetRoot, 'synchronize fixture');
  const repeatedWrite = syncAwesomeCopilot({
    logger: QUIET,
    sourceRoot,
    targetRoot: fixture.targetRoot,
    write: true,
  });
  assert.deepEqual(repeatedWrite.actions, []);
  assert.equal(runGit(fixture.targetRoot, 'status', '--porcelain'), '');
});

test('skill export normalizes known text and preserves unknown assets byte-for-byte', (context) => {
  const sourceRoot = createSourceFixture();
  const fixture = createTargetFixture();
  registerCleanup(context, sourceRoot);
  registerCleanup(context, fixture.targetRoot);
  writeFileSync(
    path.join(sourceRoot, 'skills', 'ai-team', 'SKILL.md'),
    "---\r\nname: ai-team\r\ndescription: 'Fixture'\r\n---\r\n",
  );
  writeFileSync(path.join(sourceRoot, 'skills', 'ai-team', 'notes.txt'), 'first\r\nsecond\r\n');
  const opaqueBytes = Buffer.from([0x41, 0x0d, 0x0a, 0x42]);
  writeFileSync(path.join(sourceRoot, 'skills', 'ai-team', 'opaque.asset'), opaqueBytes);
  writeFileSync(path.join(sourceRoot, '.gitattributes'), '*.asset -text\n');
  commitAll(sourceRoot, 'add portable assets');
  syncAwesomeCopilot({ logger: QUIET, sourceRoot, targetRoot: fixture.targetRoot, write: true });
  assert.equal(readFileSync(path.join(fixture.targetSkillRoot, 'notes.txt'), 'utf8'), 'first\nsecond\n');
  assert.deepEqual(readFileSync(path.join(fixture.targetSkillRoot, 'opaque.asset')), opaqueBytes);
});

test('source replacement refs cannot alter exported HEAD bytes', (context) => {
  const sourceRoot = createSourceFixture();
  const fixture = createTargetFixture();
  registerCleanup(context, sourceRoot);
  registerCleanup(context, fixture.targetRoot);

  const sourceRelative = 'agents/ai-team-dev.agent.md';
  const sourcePath = path.join(sourceRoot, ...sourceRelative.split('/'));
  const expectedBytes = Buffer.from(
    readFileSync(sourcePath, 'utf8').replace(/\r\n?/g, '\n'),
    'utf8',
  );
  const originalBlob = runGit(sourceRoot, 'rev-parse', `HEAD:${sourceRelative}`);
  const replacementPath = path.join(sourceRoot, 'replacement-agent.md');
  const replacementBytes = Buffer.from('replacement bytes must never export\n');
  writeFileSync(replacementPath, replacementBytes);
  const replacementBlob = runGit(sourceRoot, 'hash-object', '-w', replacementPath);
  runGit(sourceRoot, 'replace', originalBlob, replacementBlob);
  unlinkSync(replacementPath);
  const replacedRead = spawnSync('git', ['-C', sourceRoot, 'cat-file', 'blob', originalBlob]);
  assert.equal(replacedRead.status, 0, replacedRead.stderr?.toString());
  assert.deepEqual(replacedRead.stdout, replacementBytes);

  syncAwesomeCopilot({
    logger: QUIET,
    sourceRoot,
    targetRoot: fixture.targetRoot,
    write: true,
  });
  assert.deepEqual(
    readFileSync(path.join(fixture.targetRoot, ...sourceRelative.split('/'))),
    expectedBytes,
  );
});

test('tracked managed hard link is blocked without changing its external sentinel', (context) => {
  const sourceRoot = createSourceFixture();
  const fixture = createTargetFixture();
  const externalRoot = mkdtempSync(path.join(tmpdir(), 'ai-team-hard-link-'));
  registerCleanup(context, sourceRoot);
  registerCleanup(context, fixture.targetRoot);
  registerCleanup(context, externalRoot);

  const managedPath = path.join(fixture.targetRoot, 'agents', 'ai-team-dev.agent.md');
  const sentinelPath = path.join(externalRoot, 'sentinel.md');
  const sentinelBytes = readFileSync(managedPath);
  unlinkSync(managedPath);
  writeFileSync(sentinelPath, sentinelBytes);
  try {
    linkSync(sentinelPath, managedPath);
  } catch (error) {
    context.skip(`Hard links are unavailable: ${error.message}`);
    return;
  }
  assert.equal(runGit(fixture.targetRoot, 'status', '--porcelain'), '');

  const check = syncAwesomeCopilot({ logger: QUIET, sourceRoot, targetRoot: fixture.targetRoot });
  assert.equal(check.aligned, false);
  assert.ok(check.blockers.some((blocker) => /hard-linked.*ai-team-dev/i.test(blocker)));
  assert.throws(
    () => syncAwesomeCopilot({
      logger: QUIET,
      sourceRoot,
      targetRoot: fixture.targetRoot,
      write: true,
    }),
    /hard-linked managed target file/i,
  );
  assert.deepEqual(readFileSync(sentinelPath), sentinelBytes);
});

test('target requires upstream/main and requires it to be an ancestor of HEAD', (context) => {
  const sourceRoot = createSourceFixture();
  registerCleanup(context, sourceRoot);

  const missing = createTargetFixture();
  registerCleanup(context, missing.targetRoot);
  runGit(missing.targetRoot, 'update-ref', '-d', 'refs/remotes/upstream/main');
  assert.throws(
    () => syncAwesomeCopilot({ logger: QUIET, sourceRoot, targetRoot: missing.targetRoot }),
    /requires the fetched ref refs\/remotes\/upstream\/main/,
  );

  runGit(missing.targetRoot, 'branch', 'upstream/main', 'HEAD');
  assert.throws(
    () => syncAwesomeCopilot({ logger: QUIET, sourceRoot, targetRoot: missing.targetRoot }),
    /requires the fetched ref refs\/remotes\/upstream\/main/,
  );

  const divergent = createTargetFixture();
  registerCleanup(context, divergent.targetRoot);
  const head = runGit(divergent.targetRoot, 'rev-parse', 'HEAD');
  runGit(divergent.targetRoot, 'checkout', '--orphan', 'unrelated-main');
  runGit(divergent.targetRoot, 'rm', '-rf', '.');
  writeFileSync(path.join(divergent.targetRoot, 'unrelated.txt'), 'unrelated\n');
  commitAll(divergent.targetRoot, 'unrelated upstream');
  setUpstreamMain(divergent.targetRoot);
  runGit(divergent.targetRoot, 'checkout', 'feature/sync-test');
  assert.equal(runGit(divergent.targetRoot, 'rev-parse', 'HEAD'), head);
  assert.throws(
    () => syncAwesomeCopilot({ logger: QUIET, sourceRoot, targetRoot: divergent.targetRoot }),
    /must be based on refs\/remotes\/upstream\/main/,
  );
});

test('local upstream/main branch cannot shadow the required remote-tracking ref', (context) => {
  const sourceRoot = createSourceFixture();
  const fixture = createTargetFixture();
  registerCleanup(context, sourceRoot);
  registerCleanup(context, fixture.targetRoot);
  runGit(fixture.targetRoot, 'update-ref', '-d', 'refs/remotes/upstream/main');
  runGit(fixture.targetRoot, 'branch', 'upstream/main', 'HEAD');

  assert.throws(
    () => syncAwesomeCopilot({ logger: QUIET, sourceRoot, targetRoot: fixture.targetRoot }),
    /requires the fetched ref refs\/remotes\/upstream\/main/,
  );
});

test('symbolic upstream ref and nonempty grafts cannot spoof ancestry', (context) => {
  const sourceRoot = createSourceFixture();
  registerCleanup(context, sourceRoot);

  const symbolic = createTargetFixture();
  registerCleanup(context, symbolic.targetRoot);
  runGit(symbolic.targetRoot, 'symbolic-ref', 'refs/remotes/upstream/main', 'refs/heads/feature/sync-test');
  assert.throws(
    () => syncAwesomeCopilot({ logger: QUIET, sourceRoot, targetRoot: symbolic.targetRoot }),
    /must be a direct remote-tracking ref/,
  );

  const grafted = createTargetFixture();
  registerCleanup(context, grafted.targetRoot);
  const graftsPath = path.resolve(
    grafted.targetRoot,
    runGit(grafted.targetRoot, 'rev-parse', '--git-path', 'info/grafts'),
  );
  writeFileSync(graftsPath, `${runGit(grafted.targetRoot, 'rev-parse', 'HEAD')}\n`);
  assert.throws(
    () => syncAwesomeCopilot({ logger: QUIET, sourceRoot, targetRoot: grafted.targetRoot }),
    /refuses nonempty Git grafts/,
  );
});

test('linked-worktree common grafts cannot spoof ancestry', (context) => {
  const sourceRoot = createSourceFixture();
  const fixture = createTargetFixture();
  registerCleanup(context, sourceRoot);
  registerCleanup(context, fixture.targetRoot);
  const linkedRoot = mkdtempSync(path.join(tmpdir(), 'ai-team-linked-worktree-parent-'));
  rmSync(linkedRoot, { recursive: true, force: true });
  context.after(() => rmSync(linkedRoot, { recursive: true, force: true }));
  runGit(fixture.targetRoot, 'worktree', 'add', '-b', 'feature/linked-test', linkedRoot, 'HEAD');
  const commonDir = runGit(linkedRoot, 'rev-parse', '--git-common-dir');
  const commonPath = path.resolve(linkedRoot, commonDir);
  writeFileSync(path.join(commonPath, 'info', 'grafts'), `${runGit(linkedRoot, 'rev-parse', 'HEAD')}\n`);

  assert.throws(
    () => syncAwesomeCopilot({ logger: QUIET, sourceRoot, targetRoot: linkedRoot }),
    /refuses nonempty Git grafts/,
  );
});

test('prepare mode writes a patch without modifying the target checkout', (context) => {
  const sourceRoot = createSourceFixture();
  const fixture = createTargetFixture();
  registerCleanup(context, sourceRoot);
  registerCleanup(context, fixture.targetRoot);
  const before = runGit(fixture.targetRoot, 'status', '--porcelain=v1', '--untracked-files=all');
  const outputRoot = mkdtempSync(path.join(tmpdir(), 'ai-team-prepare-only-'));
  registerCleanup(context, outputRoot);
  const output = path.join(outputRoot, 'sync.patch');

  const result = syncAwesomeCopilotCore({
    logger: QUIET,
    output,
    sourceRoot,
    targetRoot: fixture.targetRoot,
    write: true,
  });

  assert.ok(result.actions.length > 0);
  assert.equal(result.aligned, false);
  assert.equal(existsSync(output), true);
  assert.equal(runGit(fixture.targetRoot, 'status', '--porcelain=v1', '--untracked-files=all'), before);
  assert.equal(readFileSync(path.join(fixture.targetSkillRoot, 'SKILL.md'), 'utf8'), 'outdated\r\n');
});

test('prepare mode rejects patch output inside source or target repository', (context) => {
  const sourceRoot = createSourceFixture();
  const fixture = createTargetFixture();
  registerCleanup(context, sourceRoot);
  registerCleanup(context, fixture.targetRoot);
  for (const output of [
    path.join(sourceRoot, 'inside.patch'),
    path.join(fixture.targetRoot, 'inside.patch'),
  ]) {
    assert.throws(
      () => syncAwesomeCopilotCore({
        logger: QUIET,
        output,
        sourceRoot,
        targetRoot: fixture.targetRoot,
        write: true,
      }),
      /must be outside both canonical source and Awesome target repositories/,
    );
    assert.equal(existsSync(output), false);
  }
});

test('global process-capable Git filters are ignored during checks', (context) => {
  const sourceRoot = createSourceFixture();
  const fixture = createTargetFixture();
  registerCleanup(context, sourceRoot);
  registerCleanup(context, fixture.targetRoot);
  const configRoot = mkdtempSync(path.join(tmpdir(), 'ai-team-filter-config-'));
  registerCleanup(context, configRoot);
  const sentinel = path.join(configRoot, 'filter-ran.txt');
  const configPath = path.join(configRoot, 'gitconfig');
  const filterCommand = process.platform === 'win32'
    ? `cmd /d /c echo ran>${sentinel.replace(/\\/g, '/')}`
    : `sh -c 'echo ran > ${sentinel}'`;
  writeFileSync(configPath, `[filter "danger"]\n\tclean = ${filterCommand}\n\tsmudge = ${filterCommand}\n`);
  writeFileSync(path.join(fixture.targetRoot, '.gitattributes'), '* filter=danger\n');
  commitAll(fixture.targetRoot, 'configure dangerous filter');
  setUpstreamMain(fixture.targetRoot);

  const previousGlobal = process.env.GIT_CONFIG_GLOBAL;
  process.env.GIT_CONFIG_GLOBAL = configPath;
  try {
    syncAwesomeCopilot({ logger: QUIET, sourceRoot, targetRoot: fixture.targetRoot });
  } finally {
    if (previousGlobal === undefined) {
      delete process.env.GIT_CONFIG_GLOBAL;
    } else {
      process.env.GIT_CONFIG_GLOBAL = previousGlobal;
    }
  }
  assert.equal(existsSync(sentinel), false);
});

test('repository-local process-capable Git filters are rejected before inspection', (context) => {
  const sourceRoot = createSourceFixture();
  const fixture = createTargetFixture();
  registerCleanup(context, sourceRoot);
  registerCleanup(context, fixture.targetRoot);
  runGit(fixture.targetRoot, 'config', 'filter.danger.clean', 'echo dangerous');
  assert.throws(
    () => syncAwesomeCopilot({ logger: QUIET, sourceRoot, targetRoot: fixture.targetRoot }),
    /refuses repository-local process-capable Git filters/,
  );
});

test('manifest rejects duplicate and traversal-like agents, skills, and plugin targets', (context) => {
  const cases = [
    { mutate: (value) => value.agents.push(value.agents[0]), pattern: /duplicate agent ID/ },
    { mutate: (value) => { value.agents[0] = '../escape'; }, pattern: /agent ID must match/ },
    { mutate: (value) => { value.agents[0] = 'C:\\escape'; }, pattern: /agent ID must match/ },
    { mutate: (value) => { value.skill.source = 'ai\/team'; }, pattern: /skill\.source must match/ },
    { mutate: (value) => { value.skill.source = '../ai-team'; }, pattern: /skill\.source must match/ },
    { mutate: (value) => { value.skill.target = '..'; }, pattern: /skill\.target must match/ },
    { mutate: (value) => { value.plugin.target = 'escape\/plugin'; }, pattern: /plugin\.target must match/ },
    { mutate: (value) => { value.plugin.target = 'C:\\escape'; }, pattern: /plugin\.target must match/ },
  ];
  for (const fixtureCase of cases) {
    const sourceRoot = createSourceFixture();
    const target = createTargetFixture();
    registerCleanup(context, sourceRoot);
    registerCleanup(context, target.targetRoot);
    const manifest = readManifest(sourceRoot);
    fixtureCase.mutate(manifest);
    writeManifest(sourceRoot, manifest);
    assert.throws(
      () => syncAwesomeCopilot({ logger: QUIET, sourceRoot, targetRoot: target.targetRoot }),
      fixtureCase.pattern,
    );
  }
});

test('target root link is rejected before managed paths are inspected', (context) => {
  const sourceRoot = createSourceFixture();
  const fixture = createTargetFixture();
  const linkParent = mkdtempSync(path.join(tmpdir(), 'ai-team-target-link-'));
  const targetLink = path.join(linkParent, 'target-link');
  registerCleanup(context, sourceRoot);
  registerCleanup(context, fixture.targetRoot);
  registerCleanup(context, linkParent);
  createDirectoryLink(fixture.targetRoot, targetLink);

  assert.throws(
    () => syncAwesomeCopilot({ logger: QUIET, sourceRoot, targetRoot: targetLink }),
    /target root must not be a symbolic link, junction, or reparse point/i,
  );
});

test('source provenance rejects unsafe states and excludes ignored ambient files', (context) => {
  const target = createTargetFixture();
  registerCleanup(context, target.targetRoot);
  for (const [branch, pattern] of [['main', /main branch/], ['staged', /staged branch/]]) {
    const sourceRoot = createSourceFixture(branch);
    registerCleanup(context, sourceRoot);
    assert.throws(
      () => syncAwesomeCopilot({ logger: QUIET, sourceRoot, targetRoot: target.targetRoot }),
      pattern,
    );
  }

  const stagedSource = createSourceFixture();
  registerCleanup(context, stagedSource);
  writeFileSync(path.join(stagedSource, 'staged.txt'), 'staged\n');
  runGit(stagedSource, 'add', 'staged.txt');
  assert.throws(
    () => syncAwesomeCopilot({ logger: QUIET, sourceRoot: stagedSource, targetRoot: target.targetRoot }),
    /staged changes/,
  );

  const dirtySource = createSourceFixture();
  registerCleanup(context, dirtySource);
  appendFileSync(path.join(dirtySource, 'plugin.json'), '\n');
  assert.throws(
    () => syncAwesomeCopilot({ logger: QUIET, sourceRoot: dirtySource, targetRoot: target.targetRoot }),
    /dirty worktree/,
  );

  const untrackedSource = createSourceFixture();
  registerCleanup(context, untrackedSource);
  writeFileSync(path.join(untrackedSource, 'skills', 'ai-team', 'ambient.txt'), 'ambient\n');
  assert.throws(
    () => syncAwesomeCopilot({ logger: QUIET, sourceRoot: untrackedSource, targetRoot: target.targetRoot }),
    /dirty worktree/,
  );

  const ignoredSource = createSourceFixture();
  const ignoredTarget = createTargetFixture();
  registerCleanup(context, ignoredSource);
  registerCleanup(context, ignoredTarget.targetRoot);
  writeFileSync(path.join(ignoredSource, '.gitignore'), 'skills/ai-team/ignored.txt\n');
  commitAll(ignoredSource, 'ignore ambient file');
  writeFileSync(path.join(ignoredSource, 'skills', 'ai-team', 'ignored.txt'), 'ignored\n');
  syncAwesomeCopilot({
    logger: QUIET,
    sourceRoot: ignoredSource,
    targetRoot: ignoredTarget.targetRoot,
    write: true,
  });
  assert.equal(existsSync(path.join(ignoredTarget.targetSkillRoot, 'ignored.txt')), false);

  const detachedSource = createSourceFixture();
  registerCleanup(context, detachedSource);
  runGit(detachedSource, 'checkout', '--detach');
  assert.throws(
    () => syncAwesomeCopilot({ logger: QUIET, sourceRoot: detachedSource, targetRoot: target.targetRoot }),
    /detached HEAD/,
  );

  const symlinkSource = createSourceFixture();
  registerCleanup(context, symlinkSource);
  writeFileSync(path.join(symlinkSource, 'skills', 'ai-team', 'tracked-link.txt'), 'SKILL.md');
  runGit(symlinkSource, 'add', 'skills/ai-team/tracked-link.txt');
  const linkBlob = runGit(symlinkSource, 'hash-object', '-w', 'skills/ai-team/tracked-link.txt');
  runGit(
    symlinkSource,
    'update-index',
    '--cacheinfo',
    `120000,${linkBlob},skills/ai-team/tracked-link.txt`,
  );
  runGit(symlinkSource, 'commit', '-m', 'add tracked symlink');
  assert.throws(
    () => syncAwesomeCopilot({ logger: QUIET, sourceRoot: symlinkSource, targetRoot: target.targetRoot }),
    /symbolic link|junction|reparse point/i,
  );
});

test('target managed skill root link escape is rejected and external sentinel is unchanged', (context) => {
  const sourceRoot = createSourceFixture();
  const fixture = createTargetFixture();
  const externalRoot = mkdtempSync(path.join(tmpdir(), 'ai-team-external-'));
  registerCleanup(context, sourceRoot);
  registerCleanup(context, fixture.targetRoot);
  registerCleanup(context, externalRoot);
  const sentinelPath = path.join(externalRoot, 'sentinel.txt');
  writeFileSync(sentinelPath, 'unchanged\n');
  rmSync(fixture.targetSkillRoot, { force: true, recursive: true });
  createDirectoryLink(externalRoot, fixture.targetSkillRoot);
  const check = syncAwesomeCopilot({ logger: QUIET, sourceRoot, targetRoot: fixture.targetRoot });
  assert.equal(check.aligned, false);
  assert.ok(check.blockers.some((blocker) => /symbolic link|junction|reparse point|escapes/i.test(blocker)));
  assert.throws(
    () => syncAwesomeCopilot({
      logger: QUIET,
      sourceRoot,
      targetRoot: fixture.targetRoot,
      write: true,
    }),
    /dirty worktree|symbolic link|junction|reparse point|escapes/i,
  );
  assert.equal(readFileSync(sentinelPath, 'utf8'), 'unchanged\n');
});

test('nested target plugin link escape is rejected and external sentinel is unchanged', (context) => {
  const sourceRoot = createSourceFixture();
  const fixture = createTargetFixture();
  const externalRoot = mkdtempSync(path.join(tmpdir(), 'ai-team-plugin-external-'));
  registerCleanup(context, sourceRoot);
  registerCleanup(context, fixture.targetRoot);
  registerCleanup(context, externalRoot);

  const sentinelPath = path.join(externalRoot, 'sentinel.txt');
  writeFileSync(sentinelPath, 'unchanged\n');
  const pluginDirectory = path.dirname(fixture.pluginPath);
  rmSync(pluginDirectory, { force: true, recursive: true });
  createDirectoryLink(externalRoot, pluginDirectory);

  const check = syncAwesomeCopilot({ logger: QUIET, sourceRoot, targetRoot: fixture.targetRoot });
  assert.equal(check.aligned, false);
  assert.ok(check.blockers.some((blocker) => /symbolic link|junction|reparse point|escapes/i.test(blocker)));
  assert.throws(
    () => syncAwesomeCopilot({
      logger: QUIET,
      sourceRoot,
      targetRoot: fixture.targetRoot,
      write: true,
    }),
    /dirty worktree|symbolic link|junction|reparse point|escapes/i,
  );
  assert.equal(readFileSync(sentinelPath, 'utf8'), 'unchanged\n');
});

test('missing target plugin manifest remains a blocker', (context) => {
  const sourceRoot = createSourceFixture();
  const fixture = createTargetFixture();
  registerCleanup(context, sourceRoot);
  registerCleanup(context, fixture.targetRoot);

  unlinkSync(fixture.pluginPath);
  const check = syncAwesomeCopilot({ logger: QUIET, sourceRoot, targetRoot: fixture.targetRoot });
  assert.equal(check.aligned, false);
  assert.ok(check.blockers.some((blocker) => blocker.includes('missing target plugin manifest')));
  assert.throws(
    () => syncAwesomeCopilot({
      logger: QUIET,
      sourceRoot,
      targetRoot: fixture.targetRoot,
      write: true,
    }),
    /dirty worktree|missing target plugin manifest/,
  );
  assert.equal(existsSync(fixture.pluginPath), false);
});

test('ignored and untracked target extras are blockers and preserved', (context) => {
  for (const ignored of [false, true]) {
    const sourceRoot = createSourceFixture();
    const fixture = createTargetFixture();
    registerCleanup(context, sourceRoot);
    registerCleanup(context, fixture.targetRoot);
    const fileName = ignored ? 'ignored-extra.txt' : 'untracked-extra.txt';
    const extraPath = path.join(fixture.targetSkillRoot, fileName);
    if (ignored) {
      writeFileSync(
        path.join(fixture.targetRoot, '.gitignore'),
        `skills/ai-team-orchestration/${fileName}\n`,
      );
      commitAll(fixture.targetRoot, 'ignore target extra');
    }
    writeFileSync(extraPath, 'sentinel\n');
    const result = syncAwesomeCopilot({ logger: QUIET, sourceRoot, targetRoot: fixture.targetRoot });
    assert.equal(result.aligned, false);
    assert.ok(result.blockers.some((blocker) => blocker.includes(ignored ? 'ignored' : 'untracked')));
    assert.equal(readFileSync(extraPath, 'utf8'), 'sentinel\n');
  }
});

test('ignored desired collision and missing ignored desired path are refused', (context) => {
  const sourceRoot = createSourceFixture();
  const fixture = createTargetFixture();
  registerCleanup(context, sourceRoot);
  registerCleanup(context, fixture.targetRoot);
  const relativePath = 'agents/ai-team-producer.agent.md';
  const desiredPath = path.join(fixture.targetRoot, ...relativePath.split('/'));
  writeFileSync(path.join(fixture.targetRoot, '.gitignore'), `${relativePath}\n`);
  commitAll(fixture.targetRoot, 'ignore desired target');
  writeFileSync(desiredPath, 'sentinel\n');
  const collision = syncAwesomeCopilot({ logger: QUIET, sourceRoot, targetRoot: fixture.targetRoot });
  assert.ok(collision.blockers.some((blocker) => blocker.includes('ignored')));
  assert.equal(readFileSync(desiredPath, 'utf8'), 'sentinel\n');
  unlinkSync(desiredPath);
  const missing = syncAwesomeCopilot({ logger: QUIET, sourceRoot, targetRoot: fixture.targetRoot });
  assert.ok(missing.blockers.some((blocker) => blocker.includes('ignore rules')));
  assert.equal(existsSync(desiredPath), false);
});

test('write refuses to overwrite a modified untracked file created by an earlier export', (context) => {
  const sourceRoot = createSourceFixture();
  const fixture = createTargetFixture();
  registerCleanup(context, sourceRoot);
  registerCleanup(context, fixture.targetRoot);

  syncAwesomeCopilot({
    logger: QUIET,
    sourceRoot,
    targetRoot: fixture.targetRoot,
    write: true,
  });
  const createdPath = path.join(fixture.targetRoot, 'agents', 'ai-team-producer.agent.md');
  writeFileSync(createdPath, 'modified sentinel\n');

  const check = syncAwesomeCopilot({ logger: QUIET, sourceRoot, targetRoot: fixture.targetRoot });
  assert.ok(check.blockers.some((blocker) => blocker.includes('untracked')));
  assert.throws(
    () => syncAwesomeCopilot({
      logger: QUIET,
      sourceRoot,
      targetRoot: fixture.targetRoot,
      write: true,
    }),
    /dirty worktree|untracked/,
  );
  assert.equal(readFileSync(createdPath, 'utf8'), 'modified sentinel\n');
});

test('write refuses main, staged branch, staged changes, dirty, and detached targets', (context) => {
  const sourceRoot = createSourceFixture();
  registerCleanup(context, sourceRoot);
  for (const [branch, pattern] of [['main', /main branch/], ['staged', /staged branch/]]) {
    const fixture = createTargetFixture(branch);
    registerCleanup(context, fixture.targetRoot);
    assert.throws(
      () => syncAwesomeCopilot({ logger: QUIET, sourceRoot, targetRoot: fixture.targetRoot, write: true }),
      pattern,
    );
  }

  const stagedFixture = createTargetFixture();
  registerCleanup(context, stagedFixture.targetRoot);
  writeFileSync(path.join(stagedFixture.targetRoot, 'staged.txt'), 'staged\n');
  runGit(stagedFixture.targetRoot, 'add', 'staged.txt');
  assert.throws(
    () => syncAwesomeCopilot({ logger: QUIET, sourceRoot, targetRoot: stagedFixture.targetRoot, write: true }),
    /staged changes/,
  );

  const dirtyFixture = createTargetFixture();
  registerCleanup(context, dirtyFixture.targetRoot);
  appendFileSync(path.join(dirtyFixture.targetRoot, 'package.json'), '\n');
  assert.throws(
    () => syncAwesomeCopilot({ logger: QUIET, sourceRoot, targetRoot: dirtyFixture.targetRoot, write: true }),
    /dirty worktree/,
  );

  const detachedFixture = createTargetFixture();
  registerCleanup(context, detachedFixture.targetRoot);
  runGit(detachedFixture.targetRoot, 'checkout', '--detach');
  assert.throws(
    () => syncAwesomeCopilot({ logger: QUIET, sourceRoot, targetRoot: detachedFixture.targetRoot, write: true }),
    /detached HEAD/,
  );
});

test('check refuses main, staged, and detached targets', (context) => {
  const sourceRoot = createSourceFixture();
  registerCleanup(context, sourceRoot);
  for (const [branch, pattern] of [['main', /main branch/], ['staged', /staged branch/]]) {
    const fixture = createTargetFixture(branch);
    registerCleanup(context, fixture.targetRoot);
    assert.throws(
      () => syncAwesomeCopilot({ logger: QUIET, sourceRoot, targetRoot: fixture.targetRoot }),
      pattern,
    );
  }

  const detachedFixture = createTargetFixture();
  registerCleanup(context, detachedFixture.targetRoot);
  runGit(detachedFixture.targetRoot, 'checkout', '--detach');
  assert.throws(
    () => syncAwesomeCopilot({ logger: QUIET, sourceRoot, targetRoot: detachedFixture.targetRoot }),
    /detached HEAD/,
  );
});
