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
// O_NONBLOCK keeps a named pipe from blocking the open on POSIX systems.
const OPEN_READ_FLAGS = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0);
const URL_ATTRIBUTES = new Set(['action', 'background', 'cite', 'data', 'formaction', 'href', 'poster', 'src', 'srcset', 'xlink:href']);
// Fail-closed path checks for plugin Markdown. They read the whole text, code included, so that
// no link syntax can hide a path that leaves the installed plugin. Each form also matches when it
// is percent-encoded or written as an HTML character reference.
const ENCODED_DOT = String.raw`(?:\.|%2e|&#0*46;|&#x0*2e;|&period;)`;
const ENCODED_SLASH = String.raw`(?:[\\/]|%2f|%5c|&#0*47;|&#x0*2f;|&sol;|&#0*92;|&#x0*5c;|&bsol;)`;
// A parent segment is `..` that is not part of a longer name, followed by a slash or by the end of a path.
const PARENT_PATH = new RegExp(String.raw`(?<![\w.~%;-])${ENCODED_DOT}${ENCODED_DOT}(?=${ENCODED_SLASH}|[)\]>"'\s#?]|$)`, 'im');
const ROOT_RELATIVE_PATH = new RegExp(String.raw`(?:\]\(\s*<?|\]:\s*<?|=\s*["']?)${ENCODED_SLASH}(?!${ENCODED_SLASH})`, 'i');
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
    const reason = rejectReason(fstatSync(descriptor));
    return reason ? { reason } : { buffer: readFileSync(descriptor) };
  } catch (error) {
    return { error: error.code ?? error.message };
  } finally {
    if (descriptor !== undefined) {
      closeSync(descriptor);
    }
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
    } else if (!entryStat.isFile()) {
      addError(`${payloadLabel(relativePath)} must be a regular file or directory.`);
    } else {
      files.push(relativePath);
    }
  }
  return files;
}

