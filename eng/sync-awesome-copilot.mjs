import { spawnSync } from 'node:child_process';
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { TextDecoder } from 'node:util';
import { fileURLToPath } from 'node:url';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const DEFAULT_SOURCE_ROOT = path.resolve(path.dirname(SCRIPT_PATH), '..');
const GIT_MAX_BUFFER = 64 * 1024 * 1024;
const SLUG_PATTERN = /^[a-z0-9-]+$/;
const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);
const TEXT_EXTENSIONS = new Set([
  '.c',
  '.cc',
  '.cfg',
  '.conf',
  '.cpp',
  '.cs',
  '.css',
  '.csv',
  '.go',
  '.h',
  '.hpp',
  '.html',
  '.ini',
  '.java',
  '.js',
  '.json',
  '.jsx',
  '.md',
  '.mjs',
  '.ps1',
  '.py',
  '.rb',
  '.rs',
  '.sh',
  '.sql',
  '.svg',
  '.toml',
  '.ts',
  '.tsx',
  '.txt',
  '.xml',
  '.yaml',
  '.yml',
]);

function normalizeLf(text) {
  return text.replace(/\r\n?/g, '\n');
}

function compareText(left, right) {
  if (left < right) {
    return -1;
  }
  return left > right ? 1 : 0;
}

