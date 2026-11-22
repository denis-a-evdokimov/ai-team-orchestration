import { createHash } from 'node:crypto';
import {
  lstatSync,
  readFileSync,
  readdirSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  assertManagedDirectory,
  createRootInfo,
  isContainedPath,
  tryLstat,
} from './path-safety.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PLUGIN_NAME = 'ai-team-orchestration';
const SKILL_NAME = 'ai-team-orchestration';
const PLUGIN_ROOT_PATH = `plugins/${PLUGIN_NAME}`;
const PLUGIN_ROOT = path.join(REPO_ROOT, ...PLUGIN_ROOT_PATH.split('/'));
const AGENTS_PATH = 'com.github.copilot/agents';
const SKILL_PATH = `skills/${SKILL_NAME}`;
const EXPECTED_AGENT_IDS = Object.freeze([
  'ai-team-dev',
  'ai-team-producer',
  'ai-team-qa',
]);
const SKILL_REFERENCES = Object.freeze([
  'anti-patterns.md',
  'brainstorm-format.md',
  'project-brief-template.md',
  'sprint-plan-template.md',
]);
// The plugin root is the installed payload. Installs copy every file in it.
const PLUGIN_FILES = Object.freeze([
  'README.md',
  'plugin.json',
  ...EXPECTED_AGENT_IDS.map((id) => `${AGENTS_PATH}/${id}.md`),
  `${SKILL_PATH}/SKILL.md`,
  ...SKILL_REFERENCES.map((fileName) => `${SKILL_PATH}/references/${fileName}`),
].sort());
const RESERVED_FILE_NAMES = new Set([
  'plugin.json',
  'SKILL.md',
  ...EXPECTED_AGENT_IDS.map((id) => `${id}.md`),
]);
const AGENT_FRONTMATTER_FIELDS = new Set(['name', 'description', 'include-custom-instructions']);
const SKILL_FRONTMATTER_FIELDS = new Set(['name', 'description']);
const AGENT_PLUGIN_SCHEMA_URL = 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json';
const AGENT_PLUGIN_FIELDS = new Set([
  '$schema',
  'name',
  'version',
  'description',
  'author',
  'homepage',
  'repository',
  'license',
  'keywords',
  'extensions',
]);
const AGENT_PLUGIN_AUTHOR_FIELDS = new Set(['name', 'email', 'url']);
const SLUG_PATTERN = /^[a-z0-9-]+$/;
const DESCRIPTION_MAX_LENGTH = 1024;
const PAYLOAD_FILE_MAX_BYTES = 5 * 1024 * 1024;
const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const TEXT_EXTENSIONS = new Set([
  '.cjs',
  '.js',
  '.json',
  '.md',
  '.mjs',
  '.txt',
  '.yaml',
  '.yml',
]);

const errors = [];

