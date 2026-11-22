import { createHash } from 'node:crypto';
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  readdirSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  assertManagedDirectory,
  createRootInfo,
  isContainedPath,
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
const PLUGIN_DIRECTORIES = new Set(PLUGIN_FILES.flatMap((file) => {
  const parts = file.split('/');
  return parts.slice(1).map((_, index) => parts.slice(0, index + 1).join('/'));
}));
// Keep a byte order mark visible: the Awesome Copilot gates reject a manifest that starts with one.
const UTF8_DECODER = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const OPEN_READ_FLAGS = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0);
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
  return buffer.toString('utf8').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
}

function decodePayloadText(buffer) {
  try {
    return UTF8_DECODER.decode(buffer).replace(/\r\n?/g, '\n');
  } catch {
    return null;
  }
}

function payloadLabel(relativePath) {
  return `${PLUGIN_ROOT_PATH}/${relativePath}`;
}

// Checks and reads a file through one descriptor, so that the check and the read see the same file.
function readCheckedFile(absolutePath, rejectReason) {
  let descriptor;
  try {
    descriptor = openSync(absolutePath, OPEN_READ_FLAGS);
  } catch (error) {
    return { reason: `could not be opened as a regular file (${error.code ?? error.message}).` };
  }
  try {
    const reason = rejectReason(fstatSync(descriptor));
    return reason ? { reason } : { buffer: readFileSync(descriptor) };
  } finally {
    closeSync(descriptor);
  }
}

function payloadRejectReason(fileStat) {
  if (!fileStat.isFile()) {
    return 'must be a regular file or directory.';
  }
  if (fileStat.nlink !== 1) {
    return 'must not be hard-linked.';
  }
  return fileStat.size > PAYLOAD_FILE_MAX_BYTES ? `exceeds the ${PAYLOAD_FILE_MAX_BYTES}-byte file limit.` : null;
}

// Payload: every installed file must be an expected, regular, non-linked UTF-8 file.
// Later checks read plugin files only through the vetted payload map.

function collectPayloadFiles(directory, relativeDirectory, files) {
  for (const name of readdirSync(directory).sort()) {
    const relativePath = relativeDirectory ? `${relativeDirectory}/${name}` : name;
    const absolutePath = path.join(directory, name);
    const entryStat = lstatSync(absolutePath);
    if (entryStat.isSymbolicLink()) {
      addError(`${payloadLabel(relativePath)} must not be a symbolic link, junction, or reparse point.`);
    } else if (entryStat.isDirectory() && PLUGIN_DIRECTORIES.has(relativePath)) {
      collectPayloadFiles(absolutePath, relativePath, files);
    } else if (entryStat.isDirectory()) {
      addError(`${payloadLabel(relativePath)} is not part of the plugin file set. Installs copy every file in ${PLUGIN_ROOT_PATH}.`);
    } else {
      files.push(relativePath);
    }
  }
  return files;
}

function readPayloadFile(payload, relativePath) {
  const label = payloadLabel(relativePath);
  const { buffer, reason } = readCheckedFile(path.join(PLUGIN_ROOT, ...relativePath.split('/')), payloadRejectReason);
  const contents = buffer ? decodePayloadText(buffer) : null;
  if (reason) {
    addError(`${label} ${reason}`);
  } else if (contents === null) {
    addError(`${label} is not valid UTF-8.`);
  } else if (contents.startsWith('\uFEFF')) {
    addError(`${label} must not start with a UTF-8 byte order mark.`);
  } else {
    payload.set(relativePath, contents);
  }
}