function parseJson(filePath, label) {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error.message}`);
  }
}

function cloneJsonValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function hasUtf8Bom(buffer) {
  return buffer.length >= UTF8_BOM.length
    && buffer.subarray(0, UTF8_BOM.length).equals(UTF8_BOM);
}

function decodeUtf8(buffer, label) {
  const hasBom = hasUtf8Bom(buffer);
  const body = hasBom ? buffer.subarray(UTF8_BOM.length) : buffer;
  try {
    return {
      hasBom,
      text: new TextDecoder('utf-8', { fatal: true }).decode(body),
    };
  } catch {
    throw new Error(`${label} must be valid UTF-8 text.`);
  }
}

function encodeUtf8(text, hasBom = false) {
  const body = Buffer.from(text, 'utf8');
  return hasBom ? Buffer.concat([UTF8_BOM, body]) : body;
}

function normalizeTextBuffer(buffer, label) {
  const decoded = decodeUtf8(buffer, label);
  return encodeUtf8(normalizeLf(decoded.text), decoded.hasBom);
}

function normalizePortableBuffer(buffer, label, filePath) {
  return TEXT_EXTENSIONS.has(path.extname(filePath).toLowerCase())
    ? normalizeTextBuffer(buffer, label)
    : buffer;
}

export function transformSkillMarkdown(markdown, sourceName, targetName) {
  const normalized = normalizeLf(markdown);
  const lines = normalized.split('\n');
  if (lines[0] !== '---') {
    throw new Error('SKILL.md must start with YAML frontmatter.');
  }

  const closingIndex = lines.indexOf('---', 1);
  if (closingIndex === -1) {
    throw new Error('SKILL.md has unterminated YAML frontmatter.');
  }

  const nameLines = [];
  for (let index = 1; index < closingIndex; index += 1) {
    if (/^\s*name\s*:/.test(lines[index])) {
      nameLines.push(index);
    }
  }

  if (nameLines.length !== 1) {
    throw new Error(`SKILL.md frontmatter must contain exactly one name field; found ${nameLines.length}.`);
  }

  const nameIndex = nameLines[0];
  const expectedLine = `name: ${sourceName}`;
  if (lines[nameIndex] !== expectedLine) {
    throw new Error(`SKILL.md frontmatter name must be exactly "${expectedLine}" before synchronization.`);
  }

  lines[nameIndex] = `name: ${targetName}`;
  return lines.join('\n');
}

function transformSkillBuffer(buffer, sourceName, targetName, label) {
  const decoded = decodeUtf8(buffer, label);
  const transformed = transformSkillMarkdown(decoded.text, sourceName, targetName);
  return encodeUtf8(transformed, decoded.hasBom);
}

function targetRelativePath(...parts) {
  return path.posix.join(...parts);
}

function tryLstat(filePath) {
  try {
    return lstatSync(filePath);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

function sameFilesystemPath(left, right) {
  const normalizedLeft = path.resolve(left);
  const normalizedRight = path.resolve(right);
  return process.platform === 'win32'
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}

function isContainedPath(rootPath, candidatePath, allowRoot = true) {
  const relativePath = path.relative(rootPath, candidatePath);
  if (relativePath === '') {
    return allowRoot;
  }
  return relativePath !== '..'
    && !relativePath.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relativePath);
}

function validatePortableRelativePath(portablePath, label) {
  if (typeof portablePath !== 'string' || portablePath.length === 0) {
    throw new Error(`${label} must be a non-empty relative path.`);
  }
  if (portablePath.includes('\\')
    || portablePath.includes('\0')
    || path.posix.isAbsolute(portablePath)
    || path.win32.isAbsolute(portablePath)) {
    throw new Error(`${label} must be a portable relative path without drive or separator escapes: ${portablePath}`);
  }

  const parts = portablePath.split('/');
  if (parts.some((part) => part === ''
    || part === '.'
    || part === '..'
    || /^[A-Za-z]:/.test(part))) {
    throw new Error(`${label} contains an empty, dot, or drive-form path segment: ${portablePath}`);
  }
  return parts;
}

function createRootInfo(rootPath, label) {
  const resolvedPath = path.resolve(rootPath);
  const rootStat = tryLstat(resolvedPath);
  if (!rootStat) {
    throw new Error(`${label} does not exist: ${resolvedPath}`);
  }
  if (rootStat.isSymbolicLink()) {
    throw new Error(`${label} must not be a symbolic link, junction, or reparse point: ${resolvedPath}`);
  }
  if (!rootStat.isDirectory()) {
    throw new Error(`${label} must be a directory: ${resolvedPath}`);
  }
  const realPath = realpathSync(resolvedPath);
  if (!sameFilesystemPath(realPath, resolvedPath)) {
    throw new Error(`${label} must not resolve through a symbolic link, junction, mount, or reparse point: ${resolvedPath}`);
  }

  return {
    label,
    path: resolvedPath,
    realPath,
  };
}

function resolveManagedPath(rootInfo, portablePath, label = portablePath) {
  const parts = validatePortableRelativePath(portablePath, label);
  const resolvedPath = path.resolve(rootInfo.path, ...parts);
  if (!isContainedPath(rootInfo.path, resolvedPath, false)) {
    throw new Error(`${label} resolves outside ${rootInfo.label}: ${portablePath}`);
  }
  return resolvedPath;
}

function assertSafeManagedPath(rootInfo, portablePath, label = portablePath) {
  const parts = validatePortableRelativePath(portablePath, label);
  const resolvedPath = resolveManagedPath(rootInfo, portablePath, label);
  const rootStat = tryLstat(rootInfo.path);
  if (!rootStat || rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw new Error(`${rootInfo.label} changed into a missing or linked path.`);
  }
  const currentRootRealPath = realpathSync(rootInfo.path);
  if (!sameFilesystemPath(currentRootRealPath, rootInfo.realPath)) {
    throw new Error(`${rootInfo.label} changed its real path during synchronization.`);
  }
  let currentPath = rootInfo.path;

  for (let index = 0; index < parts.length; index += 1) {
    currentPath = path.join(currentPath, parts[index]);
    const currentStat = tryLstat(currentPath);
    if (!currentStat) {
      break;
    }
    if (currentStat.isSymbolicLink()) {
      throw new Error(`${label} contains a symbolic link, junction, or reparse point: ${currentPath}`);
    }

    const currentRealPath = realpathSync(currentPath);
    if (!isContainedPath(rootInfo.realPath, currentRealPath, true)) {
      throw new Error(`${label} escapes ${rootInfo.label} through a reparse point: ${currentPath}`);
    }
    if (index < parts.length - 1 && !currentStat.isDirectory()) {
      throw new Error(`${label} has a non-directory path component: ${currentPath}`);
    }
  }

  return resolvedPath;
}

function assertManagedDirectory(rootInfo, portablePath, label = portablePath) {
  const absolutePath = assertSafeManagedPath(rootInfo, portablePath, label);
  const targetStat = tryLstat(absolutePath);
  if (!targetStat || !targetStat.isDirectory()) {
    throw new Error(`${label} must be an existing directory.`);
  }
  return absolutePath;
}

function assertManagedRegularFile(rootInfo, portablePath, label = portablePath) {
  const absolutePath = assertSafeManagedPath(rootInfo, portablePath, label);
  const targetStat = tryLstat(absolutePath);
  if (!targetStat || !targetStat.isFile()) {
    throw new Error(`${label} must be an existing regular file.`);
  }
  return absolutePath;
}

function listFilesStrict(rootInfo, portableRoot, blockers = []) {
  let rootPath;
  try {
    rootPath = assertSafeManagedPath(rootInfo, portableRoot, portableRoot);
  } catch (error) {
    blockers.push(error.message);
    return [];
  }
  const rootStat = tryLstat(rootPath);
  if (!rootStat) {
    return [];
  }
  if (!rootStat.isDirectory()) {
    throw new Error(`Managed tree must be a directory: ${portableRoot}`);
  }

  const files = [];
  function visit(relativeDirectory) {
    const directoryPortablePath = relativeDirectory
      ? targetRelativePath(portableRoot, relativeDirectory)
      : portableRoot;
    let directoryPath;
    try {
      directoryPath = assertManagedDirectory(
        rootInfo,
        directoryPortablePath,
        directoryPortablePath,
      );
    } catch (error) {
      blockers.push(error.message);
      return;
    }

    for (const entry of readdirSync(directoryPath, { withFileTypes: true })) {
      const relativePath = relativeDirectory
        ? path.posix.join(relativeDirectory, entry.name)
        : entry.name;
      const portablePath = targetRelativePath(portableRoot, relativePath);
      let absolutePath;
      try {
        absolutePath = assertSafeManagedPath(rootInfo, portablePath, portablePath);
      } catch (error) {
        blockers.push(error.message);
        continue;
      }
      const entryStat = tryLstat(absolutePath);
      if (!entryStat) {
        blockers.push(`Managed path disappeared while it was inspected: ${portablePath}`);
        continue;
      }
      if (entryStat.isDirectory()) {
        visit(relativePath);
      } else if (entryStat.isFile()) {
        files.push(relativePath);
      } else {
        blockers.push(`Managed trees may contain only regular files and directories: ${portablePath}`);
      }
    }
  }

  visit('');
  return files.sort(compareText);
}

function decodeGitText(buffer, label) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    throw new Error(`${label} contains a non-UTF-8 Git path.`);
  }
}

function sanitizedGitEnvironment() {
  const environment = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!key.toUpperCase().startsWith('GIT_')) {
      environment[key] = value;
    }
  }
  environment.GIT_OPTIONAL_LOCKS = '0';
  environment.GIT_NO_REPLACE_OBJECTS = '1';
  return environment;
}

function runGit(rootPath, argumentsList, { binary = false, input } = {}) {
  const gitArguments = [
    '--no-replace-objects',
    '-c',
    `core.hooksPath=${SCRIPT_PATH}`,
    '-c',
    'core.fsmonitor=false',
  ];
  if (rootPath !== null) {
    gitArguments.push('-C', rootPath);
  }
  gitArguments.push(...argumentsList);

  const result = spawnSync('git', gitArguments, {
    encoding: binary ? undefined : 'utf8',
    env: sanitizedGitEnvironment(),
    input,
    maxBuffer: GIT_MAX_BUFFER,
    windowsHide: true,
  });
  if (result.error) {
    throw new Error(`Unable to run git: ${result.error.message}`);
  }
  return result;
}

function gitErrorText(result) {
  if (!result.stderr) {
    return '';
  }
  return Buffer.isBuffer(result.stderr)
    ? result.stderr.toString('utf8').trim()
    : result.stderr.trim();
}

function requireGitSuccess(rootPath, argumentsList, label, options = {}) {
  const result = runGit(rootPath, argumentsList, options);
  if (result.status !== 0) {
    throw new Error(`${label}: ${gitErrorText(result) || `git exited ${result.status}`}`);
  }
  return result.stdout;
}

function parseLsTree(buffer, label) {
  const entries = [];
  let start = 0;
  for (let index = 0; index < buffer.length; index += 1) {
    if (buffer[index] !== 0) {
      continue;
    }
    const entryBuffer = buffer.subarray(start, index);
    start = index + 1;
    if (entryBuffer.length === 0) {
      continue;
    }
    const tabIndex = entryBuffer.indexOf(0x09);
    if (tabIndex === -1) {
      throw new Error(`Unexpected git ls-tree output for ${label}.`);
    }
    const metadata = entryBuffer.subarray(0, tabIndex).toString('ascii').split(' ');
    if (metadata.length !== 3) {
      throw new Error(`Unexpected git ls-tree metadata for ${label}.`);
    }
    entries.push({
      mode: metadata[0],
      objectId: metadata[2],
      path: decodeGitText(entryBuffer.subarray(tabIndex + 1), label),
      type: metadata[1],
    });
  }
  return entries;
}

function readHeadBlob(source, entry, label) {
  if (entry.mode === '120000') {
    throw new Error(`${label} is a tracked symbolic link; canonical managed sources must be regular files.`);
  }
  if (entry.type !== 'blob' || (entry.mode !== '100644' && entry.mode !== '100755')) {
    throw new Error(`${label} is not a tracked regular file (mode ${entry.mode}, type ${entry.type}).`);
  }
  return requireGitSuccess(
    source.root.path,
    ['cat-file', 'blob', entry.objectId],
    `Unable to read ${label} from source HEAD`,
    { binary: true },
  );
}

function getHeadEntry(source, portablePath, label) {
  assertSafeManagedPath(source.root, portablePath, label);
  const output = requireGitSuccess(
    source.root.path,
    ['ls-tree', '-z', source.head, '--', `:(literal)${portablePath}`],
    `Unable to inspect ${label} in source HEAD`,
    { binary: true },
  );
  const entries = parseLsTree(output, label)
    .filter((entry) => entry.path === portablePath);
  if (entries.length !== 1) {
    throw new Error(`${label} must be a tracked source file in HEAD.`);
  }
  return entries[0];
}

function readHeadFile(source, portablePath, label = portablePath) {
  return readHeadBlob(source, getHeadEntry(source, portablePath, label), label);
}

function listHeadSkillFiles(source, sourceSkill) {
  const skillRoot = targetRelativePath('skills', sourceSkill);
  assertSafeManagedPath(source.root, skillRoot, `Canonical skill ${skillRoot}`);

  const rootOutput = requireGitSuccess(
    source.root.path,
    ['ls-tree', '-z', source.head, '--', `:(literal)${skillRoot}`],
    `Unable to inspect canonical skill ${skillRoot}`,
    { binary: true },
  );
  const rootEntries = parseLsTree(rootOutput, skillRoot)
    .filter((entry) => entry.path === skillRoot);
  if (rootEntries.length !== 1) {
    throw new Error(`Canonical skill is not tracked in source HEAD: ${skillRoot}`);
  }
  if (rootEntries[0].mode === '120000') {
    throw new Error(`Canonical skill root is a tracked symbolic link: ${skillRoot}`);
  }
  if (rootEntries[0].type !== 'tree' || rootEntries[0].mode !== '040000') {
    throw new Error(`Canonical skill root must be a tracked Git tree: ${skillRoot}`);
  }

  const output = requireGitSuccess(
    source.root.path,
    ['ls-tree', '-r', '-z', source.head, '--', `:(literal)${skillRoot}`],
    `Unable to enumerate canonical skill ${skillRoot}`,
    { binary: true },
  );
  const prefix = `${skillRoot}/`;
  const files = parseLsTree(output, skillRoot).map((entry) => {
    if (!entry.path.startsWith(prefix)) {
      throw new Error(`Tracked skill entry escaped its canonical tree: ${entry.path}`);
    }
    const relativePath = entry.path.slice(prefix.length);
    validatePortableRelativePath(relativePath, `Tracked skill path ${entry.path}`);
    assertSafeManagedPath(source.root, entry.path, `Tracked skill path ${entry.path}`);
    return {
      bytes: readHeadBlob(source, entry, `Tracked skill file ${entry.path}`),
      relativePath,
    };
  });

  if (files.length === 0 || !files.some((file) => file.relativePath === 'SKILL.md')) {
    throw new Error(`Canonical skill ${skillRoot} must contain a tracked SKILL.md in source HEAD.`);
  }
  return files.sort((left, right) => compareText(left.relativePath, right.relativePath));
}

function parseJsonBuffer(buffer, label) {
  const decoded = decodeUtf8(buffer, label);
  try {
    return JSON.parse(decoded.text);
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error.message}`);
  }
}