function addError(message) {
  errors.push(message);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizedText(buffer) {
  return buffer.toString('utf8').replace(/\r\n?/g, '\n');
}

function payloadLabel(relativePath) {
  return `${PLUGIN_ROOT_PATH}/${relativePath}`;
}

// Payload: every installed file must be an expected, regular, non-linked file.

function collectPayloadFiles(directory, relativeDirectory, files) {
  for (const name of readdirSync(directory).sort()) {
    const relativePath = relativeDirectory ? `${relativeDirectory}/${name}` : name;
    const absolutePath = path.join(directory, name);
    const entryStat = lstatSync(absolutePath);
    if (entryStat.isSymbolicLink()) {
      addError(`${payloadLabel(relativePath)} must not be a symbolic link, junction, or reparse point.`);
    } else if (entryStat.isDirectory()) {
      collectPayloadFiles(absolutePath, relativePath, files);
    } else if (!entryStat.isFile()) {
      addError(`${payloadLabel(relativePath)} must be a regular file or directory.`);
    } else if (entryStat.nlink !== 1) {
      addError(`${payloadLabel(relativePath)} must not be hard-linked.`);
    } else if (entryStat.size > PAYLOAD_FILE_MAX_BYTES) {
      addError(`${payloadLabel(relativePath)} exceeds the ${PAYLOAD_FILE_MAX_BYTES}-byte file limit.`);
    } else {
      files.push(relativePath);
    }
  }
  return files;
}

function validatePayload() {
  try {
    assertManagedDirectory(createRootInfo(REPO_ROOT, 'Repository root'), PLUGIN_ROOT_PATH, PLUGIN_ROOT_PATH);
  } catch (error) {
    addError(error.message);
    return new Set();
  }

  const expectedFiles = new Set(PLUGIN_FILES);
  const regularFiles = collectPayloadFiles(PLUGIN_ROOT, '', []);
  for (const relativePath of regularFiles.filter((file) => !expectedFiles.has(file))) {
    addError(`${payloadLabel(relativePath)} is not part of the plugin file set. Installs copy every file in ${PLUGIN_ROOT_PATH}.`);
  }
  const vettedFiles = new Set(regularFiles.filter((file) => expectedFiles.has(file)));
  for (const relativePath of PLUGIN_FILES.filter((file) => !vettedFiles.has(file))) {
    addError(`${payloadLabel(relativePath)} is missing or is not a regular file.`);
  }
  return vettedFiles;
}

function readPayloadText(vettedFiles, relativePath) {
  if (!vettedFiles.has(relativePath)) {
    return null;
  }
  return normalizedText(readFileSync(path.join(PLUGIN_ROOT, ...relativePath.split('/'))));
}

// Frontmatter: the constrained subset that this repository relies on.

function parseFrontmatter(contents, label, allowedFields) {
  const lines = contents.split('\n');
  if (lines[0] !== '---') {
    addError(`${label} must start with YAML frontmatter.`);
    return null;
  }

  const closingIndex = lines.indexOf('---', 1);
  if (closingIndex === -1) {
    addError(`${label} has unterminated YAML frontmatter.`);
    return null;
  }

  const fields = new Map();
  const fieldLines = lines.slice(1, closingIndex);
  for (const line of fieldLines.filter((candidate) => candidate.trim() !== '')) {
    const match = /^([A-Za-z][A-Za-z0-9-]*):(?:[ \t]+(.*))?$/.exec(line);
    if (!match) {
      addError(`${label} contains unsupported frontmatter syntax: ${line}`);
      continue;
    }

    const [, key, value = ''] = match;
    if (fields.has(key)) {
      addError(`${label} has duplicate frontmatter field "${key}".`);
    } else if (!allowedFields.has(key)) {
      addError(`${label} contains unsupported frontmatter field "${key}".`);
    } else {
      fields.set(key, value.replace(/[ \t]+$/, ''));
    }
  }

  return { fields, fieldLines };
}

function scalarValue(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const match = /^(['"])(.*)\1$/.exec(value.trim());
  return match ? match[2] : value.trim();
}

function quotedValue(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const match = /^(['"])(.*)\1$/.exec(value.trim());
  return match ? match[2] : null;
}

// Manifest: Agent Plugins 1.0 fields only.

function loadManifest(vettedFiles) {
  const contents = readPayloadText(vettedFiles, 'plugin.json');
  if (contents === null) {
    return null;
  }

  let manifest;
  try {
    manifest = JSON.parse(contents);
  } catch (error) {
    addError(`${payloadLabel('plugin.json')} is not valid JSON: ${error.message}`);
    return null;
  }
  if (!isPlainObject(manifest)) {
    addError(`${payloadLabel('plugin.json')} must contain a JSON object.`);
    return null;
  }
  return manifest;
}

function validateManifestIdentity(manifest, label) {
  for (const field of Object.keys(manifest).filter((key) => !AGENT_PLUGIN_FIELDS.has(key))) {
    addError(`${label} top-level field "${field}" is not part of Agent Plugins 1.0.`);
  }
  if (manifest.$schema !== AGENT_PLUGIN_SCHEMA_URL) {
    addError(`${label} field "$schema" must be exactly "${AGENT_PLUGIN_SCHEMA_URL}".`);
  }
  if (manifest.name !== PLUGIN_NAME) {
    addError(`${label} field "name" must be exactly "${PLUGIN_NAME}".`);
  }
}

function validateManifestStrings(manifest, label) {
  for (const field of ['description', 'version', 'repository', 'license']) {
    if (!isNonEmptyString(manifest[field])) {
      addError(`${label} field "${field}" must be a non-empty string.`);
    }
  }
  if (typeof manifest.description === 'string' && manifest.description.length > 500) {
    addError(`${label} field "description" must not exceed 500 characters.`);
  }
  if (typeof manifest.version === 'string' && !SEMVER_PATTERN.test(manifest.version)) {
    addError(`${label} version "${manifest.version}" is not valid SemVer.`);
  }
}

function validateManifestLinks(manifest, label) {
  if (isNonEmptyString(manifest.repository) && !manifest.repository.startsWith('https://github.com/')) {
    addError(`${label} field "repository" must be an https://github.com/ URL.`);
  }
  if (manifest.homepage !== undefined && !isNonEmptyString(manifest.homepage)) {
    addError(`${label} field "homepage" must be a non-empty string when present.`);
  }
  if (manifest.extensions !== undefined
    && (!isPlainObject(manifest.extensions) || !Object.values(manifest.extensions).every(isPlainObject))) {
    addError(`${label} field "extensions" must map namespaces to objects.`);
  }
}

function isValidKeyword(keyword) {
  return typeof keyword === 'string'
    && keyword.length >= 1
    && keyword.length <= 30
    && SLUG_PATTERN.test(keyword);
}

function validateManifestPeople(manifest, label) {
  const { keywords, author } = manifest;
  if (!Array.isArray(keywords) || keywords.length === 0 || keywords.length > 10 || !keywords.every(isValidKeyword)) {
    addError(`${label} field "keywords" must contain 1-10 lowercase slugs no longer than 30 characters.`);
  }

  const validAuthor = isPlainObject(author)
    && isNonEmptyString(author.name)
    && Object.entries(author).every(([field, value]) => AGENT_PLUGIN_AUTHOR_FIELDS.has(field) && typeof value === 'string');
  if (!validAuthor) {
    addError(`${label} field "author" must be an object with a non-empty name and only string name, email, and url fields.`);
  }
}

function validateManifest(vettedFiles) {
  const manifest = loadManifest(vettedFiles);
  if (!manifest) {
    return;
  }

  const label = payloadLabel('plugin.json');
  validateManifestIdentity(manifest, label);
  validateManifestStrings(manifest, label);
  validateManifestLinks(manifest, label);
  validateManifestPeople(manifest, label);
}

// Agents and skill.

function validateAgent(vettedFiles, agentId) {
  const relativePath = `${AGENTS_PATH}/${agentId}.md`;
  const contents = readPayloadText(vettedFiles, relativePath);
  const label = payloadLabel(relativePath);
  const frontmatter = contents === null ? null : parseFrontmatter(contents, label, AGENT_FRONTMATTER_FIELDS);
  if (!frontmatter) {
    return;
  }

  const { fields } = frontmatter;
  const frontmatterName = quotedValue(fields.get('name'));
  if (frontmatterName === null) {
    addError(`${label} frontmatter name must be quoted.`);
  } else if (frontmatterName !== agentId) {
    addError(`${label} filename ID "${agentId}" does not match frontmatter name "${frontmatterName}".`);
  }

  const description = quotedValue(fields.get('description'));
  if (description === null || description.trim() === '' || description.length > DESCRIPTION_MAX_LENGTH) {
    addError(`${label} frontmatter description must be matching-quoted, non-empty, and no longer than ${DESCRIPTION_MAX_LENGTH} characters.`);
  }

  if (fields.get('include-custom-instructions') !== 'true') {
    addError(`${label} frontmatter must contain exactly "include-custom-instructions: true".`);
  }
}

function validateSkill(vettedFiles) {
  const relativePath = `${SKILL_PATH}/SKILL.md`;
  const contents = readPayloadText(vettedFiles, relativePath);
  const label = payloadLabel(relativePath);
  const frontmatter = contents === null ? null : parseFrontmatter(contents, label, SKILL_FRONTMATTER_FIELDS);
  if (!frontmatter) {
    return;
  }

  const { fields, fieldLines } = frontmatter;
  const frontmatterName = scalarValue(fields.get('name'));
  if (frontmatterName !== SKILL_NAME) {
    addError(`${label} frontmatter name "${frontmatterName ?? ''}" must match folder name "${SKILL_NAME}".`);
  }
  const nameLines = fieldLines.filter((line) => /^\s*name\s*:/.test(line));
  if (nameLines.length !== 1 || nameLines[0] !== `name: ${SKILL_NAME}`) {
    addError(`${label} frontmatter name line must be exactly "name: ${SKILL_NAME}".`);
  }

  const description = quotedValue(fields.get('description'));
  if (description === null || description.length < 10 || description.length > DESCRIPTION_MAX_LENGTH) {
    addError(`${label} frontmatter description must be matching-quoted and between 10 and ${DESCRIPTION_MAX_LENGTH} characters.`);
  }
}

// Repository: one copy of the plugin, valid links, and no legacy references.

function walkRepository(directory, relativeDirectory, entries) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (relativeDirectory === '' && (entry.name === '.git' || entry.name === 'node_modules')) {
      continue;
    }

    const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      walkRepository(absolutePath, relativePath, entries);
    } else {
      entries.push({ absolutePath, relativePath, isFile: entry.isFile() });
    }
  }
  return entries;
}

function contentHash(buffer) {
  return createHash('sha256').update(normalizedText(buffer), 'utf8').digest('hex');
}

function payloadHashes(vettedFiles) {
  const hashes = new Map();
  for (const relativePath of vettedFiles) {
    hashes.set(contentHash(readFileSync(path.join(PLUGIN_ROOT, ...relativePath.split('/')))), relativePath);
  }
  return hashes;
}

function validateSingleCopy(entries, vettedFiles) {
  const hashes = payloadHashes(vettedFiles);
  for (const entry of entries.filter((candidate) => !isContainedPath(PLUGIN_ROOT, candidate.absolutePath, false))) {
    const fileName = path.posix.basename(entry.relativePath);
    if (RESERVED_FILE_NAMES.has(fileName) || fileName.endsWith('.agent.md')) {
      addError(`${entry.relativePath} is plugin content outside ${PLUGIN_ROOT_PATH}; keep exactly one copy in the plugin root.`);
      continue;
    }
    const duplicateOf = entry.isFile ? hashes.get(contentHash(readFileSync(entry.absolutePath))) : undefined;
    if (duplicateOf) {
      addError(`${entry.relativePath} duplicates ${payloadLabel(duplicateOf)}; keep exactly one copy in the plugin root.`);
    }
  }
}

function markdownDestinations(markdown) {
  const destinations = [];
  const inlinePattern = /!?\[[^\]]*\]\(\s*(<[^>]+>|[^\s)]+)(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*\)/g;
  const definitionPattern = /^\s*\[[^\]]+\]:\s*(<[^>]+>|\S+)/gm;

  for (const pattern of [inlinePattern, definitionPattern]) {
    for (const match of markdown.matchAll(pattern)) {
      const destination = match[1];
      destinations.push(destination.startsWith('<') && destination.endsWith('>') ? destination.slice(1, -1) : destination);
    }
  }
  return destinations;
}