function validatePayload() {
  const payload = new Map();
  try {
    assertManagedDirectory(createRootInfo(REPO_ROOT, 'Repository root'), PLUGIN_ROOT_PATH, PLUGIN_ROOT_PATH);
  } catch (error) {
    addError(error.message);
    return payload;
  }

  const expectedFiles = new Set(PLUGIN_FILES);
  const candidates = collectPayloadFiles(PLUGIN_ROOT, '', []);
  for (const relativePath of candidates.filter((file) => !expectedFiles.has(file))) {
    addError(`${payloadLabel(relativePath)} is not part of the plugin file set. Installs copy every file in ${PLUGIN_ROOT_PATH}.`);
  }
  for (const relativePath of candidates.filter((file) => expectedFiles.has(file))) {
    readPayloadFile(payload, relativePath);
  }
  for (const relativePath of PLUGIN_FILES.filter((file) => !candidates.includes(file))) {
    addError(`${payloadLabel(relativePath)} is missing or is not a regular file.`);
  }
  return payload;
}
function readPayloadText(payload, relativePath) {
  return payload.get(relativePath) ?? null;
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

function loadManifest(payload) {
  const contents = readPayloadText(payload, 'plugin.json');
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

function validateManifest(payload) {
  const manifest = loadManifest(payload);
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

function validateAgent(payload, agentId) {
  const relativePath = `${AGENTS_PATH}/${agentId}.md`;
  const contents = readPayloadText(payload, relativePath);
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

function validateSkill(payload) {
  const relativePath = `${SKILL_PATH}/SKILL.md`;
  const contents = readPayloadText(payload, relativePath);
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
// Plugin files are read only through the vetted payload map.

function walkRepository(directory, relativeDirectory, inventory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (relativeDirectory === '' && (entry.name === '.git' || entry.name === 'node_modules')) {
      continue;
    }

    const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      inventory.directories.add(relativePath);
      walkRepository(absolutePath, relativePath, inventory);
    } else {
      inventory.entries.push({ absolutePath, relativePath, isFile: entry.isFile() });
      if (entry.isFile()) {
        inventory.files.add(relativePath);
      }
    }
  }
  return inventory;
}

function pluginRelativePath(absolutePath) {
  return isContainedPath(PLUGIN_ROOT, absolutePath, false)
    ? path.relative(PLUGIN_ROOT, absolutePath).split(path.sep).join('/')
    : null;
}

// Returns the text of a repository file. A plugin file is returned only if it passed the payload checks.
function entryText(entry, payload) {
  const relativePath = pluginRelativePath(entry.absolutePath);
  if (relativePath !== null) {
    return readPayloadText(payload, relativePath);
  }
  return entry.isFile ? readFileSync(entry.absolutePath, 'utf8') : null;
}

function contentHash(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function validateSingleCopy(inventory, payload) {
  const hashes = new Map([...payload].map(([relativePath, contents]) => [contentHash(contents), relativePath]));
  // Line-ending normalization at most halves a copy, so a larger file cannot be a copy.
  const maxCopyBytes = 2 * Math.max(0, ...[...payload.values()].map((contents) => Buffer.byteLength(contents)));
  for (const entry of inventory.entries.filter((candidate) => pluginRelativePath(candidate.absolutePath) === null)) {
    const fileName = path.posix.basename(entry.relativePath);
    if (RESERVED_FILE_NAMES.has(fileName) || fileName.endsWith('.agent.md')) {
      addError(`${entry.relativePath} is plugin content outside ${PLUGIN_ROOT_PATH}; keep exactly one copy in the plugin root.`);
      continue;
    }
    if (!entry.isFile) {
      continue;
    }
    const { buffer } = readCheckedFile(entry.absolutePath, (fileStat) => (
      !fileStat.isFile() || fileStat.size > maxCopyBytes ? 'skipped' : null));
    const duplicateOf = buffer ? hashes.get(contentHash(normalizedText(buffer))) : undefined;
    if (duplicateOf) {
      addError(`${entry.relativePath} duplicates ${payloadLabel(duplicateOf)}; keep exactly one copy in the plugin root.`);
    }
  }
}

// Removes fenced code blocks and code spans, so that code examples are not read as links.
// A code span does not cross a blank line, and an escaped backtick does not open one.
function withoutCode(markdown) {
  return markdown
    .replace(/^ {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:^ {0,3}\1[ \t]*$|(?![\s\S]))/gm, '')
    .replace(/(?<![\\`])(`+)(?!`)(?:[^\n]|\n(?![ \t]*\n))*?[^`]\1(?!`)/g, ' ');
}

function markdownDestinations(markdown) {
  const patterns = [
    // The destination after any link text, so that nested brackets cannot hide a link.
    /\]\(\s*(<[^>\n]*>|(?:[^\s()]|\([^\s()]*\))+)/g,
    // Reference definitions, also with escaped brackets in the label.
    /^ {0,3}\[(?:\\.|[^\\\]])+\]:[ \t]*\n?[ \t]*(<[^>\n]*>|\S+)/gm,
    // Attributes of HTML tags, with or without quotes.
    /<[A-Za-z][A-Za-z0-9-]*\s[^>]*?\b(?:href|src)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi,
  ];
  const text = withoutCode(markdown);
  const destinations = [];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const destination = match.slice(1).find((group) => group !== undefined) ?? '';
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

function linkTargetExists(inventory, payload, resolvedPath, inPlugin) {
  if (inPlugin) {
    const relativePath = path.relative(PLUGIN_ROOT, resolvedPath).split(path.sep).join('/');
    return relativePath === '' || payload.has(relativePath) || PLUGIN_DIRECTORIES.has(relativePath);
  }
  const relativePath = path.relative(REPO_ROOT, resolvedPath).split(path.sep).join('/');
  return relativePath === '' || inventory.files.has(relativePath) || inventory.directories.has(relativePath);
}

function decodeLinkPath(entry, destination) {
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(destination.split(/[?#]/, 1)[0]);
  } catch {
    decodedPath = null;
  }
  if (decodedPath === null || decodedPath.includes('\0')) {
    addError(`${entry.relativePath} has an invalid encoded Markdown link: ${destination}`);
    return null;
  }
  return decodedPath;
}

function validateLink(entry, destination, inventory, payload) {
  const decodedPath = decodeLinkPath(entry, destination);
  if (decodedPath === null) {
    return;
  }

  const inPlugin = pluginRelativePath(entry.absolutePath) !== null;
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
  } else if (!linkTargetExists(inventory, payload, resolvedPath, inPlugin)) {
    addError(`${entry.relativePath} has an unresolved relative Markdown link: ${destination}`);
  }
}

function validateMarkdownLinks(inventory, payload) {
  for (const entry of inventory.entries.filter((candidate) => candidate.relativePath.endsWith('.md'))) {
    const contents = entryText(entry, payload);
    const destinations = contents === null ? [] : markdownDestinations(contents);
    for (const destination of destinations.filter((candidate) => !isExternalDestination(candidate))) {
      validateLink(entry, destination, inventory, payload);
    }
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isTextEntry(entry) {
  return TEXT_EXTENSIONS.has(path.extname(entry.relativePath).toLowerCase())
    || path.posix.basename(entry.relativePath) === 'LICENSE';
}

function validateLegacyReferences(inventory, payload) {
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

  for (const entry of inventory.entries.filter(isTextEntry)) {
    const contents = entryText(entry, payload);
    if (contents === null) {
      continue;
    }
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

const payload = validatePayload();
validateManifest(payload);
for (const agentId of EXPECTED_AGENT_IDS) {
  validateAgent(payload, agentId);
}
validateSkill(payload);
const inventory = walkRepository(REPO_ROOT, '', { entries: [], files: new Set(), directories: new Set() });
validateSingleCopy(inventory, payload);
validateMarkdownLinks(inventory, payload);
validateLegacyReferences(inventory, payload);

if (errors.length > 0) {
  console.error(`Validation failed with ${errors.length} error${errors.length === 1 ? '' : 's'}:`);
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exitCode = 1;
} else {
  console.log('Validation passed.');
}