function assertGitRoot(rootInfo, label) {
  const inside = runGit(rootInfo.path, ['rev-parse', '--is-inside-work-tree']);
  if (inside.status !== 0 || inside.stdout.trim() !== 'true') {
    throw new Error(`${label} must be a Git worktree.`);
  }
  const topLevel = requireGitSuccess(
    rootInfo.path,
    ['rev-parse', '--show-toplevel'],
    `Unable to locate ${label} Git root`,
  ).trim();
  if (!sameFilesystemPath(realpathSync(topLevel), rootInfo.realPath)) {
    throw new Error(`${label} must be the root of its Git worktree.`);
  }
}

function getAttachedFeatureBranch(rootInfo, label) {
  const branchResult = runGit(rootInfo.path, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
  if (branchResult.status !== 0) {
    throw new Error(`${label} refuses a detached HEAD.`);
  }
  const branch = branchResult.stdout.trim();
  if (branch === 'main' || branch === 'staged') {
    throw new Error(`${label} refuses the ${branch} branch; use an attached feature branch.`);
  }
  return branch;
}

function assertTargetBasedOnUpstreamMain(rootInfo) {
  const upstreamResult = runGit(
    rootInfo.path,
    ['rev-parse', '--verify', '--quiet', 'upstream/main^{commit}'],
  );
  if (upstreamResult.status !== 0) {
    throw new Error('Awesome Copilot target requires the fetched ref upstream/main.');
  }

  const ancestorResult = runGit(
    rootInfo.path,
    ['merge-base', '--is-ancestor', 'upstream/main', 'HEAD'],
  );
  if (ancestorResult.status === 1) {
    throw new Error('Awesome Copilot target HEAD must be based on upstream/main.');
  }
  if (ancestorResult.status !== 0) {
    throw new Error(`Unable to verify upstream/main ancestry: ${gitErrorText(ancestorResult)}`);
  }
}

function assertNoStagedChanges(rootInfo, label) {
  const stagedResult = runGit(rootInfo.path, ['diff', '--cached', '--quiet', '--exit-code', '--']);
  if (stagedResult.status === 1) {
    throw new Error(`${label} refuses staged changes.`);
  }
  if (stagedResult.status !== 0) {
    throw new Error(`Unable to inspect staged changes in ${label}: ${gitErrorText(stagedResult)}`);
  }
}

function assertCleanWorktree(rootInfo, label) {
  const statusResult = runGit(rootInfo.path, ['status', '--porcelain=v1', '--untracked-files=all']);
  if (statusResult.status !== 0) {
    throw new Error(`Unable to inspect ${label}: ${gitErrorText(statusResult)}`);
  }
  if (statusResult.stdout.trim() !== '') {
    throw new Error(`${label} refuses a dirty worktree, including untracked files.`);
  }
}

function loadSource(sourceRoot) {
  const root = createRootInfo(sourceRoot, 'Canonical source root');
  assertGitRoot(root, 'Canonical source');
  const branch = getAttachedFeatureBranch(root, 'Canonical source');
  assertNoStagedChanges(root, 'Canonical source');
  assertCleanWorktree(root, 'Canonical source');
  const head = requireGitSuccess(
    root.path,
    ['rev-parse', '--verify', 'HEAD'],
    'Unable to resolve canonical source HEAD',
  ).trim();
  const source = { branch, head, root };
  const configBytes = readHeadFile(
    source,
    'eng/awesome-copilot-sync.json',
    'Synchronization manifest',
  );
  return {
    ...source,
    config: parseJsonBuffer(configBytes, 'Synchronization manifest'),
  };
}

function assertSlug(value, label) {
  if (typeof value !== 'string' || !SLUG_PATTERN.test(value)) {
    throw new Error(`${label} must match ${SLUG_PATTERN}; separators, dot segments, and drive forms are forbidden.`);
  }
}

function validateConfig(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error('Synchronization manifest must be a JSON object.');
  }
  if (!Array.isArray(config.agents) || config.agents.length === 0) {
    throw new Error('Synchronization manifest agents must be a non-empty array.');
  }
  const agentIds = new Set();
  for (const agentId of config.agents) {
    assertSlug(agentId, 'Synchronization manifest agent ID');
    if (agentIds.has(agentId)) {
      throw new Error(`Synchronization manifest contains duplicate agent ID "${agentId}".`);
    }
    agentIds.add(agentId);
  }

  if (!config.skill || typeof config.skill !== 'object' || Array.isArray(config.skill)) {
    throw new Error('Synchronization manifest must define skill.source and skill.target.');
  }
  assertSlug(config.skill.source, 'Synchronization manifest skill.source');
  assertSlug(config.skill.target, 'Synchronization manifest skill.target');

  if (!config.plugin || typeof config.plugin !== 'object' || Array.isArray(config.plugin)) {
    throw new Error('Synchronization manifest must define plugin.target and plugin.managedFields.');
  }
  assertSlug(config.plugin.target, 'Synchronization manifest plugin.target');
  if (!Array.isArray(config.plugin.managedFields) || config.plugin.managedFields.length === 0) {
    throw new Error('Synchronization manifest plugin.managedFields must be a non-empty array.');
  }
  const managedFields = new Set();
  for (const field of config.plugin.managedFields) {
    if (typeof field !== 'string'
      || !/^[A-Za-z][A-Za-z0-9]*$/.test(field)
      || field === '__proto__'
      || field === 'constructor'
      || field === 'prototype') {
      throw new Error(`Synchronization manifest has an invalid managed plugin field: ${String(field)}`);
    }
    if (managedFields.has(field)) {
      throw new Error(`Synchronization manifest contains duplicate managed plugin field "${field}".`);
    }
    managedFields.add(field);
  }
}