function isExternalDestination(destination) {
  return !destination
    || destination.startsWith('#')
    || destination.startsWith('//')
    || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(destination);
}

function linkTargetExists(vettedFiles, resolvedPath, inPlugin) {
  if (inPlugin) {
    const relativePath = path.relative(PLUGIN_ROOT, resolvedPath).split(path.sep).join('/');
    return relativePath === ''
      || vettedFiles.has(relativePath)
      || [...vettedFiles].some((file) => file.startsWith(`${relativePath}/`));
  }
  return Boolean(tryLstat(resolvedPath));
}

function decodeLinkPath(entry, destination) {
  try {
    return decodeURIComponent(destination.split(/[?#]/, 1)[0]);
  } catch {
    addError(`${entry.relativePath} has an invalid encoded Markdown link: ${destination}`);
    return null;
  }
}

function validateLink(entry, destination, vettedFiles) {
  const decodedPath = decodeLinkPath(entry, destination);
  if (decodedPath === null) {
    return;
  }

  const inPlugin = isContainedPath(PLUGIN_ROOT, entry.absolutePath, false);
  const rootRelative = decodedPath.startsWith('/');
  if (inPlugin && rootRelative) {
    addError(`${entry.relativePath} has a root-relative link, which installed copies cannot resolve: ${destination}`);
    return;
  }

  const resolvedPath = rootRelative
    ? path.join(REPO_ROOT, ...decodedPath.split('/'))
    : path.resolve(path.dirname(entry.absolutePath), decodedPath);
  const allowedRoot = inPlugin ? PLUGIN_ROOT : REPO_ROOT;
  if (!isContainedPath(allowedRoot, resolvedPath, true)) {
    addError(inPlugin
      ? `${entry.relativePath} links outside ${PLUGIN_ROOT_PATH}, which installed copies do not contain: ${destination}`
      : `${entry.relativePath} has an unresolved relative Markdown link: ${destination}`);
  } else if (!linkTargetExists(vettedFiles, resolvedPath, inPlugin)) {
    addError(`${entry.relativePath} has an unresolved relative Markdown link: ${destination}`);
  }
}

function validateMarkdownLinks(entries, vettedFiles) {
  for (const entry of entries.filter((candidate) => candidate.isFile && candidate.relativePath.endsWith('.md'))) {
    const destinations = markdownDestinations(readFileSync(entry.absolutePath, 'utf8'));
    for (const destination of destinations.filter((candidate) => !isExternalDestination(candidate))) {
      validateLink(entry, destination, vettedFiles);
    }
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function validateLegacyReferences(entries) {
  const legacyMentions = [
    `@${'producer'}`,
    `@${'dev-team'}`,
    `@${'qa'}`,
  ];
  const oldAgentFileNames = [
    `dev-${'team'}.agent.md`,
    `${'producer'}.agent.md`,
    `${'qa'}.agent.md`,
  ];

  for (const entry of entries.filter((candidate) => candidate.isFile)) {
    const extension = path.extname(entry.relativePath).toLowerCase();
    if (!TEXT_EXTENSIONS.has(extension) && path.posix.basename(entry.relativePath) !== 'LICENSE') {
      continue;
    }

    const contents = readFileSync(entry.absolutePath, 'utf8');
    for (const mention of legacyMentions.filter((candidate) => contents.includes(candidate))) {
      addError(`${entry.relativePath} contains legacy agent mention "${mention}".`);
    }
    for (const fileName of oldAgentFileNames) {
      const pattern = new RegExp(`(^|[^A-Za-z0-9-])${escapeRegExp(fileName)}(?=$|[^A-Za-z0-9.-])`, 'm');
      if (pattern.test(contents)) {
        addError(`${entry.relativePath} contains legacy agent filename "${fileName}".`);
      }
    }
  }
}

const vettedFiles = validatePayload();
validateManifest(vettedFiles);
for (const agentId of EXPECTED_AGENT_IDS) {
  validateAgent(vettedFiles, agentId);
}
validateSkill(vettedFiles);
const entries = walkRepository(REPO_ROOT, '', []);
validateSingleCopy(entries, vettedFiles);
validateMarkdownLinks(entries, vettedFiles);
validateLegacyReferences(entries);

if (errors.length > 0) {
  console.error(`Validation failed with ${errors.length} error${errors.length === 1 ? '' : 's'}:`);
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exitCode = 1;
} else {
  console.log('Validation passed.');
}