function readPayloadFile(payload, relativePath) {
  const label = payloadLabel(relativePath);
  const { buffer, reason, error } = readCheckedFile(path.join(PLUGIN_ROOT, ...relativePath.split('/')), payloadRejectReason);
  const contents = buffer ? decodePayloadText(buffer) : null;
  if (error) {
    addError(`${label} could not be read (${error}).`);
  } else if (reason) {
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

const unreadableEntries = new Set();

function reportUnreadable(entry, error) {
  if (!unreadableEntries.has(entry.relativePath)) {
    unreadableEntries.add(entry.relativePath);
    addError(`${entry.relativePath} could not be read (${error}).`);
  }
}

// Returns the text of a repository file. A plugin file is returned only if it passed the payload checks.
function entryText(entry, payload) {
  const relativePath = pluginRelativePath(entry.absolutePath);
  if (relativePath !== null) {
    return readPayloadText(payload, relativePath);
  }
  if (!entry.isFile) {
    return null;
  }
  const { buffer, error } = readCheckedFile(entry.absolutePath, (fileStat) => (fileStat.isFile() ? null : 'skipped'));
  if (error) {
    reportUnreadable(entry, error);
  }
  return buffer ? buffer.toString('utf8') : null;
}

function contentHash(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function findCopy(entry, hashes, maxCopyBytes) {
  const { buffer, error } = readCheckedFile(entry.absolutePath, (fileStat) => (
    !fileStat.isFile() || fileStat.size > maxCopyBytes ? 'skipped' : null));
  if (error) {
    reportUnreadable(entry, error);
  }
  return buffer ? hashes.get(contentHash(normalizedText(buffer))) : undefined;
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
    const duplicateOf = entry.isFile ? findCopy(entry, hashes, maxCopyBytes) : undefined;
    if (duplicateOf) {
      addError(`${entry.relativePath} duplicates ${payloadLabel(duplicateOf)}; keep exactly one copy in the plugin root.`);
    }
  }
}

// Blanks fenced code blocks in one pass, in source order. A closing fence uses the character of
// the opening fence, is at least as long, and has nothing after it. A non-blank line that is less
// indented than the opening fence can end a list item and its fence. Then the pairing of fences is
// uncertain, so the scan stops blanking for the rest of the text: it may check code, but it never
// hides a link.
function withoutFencedCode(markdown) {
  let fence = null;
  let uncertain = false;
  return markdown.split('\n').map((line) => {
    const marker = uncertain ? null : /^( {0,3})(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence !== null) {
      if (marker && marker[2][0] === fence.marker[0] && marker[2].length >= fence.marker.length && marker[3].trim() === '') {
        fence = null;
        return '';
      }
      if (line.trim() === '' || /^ */.exec(line)[0].length >= fence.indent) {
        return '';
      }
      fence = null;
      uncertain = true;
      return line;
    }
    if (marker && !(marker[2][0] === '`' && marker[3].includes('`'))) {
      fence = { marker: marker[2], indent: marker[1].length };
      return '';
    }
    return line;
  }).join('\n');
}

const HTML_TAG_AT = /<[A-Za-z][A-Za-z0-9-]*((?:\s+[^\s"'=<>`/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*\/?>/y;
const ANGLE_DESTINATION_AT = /<[^<>\n]*>/y;
const BACKTICK_RUN_AT = /`+/y;
const HTML_ATTRIBUTE = /([^\s"'=<>`/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
const INLINE_LINK = /\]\(\s*(<[^>\n]*>|(?:[^\s()]|\([^\s()]*\))+)/g;
// Reference definitions, also inside block quotes and list items, and with escaped brackets in the label.
const REFERENCE_DEFINITION = /^(?:[ \t>]|[-*+][ \t]|\d{1,9}[.)][ \t])*\[(?:\\.|[^\\\]])+\]:[ \t]*\n?[ \t>]*(<[^>\n]*>|\S+)/gm;

// Returns the positions of the blank lines that end paragraphs. A code span does not cross one.
function paragraphEnds(text) {
  return [...text.matchAll(/\n[ \t]*\n/g)].map((match) => match.index);
}

// Returns the end of the code span that starts at `start`, or -1.
function codeSpanEnd(text, start, runLength, limit) {
  const backtickRuns = /`+/g;
  backtickRuns.lastIndex = start + runLength;
  for (let run = backtickRuns.exec(text); run && run.index < limit; run = backtickRuns.exec(text)) {
    if (run[0].length === runLength) {
      return run.index + runLength;
    }
  }
  return -1;
}

function matchAt(pattern, text, index) {
  pattern.lastIndex = index;
  return pattern.exec(text);
}

// Scans inline text in source order, as CommonMark does: a link or reference destination in angle
// brackets stays a destination, an HTML tag that starts first keeps its attributes, a code span
// that starts first hides the markup inside it, and an escaped character stays literal.
// Returns the text without code spans and tags, and the tag attributes.
function scanInline(text) {
  const ends = paragraphEnds(text);
  const tags = [];
  const visible = [];
  let destinationExpected = false;
  let index = 0;
  while (index < text.length) {
    const character = text[index];
    const destination = character === '<' && destinationExpected ? matchAt(ANGLE_DESTINATION_AT, text, index) : null;
    const tag = character === '<' && !destination ? matchAt(HTML_TAG_AT, text, index) : null;
    const run = character === '`' ? matchAt(BACKTICK_RUN_AT, text, index)[0] : '';
    const limit = run ? ends.find((end) => end > index) ?? text.length : 0;
    const spanEnd = run ? codeSpanEnd(text, index, run.length, limit) : -1;
    let consumed = character;
    if (destination || (run && spanEnd === -1)) {
      consumed = destination ? destination[0] : run;
      visible.push(consumed);
    } else if (tag || run) {
      consumed = tag ? tag[0] : text.slice(index, spanEnd);
      if (tag) {
        tags.push(tag[1]);
      }
      visible.push(' ');
    } else {
      consumed = character === '\\' ? text.slice(index, index + 2) : character;
      visible.push(consumed);
    }
    const previous = index > 0 ? text[index - 1] : '';
    destinationExpected = consumed.length === 1 && previous === ']' && (character === '(' || character === ':')
      ? true
      : destinationExpected && /^\s$/.test(consumed);
    index += consumed.length;
  }
  return { visible: visible.join(''), tags };
}
// Reads the candidate URLs of a srcset value. A URL can contain commas, for example a data URL.
function srcsetUrls(value) {
  const urls = [];
  let rest = value;
  while (rest.replace(/^[\s,]+/, '') !== '') {
    rest = rest.replace(/^[\s,]+/, '');
    const url = /^\S+/.exec(rest)[0];
    const trimmedUrl = url.replace(/,+$/, '');
    urls.push(trimmedUrl);
    rest = rest.slice(url.length);
    if (trimmedUrl === url) {
      const comma = rest.indexOf(',');
      rest = comma === -1 ? '' : rest.slice(comma + 1);
    }
  }
  return urls;
}

function attributeDestinations(attributes) {
  const destinations = [];
  for (const attribute of attributes.matchAll(HTML_ATTRIBUTE)) {
    const name = attribute[1].toLowerCase();
    const value = attribute[2] ?? attribute[3] ?? attribute[4];
    if (value !== undefined && URL_ATTRIBUTES.has(name)) {
      destinations.push(...(name === 'srcset' ? srcsetUrls(value) : [value]));
    }
  }
  return destinations;
}

function markdownDestinations(markdown) {
  const { visible, tags } = scanInline(withoutFencedCode(markdown.replace(/\r\n?/g, '\n')));
  const destinations = tags.flatMap(attributeDestinations);
  for (const pattern of [REFERENCE_DEFINITION, INLINE_LINK]) {
    for (const match of visible.matchAll(pattern)) {
      destinations.push(match[1]);
    }
  }
  return destinations.map((destination) => (
    destination.startsWith('<') && destination.endsWith('>') ? destination.slice(1, -1) : destination));
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

function validatePayloadPaths(payload) {
  for (const [relativePath, contents] of [...payload].filter(([file]) => file.endsWith('.md'))) {
    if (PARENT_PATH.test(contents)) {
      addError(`${payloadLabel(relativePath)} contains a parent-directory path, which can leave the installed plugin. Plugin Markdown must not contain one, also not in code.`);
    }
    if (ROOT_RELATIVE_PATH.test(contents)) {
      addError(`${payloadLabel(relativePath)} contains a root-relative link target, which installed copies cannot resolve.`);
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
validatePayloadPaths(payload);
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