function verifyTarget(targetRoot) {
  const root = createRootInfo(targetRoot, 'Awesome Copilot target root');
  assertGitRoot(root, 'Awesome Copilot target');

  const packagePath = assertManagedRegularFile(root, 'package.json', 'Target package.json');
  const targetPackage = parseJson(packagePath, 'Target package.json');
  if (targetPackage.name !== 'awesome-copilot') {
    throw new Error(`Target package.json name must be "awesome-copilot"; found "${targetPackage.name ?? ''}".`);
  }

  for (const directory of ['agents', 'skills', 'plugins']) {
    assertManagedDirectory(root, directory, `Target ${directory}/ directory`);
  }
  return root;
}

function assertWriteSafe(targetRoot) {
  assertNoStagedChanges(targetRoot, 'Write mode target');
  assertCleanWorktree(targetRoot, 'Write mode target');
}

function listGitPaths(buffer, label) {
  const paths = [];
  let start = 0;
  for (let index = 0; index < buffer.length; index += 1) {
    if (buffer[index] !== 0) {
      continue;
    }
    paths.push(decodeGitText(buffer.subarray(start, index), label));
    start = index + 1;
  }
  return paths;
}

function parseNameStatus(buffer, label) {
  const fields = listGitPaths(buffer, label);
  const changes = [];
  for (let index = 0; index < fields.length;) {
    const status = fields[index];
    index += 1;
    if (!/^[AMD]$/.test(status)) {
      throw new Error(`${label} contains unsupported status "${status}".`);
    }
    if (index >= fields.length) {
      throw new Error(`${label} has incomplete name-status output.`);
    }
    changes.push({ path: fields[index], status });
    index += 1;
  }
  return changes;
}

function listWorktreeChanges(rootInfo, relativePaths = null) {
  const pathArguments = relativePaths === null
    ? []
    : ['--', ...relativePaths.map((relativePath) => `:(literal)${relativePath}`)];
  const output = requireGitSuccess(
    rootInfo.path,
    [
      'diff',
      '--name-status',
      '-z',
      '--no-renames',
      '--no-ext-diff',
      '--no-textconv',
      'HEAD',
      ...pathArguments,
    ],
    'Unable to inspect managed target changes',
    { binary: true },
  );
  const changes = parseNameStatus(output, 'Managed target diff');
  const untrackedOutput = requireGitSuccess(
    rootInfo.path,
    [
      'ls-files',
      '--others',
      '--exclude-standard',
      '-z',
      ...pathArguments,
    ],
    'Unable to inspect untracked managed target paths',
    { binary: true },
  );
  for (const untrackedPath of listGitPaths(untrackedOutput, 'Untracked managed target path')) {
    changes.push({ path: untrackedPath, status: 'A' });
  }
  return changes;
}

function listTrackedTargetFiles(targetRoot) {
  const output = requireGitSuccess(
    targetRoot.path,
    ['ls-files', '-z'],
    'Unable to enumerate tracked target files',
    { binary: true },
  );
  return new Set(listGitPaths(output, 'Tracked target path'));
}

function isTargetPathIgnored(targetRoot, relativePath) {
  validatePortableRelativePath(relativePath, `Target path ${relativePath}`);
  const result = runGit(targetRoot.path, ['check-ignore', '-q', '--', relativePath]);
  if (result.status === 0) {
    return true;
  }
  if (result.status === 1) {
    return false;
  }
  throw new Error(`Unable to inspect ignore rules for ${relativePath}: ${gitErrorText(result)}`);
}

function addDesiredFile(plan, relativePath, bytes) {
  try {
    assertSafeManagedPath(plan.targetRoot, relativePath, `Synchronization target ${relativePath}`);
  } catch (error) {
    plan.blockers.push(error.message);
  }
  const destinationKey = process.platform === 'win32' ? relativePath.toLowerCase() : relativePath;
  if (plan.destinationKeys.has(destinationKey)) {
    throw new Error(`Duplicate synchronization destination: ${relativePath}`);
  }
  plan.destinationKeys.add(destinationKey);
  plan.desired.push({ bytes, relativePath });
}

function buildPlan(source, targetRoot, config) {
  const plan = {
    blockers: [],
    desired: [],
    destinationKeys: new Set(),
    expectedSkillFiles: new Set(),
    pluginVersion: '',
    targetSkillRoot: targetRelativePath('skills', config.skill.target),
    sourceHead: source.head,
    targetRoot,
    trackedTargetFiles: listTrackedTargetFiles(targetRoot),
  };

  for (const agentId of config.agents) {
    const fileName = `${agentId}.agent.md`;
    const relativePath = targetRelativePath('agents', fileName);
    const sourceBytes = readHeadFile(source, relativePath, `Canonical agent ${relativePath}`);
    addDesiredFile(plan, relativePath, normalizeTextBuffer(sourceBytes, relativePath));
  }

  const sourceSkillFiles = listHeadSkillFiles(source, config.skill.source);
  plan.expectedSkillFiles = new Set(sourceSkillFiles.map((file) => file.relativePath));
  for (const sourceFile of sourceSkillFiles) {
    const label = targetRelativePath('skills', config.skill.source, sourceFile.relativePath);
    const expectedBytes = sourceFile.relativePath === 'SKILL.md'
      ? transformSkillBuffer(
        sourceFile.bytes,
        config.skill.source,
        config.skill.target,
        label,
      )
      : normalizePortableBuffer(sourceFile.bytes, label, sourceFile.relativePath);
    addDesiredFile(
      plan,
      targetRelativePath('skills', config.skill.target, sourceFile.relativePath),
      expectedBytes,
    );
  }

  const sourcePlugin = parseJsonBuffer(
    readHeadFile(source, 'plugin.json', 'Canonical plugin.json'),
    'Canonical plugin.json',
  );
  if (!sourcePlugin || typeof sourcePlugin !== 'object' || Array.isArray(sourcePlugin)) {
    throw new Error('Canonical plugin.json must contain a JSON object.');
  }
  if (typeof sourcePlugin.version !== 'string' || sourcePlugin.version.trim() === '') {
    throw new Error('Canonical plugin.json must contain a non-empty version for provenance reporting.');
  }
  plan.pluginVersion = sourcePlugin.version;

  const targetPluginRelative = targetRelativePath(
    'plugins',
    config.plugin.target,
    '.github',
    'plugin',
    'plugin.json',
  );
  let targetPluginPath;
  try {
    targetPluginPath = assertSafeManagedPath(
      targetRoot,
      targetPluginRelative,
      'Target plugin manifest',
    );
  } catch (error) {
    plan.blockers.push(error.message);
    addDesiredFile(plan, targetPluginRelative, null);
  }
  if (!targetPluginPath) {
    plan.desired.sort((left, right) => compareText(left.relativePath, right.relativePath));
    return plan;
  }
  const targetPluginStat = tryLstat(targetPluginPath);
  if (!targetPluginStat) {
    plan.blockers.push(`Cannot safely create missing target plugin manifest: ${targetPluginRelative}`);
    addDesiredFile(plan, targetPluginRelative, null);
  } else if (!targetPluginStat.isFile()) {
    plan.blockers.push(`Target plugin manifest is not a regular file: ${targetPluginRelative}`);
    addDesiredFile(plan, targetPluginRelative, null);
  } else {
    const targetPlugin = parseJson(targetPluginPath, 'Target plugin manifest');
    if (!targetPlugin || typeof targetPlugin !== 'object' || Array.isArray(targetPlugin)) {
      throw new Error('Target plugin manifest must contain a JSON object.');
    }

    for (const field of config.plugin.managedFields) {
      if (!Object.hasOwn(sourcePlugin, field)) {
        throw new Error(`Canonical plugin.json is missing managed field "${field}".`);
      }
      targetPlugin[field] = cloneJsonValue(sourcePlugin[field]);
    }

    addDesiredFile(
      plan,
      targetPluginRelative,
      Buffer.from(`${JSON.stringify(targetPlugin, null, 2)}\n`, 'utf8'),
    );
  }

  plan.desired.sort((left, right) => compareText(left.relativePath, right.relativePath));
  return plan;
}

function unmanagedTargetBlocker(plan, relativePath) {
  const ignored = isTargetPathIgnored(plan.targetRoot, relativePath);
  return `Refusing unmanaged ${ignored ? 'ignored' : 'untracked'} target path: ${relativePath}`;
}

function inspectPlan(plan, allowedCreatedPaths = new Set()) {
  const blockers = [...plan.blockers];
  const drift = [];

  for (const file of plan.desired) {
    let absolutePath;
    try {
      absolutePath = assertSafeManagedPath(
        plan.targetRoot,
        file.relativePath,
        `Managed target ${file.relativePath}`,
      );
    } catch (error) {
      blockers.push(error.message);
      continue;
    }
    const targetStat = tryLstat(absolutePath);
    if (!targetStat) {
      if (isTargetPathIgnored(plan.targetRoot, file.relativePath)) {
        blockers.push(`Refusing desired target path excluded by ignore rules: ${file.relativePath}`);
      }
      drift.push({ kind: 'missing', relativePath: file.relativePath });
      continue;
    }
    if (!targetStat.isFile()) {
      blockers.push(`Refusing non-regular managed target path: ${file.relativePath}`);
      continue;
    }
    if (targetStat.nlink !== 1) {
      blockers.push(`Refusing hard-linked managed target file (link count ${targetStat.nlink}): ${file.relativePath}`);
      continue;
    }

    const matchesDesiredBytes = file.bytes !== null
      && readFileSync(absolutePath).equals(file.bytes);
    const isTracked = plan.trackedTargetFiles.has(file.relativePath)
      || allowedCreatedPaths.has(file.relativePath)
      || (!isTargetPathIgnored(plan.targetRoot, file.relativePath) && matchesDesiredBytes);
    if (!isTracked) {
      blockers.push(unmanagedTargetBlocker(plan, file.relativePath));
      continue;
    }
    if (!matchesDesiredBytes) {
      drift.push({ kind: 'changed', relativePath: file.relativePath });
    }
  }

  const extraFiles = listFilesStrict(plan.targetRoot, plan.targetSkillRoot, blockers)
    .filter((relativePath) => !plan.expectedSkillFiles.has(relativePath))
    .map((relativePath) => ({
      relativePath: targetRelativePath(plan.targetSkillRoot, relativePath),
    }));
  for (const file of extraFiles) {
    let absolutePath;
    try {
      absolutePath = assertSafeManagedPath(
        plan.targetRoot,
        file.relativePath,
        `Stale managed target ${file.relativePath}`,
      );
    } catch (error) {
      blockers.push(error.message);
      continue;
    }
    const targetStat = tryLstat(absolutePath);
    if (!targetStat) {
      continue;
    }
    if (!targetStat.isFile()) {
      blockers.push(`Refusing non-regular stale target path: ${file.relativePath}`);
      continue;
    }
    if (targetStat.nlink !== 1) {
      blockers.push(`Refusing hard-linked stale target file (link count ${targetStat.nlink}): ${file.relativePath}`);
      continue;
    }
    if (!plan.trackedTargetFiles.has(file.relativePath)) {
      blockers.push(unmanagedTargetBlocker(plan, file.relativePath));
      continue;
    }
    drift.push({ kind: 'extra', relativePath: file.relativePath });
  }

  const uniqueBlockers = [...new Set(blockers)].sort(compareText);
  drift.sort((left, right) => {
    const pathComparison = compareText(left.relativePath, right.relativePath);
    return pathComparison !== 0 ? pathComparison : compareText(left.kind, right.kind);
  });
  return { blockers: uniqueBlockers, drift };
}

function plannedActions(inspection) {
  return inspection.drift.map((item) => ({
    kind: item.kind === 'extra' ? 'remove' : item.kind === 'missing' ? 'create' : 'update',
    relativePath: item.relativePath,
  }));
}

function expectedPatchChanges(actions) {
  return actions.map((action) => ({
    path: action.relativePath,
    status: action.kind === 'remove' ? 'D' : action.kind === 'create' ? 'A' : 'M',
  })).sort((left, right) => compareText(left.path, right.path));
}

function assertExpectedChanges(actual, expected, label) {
  const normalizedActual = [...actual]
    .sort((left, right) => compareText(left.path, right.path));
  if (JSON.stringify(normalizedActual) !== JSON.stringify(expected)) {
    const format = (changes) => changes.length === 0
      ? '(none)'
      : changes.map((change) => `${change.status} ${change.path}`).join(', ');
    throw new Error(`${label} did not match the planned managed change set; expected ${format(expected)}, found ${format(normalizedActual)}.`);
  }
}

function createPatchClone(plan, actions) {
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'ai-team-awesome-patch-'));
  const cloneRoot = path.join(temporaryRoot, 'target');
  let completed = false;
  try {
    const cloneResult = runGit(
      null,
      ['clone', '--no-hardlinks', '--no-checkout', '--', plan.targetRoot.realPath, cloneRoot],
    );
    if (cloneResult.status !== 0) {
      throw new Error(`Unable to create private target clone: ${gitErrorText(cloneResult)}`);
    }
    const cloneInfo = createRootInfo(cloneRoot, 'Private patch clone');
    writeFileSync(
      path.join(cloneInfo.path, '.git', 'info', 'attributes'),
      '* -text -filter -diff -ident -working-tree-encoding\n',
    );
    const targetHead = requireGitSuccess(
      plan.targetRoot.path,
      ['rev-parse', '--verify', 'HEAD'],
      'Unable to resolve target HEAD',
    ).trim();
    requireGitSuccess(
      cloneInfo.path,
      ['checkout', '--detach', '--force', targetHead],
      'Unable to check out target HEAD in private clone',
    );

    const desiredByPath = new Map(plan.desired.map((file) => [file.relativePath, file]));
    for (const action of actions) {
      const temporaryPath = assertSafeManagedPath(
        cloneInfo,
        action.relativePath,
        `Private patch path ${action.relativePath}`,
      );
      const temporaryStat = tryLstat(temporaryPath);
      if (action.kind === 'remove') {
        if (!temporaryStat || !temporaryStat.isFile() || temporaryStat.isSymbolicLink()) {
          throw new Error(`Private patch deletion is not a regular file: ${action.relativePath}`);
        }
        rmSync(temporaryPath);
        continue;
      }

      const desired = desiredByPath.get(action.relativePath);
      if (!desired || desired.bytes === null) {
        throw new Error(`No safe desired content is available for ${action.relativePath}.`);
      }
      if (temporaryStat && (!temporaryStat.isFile() || temporaryStat.isSymbolicLink())) {
        throw new Error(`Private patch destination is not a regular file: ${action.relativePath}`);
      }
      mkdirSync(path.dirname(temporaryPath), { recursive: true });
      writeFileSync(temporaryPath, desired.bytes);
    }

    const managedPaths = actions.map((action) => action.relativePath).sort(compareText);
    const actualChanges = listWorktreeChanges(cloneInfo, managedPaths);
    const expectedChanges = expectedPatchChanges(actions);
    assertExpectedChanges(actualChanges, expectedChanges, 'Private patch diff');
    const trackedPatch = requireGitSuccess(
      cloneInfo.path,
      [
        'diff',
        '--binary',
        '--full-index',
        '--no-renames',
        '--no-ext-diff',
        '--no-textconv',
        'HEAD',
        '--',
        ...managedPaths.map((relativePath) => `:(literal)${relativePath}`),
      ],
      'Unable to generate managed synchronization patch',
      { binary: true },
    );
    const patchParts = [trackedPatch];
    for (const action of actions.filter((candidate) => candidate.kind === 'create')) {
      const createResult = runGit(
        cloneInfo.path,
        [
          'diff',
          '--no-index',
          '--binary',
          '--full-index',
          '--no-ext-diff',
          '--no-textconv',
          '--',
          '/dev/null',
          action.relativePath,
        ],
        { binary: true },
      );
      if (createResult.status !== 1) {
        throw new Error(`Unable to generate creation patch for ${action.relativePath}: ${gitErrorText(createResult) || `git exited ${createResult.status}`}`);
      }
      patchParts.push(createResult.stdout);
    }
    const patch = Buffer.concat(patchParts.filter((part) => part.length > 0));
    if (patch.length === 0) {
      throw new Error('Managed synchronization patch was unexpectedly empty.');
    }
    requireGitSuccess(
      cloneInfo.path,
      ['reset', '--hard', 'HEAD'],
      'Unable to reset private clone before patch verification',
    );
    requireGitSuccess(
      cloneInfo.path,
      ['clean', '-fdx'],
      'Unable to clean private clone before patch verification',
    );
    applyGitPatch(cloneInfo, patch, true);
    applyGitPatch(cloneInfo, patch, false);
    assertExpectedChanges(
      listWorktreeChanges(cloneInfo),
      expectedChanges,
      'Generated patch name-status',
    );
    completed = true;
    return { patch, temporaryRoot };
  } finally {
    if (!completed) {
      rmSync(temporaryRoot, { force: true, recursive: true });
    }
  }
}

function applyGitPatch(targetRoot, patch, checkOnly) {
  const argumentsList = ['-c', 'core.autocrlf=false', '-c', 'core.eol=lf', 'apply'];
  if (checkOnly) {
    argumentsList.push('--check');
  }
  argumentsList.push('--whitespace=nowarn', '-');
  const result = runGit(targetRoot.path, argumentsList, { binary: true, input: patch });
  if (result.status !== 0) {
    const operation = checkOnly ? 'validate' : 'apply';
    throw new Error(`Unable to ${operation} managed synchronization patch: ${gitErrorText(result) || `git exited ${result.status}`}`);
  }
}

function applyPlan(plan, inspection, logger) {
  if (inspection.blockers.length > 0) {
    throw new Error(inspection.blockers.join('\n'));
  }

  const actions = plannedActions(inspection);
  if (actions.length === 0) {
    logger('Awesome Copilot checkout is already aligned.');
    return actions;
  }

  let patchWorkspace;
  try {
    patchWorkspace = createPatchClone(plan, actions);
    applyGitPatch(plan.targetRoot, patchWorkspace.patch, true);
    applyGitPatch(plan.targetRoot, patchWorkspace.patch, false);
  } finally {
    if (patchWorkspace) {
      rmSync(patchWorkspace.temporaryRoot, { force: true, recursive: true });
    }
  }

  plan.trackedTargetFiles = listTrackedTargetFiles(plan.targetRoot);
  const remaining = inspectPlan(plan, new Set(
    actions.filter((action) => action.kind === 'create').map((action) => action.relativePath),
  ));
  if (remaining.blockers.length > 0 || remaining.drift.length > 0) {
    const details = [
      ...remaining.blockers.map((blocker) => `BLOCKER ${blocker}`),
      ...remaining.drift.map((item) => `${item.kind.toUpperCase()} ${item.relativePath}`),
    ].join('\n');
    throw new Error(`Synchronization did not converge:\n${details}`);
  }

  const expectedChanges = expectedPatchChanges(actions);
  const targetChanges = listWorktreeChanges(plan.targetRoot);
  assertExpectedChanges(targetChanges, expectedChanges, 'Applied target diff');
  for (const action of actions) {
    logger(`${action.kind.toUpperCase()} ${action.relativePath}`);
  }
  logger(`Applied ${actions.length} managed synchronization action${actions.length === 1 ? '' : 's'}.`);
  return actions;
}

function logProvenance(plan, logger) {
  logger(`Source HEAD: ${plan.sourceHead}`);
  logger(`Plugin version: ${plan.pluginVersion}`);
}

export function syncAwesomeCopilot({
  targetRoot,
  write = false,
  sourceRoot = DEFAULT_SOURCE_ROOT,
  logger = console.log,
}) {
  if (!targetRoot) {
    throw new Error('A target Awesome Copilot checkout is required.');
  }

  const source = loadSource(sourceRoot);
  validateConfig(source.config);
  const verifiedTargetRoot = verifyTarget(targetRoot);
  getAttachedFeatureBranch(verifiedTargetRoot, write ? 'Write mode target' : 'Check mode target');
  assertTargetBasedOnUpstreamMain(verifiedTargetRoot);

  const plan = buildPlan(source, verifiedTargetRoot, source.config);
  const inspection = inspectPlan(plan);

  if (!write) {
    for (const blocker of inspection.blockers) {
      logger(`BLOCKER ${blocker}`);
    }
    for (const item of inspection.drift) {
      logger(`${item.kind.toUpperCase()} ${item.relativePath}`);
    }
    const aligned = inspection.blockers.length === 0 && inspection.drift.length === 0;
    if (aligned) {
      logger('Awesome Copilot checkout is aligned.');
    } else {
      logger(`Awesome Copilot checkout has ${inspection.drift.length} managed drift item${inspection.drift.length === 1 ? '' : 's'} and ${inspection.blockers.length} blocker${inspection.blockers.length === 1 ? '' : 's'}.`);
    }
    logProvenance(plan, logger);
    return {
      actions: [],
      aligned,
      blockers: inspection.blockers,
      drift: inspection.drift,
      pluginVersion: plan.pluginVersion,
      sourceHead: plan.sourceHead,
    };
  }

  if (inspection.blockers.length > 0) {
    throw new Error(inspection.blockers.join('\n'));
  }
  assertWriteSafe(verifiedTargetRoot);
  getAttachedFeatureBranch(verifiedTargetRoot, 'Write mode target');
  assertTargetBasedOnUpstreamMain(verifiedTargetRoot);
  const finalInspection = inspectPlan(plan);
  const actions = applyPlan(plan, finalInspection, logger);
  logProvenance(plan, logger);
  return {
    actions,
    aligned: true,
    blockers: [],
    drift: [],
    pluginVersion: plan.pluginVersion,
    sourceHead: plan.sourceHead,
  };
}

function usage() {
  return [
    'Usage: node eng/sync-awesome-copilot.mjs --target <checkout> [--write]',
    '',
    'Without --write, the command checks for managed drift.',
    'AWESOME_COPILOT_ROOT may be used instead of --target.',
  ].join('\n');
}

function parseArguments(argumentsList, environment) {
  let targetRoot = environment.AWESOME_COPILOT_ROOT;
  let write = false;
  let help = false;

  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (argument === '--write') {
      write = true;
    } else if (argument === '--help' || argument === '-h') {
      help = true;
    } else if (argument === '--target') {
      index += 1;
      if (index >= argumentsList.length || argumentsList[index].startsWith('--')) {
        throw new Error('--target requires a checkout path.');
      }
      targetRoot = argumentsList[index];
    } else if (argument.startsWith('--target=')) {
      targetRoot = argument.slice('--target='.length);
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }

  if (!help && (!targetRoot || targetRoot.trim() === '')) {
    throw new Error('Missing --target <checkout>; alternatively set AWESOME_COPILOT_ROOT.');
  }

  return { help, targetRoot, write };
}

function isDirectExecution() {
  if (!process.argv[1]) {
    return false;
  }
  const left = path.resolve(process.argv[1]);
  const right = path.resolve(SCRIPT_PATH);
  return process.platform === 'win32'
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
}

if (isDirectExecution()) {
  try {
    const options = parseArguments(process.argv.slice(2), process.env);
    if (options.help) {
      console.log(usage());
    } else {
      const result = syncAwesomeCopilot(options);
      if (!options.write && !result.aligned) {
        process.exitCode = 1;
      }
    }
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    process.exitCode = 1;
  }
}
