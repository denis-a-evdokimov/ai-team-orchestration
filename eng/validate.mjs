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
// The MIT notice of github/awesome-copilot for the material that github/awesome-copilot#2946 added to
// the references. It stays in the skill folder, because a skill install copies only that folder.
const SKILL_NOTICE = `${SKILL_PATH}/NOTICE`;
const UPSTREAM_COPYRIGHT = 'Copyright GitHub, Inc.';
const LICENSE_NOTICE_LINE = `${UPSTREAM_COPYRIGHT} (portions; see ${PLUGIN_ROOT_PATH}/${SKILL_NOTICE})`;
const PERMISSION_START = /^[ \t]*Permission\s+is\s+hereby\s+granted/m;
// SHA-256 of the MIT permission notice and disclaimer, from "Permission is hereby granted" to the end,
// with white space collapsed. It equals the SPDX MIT template and the LICENSE of github/awesome-copilot.
const MIT_PERMISSION_SHA256 = 'fe2a9817987f862eaced948f0468c7f51d2fedfc48c5c505b246a49a3870e9a5';
// The plugin root is the installed payload. Installs copy every file in it.
const PLUGIN_FILES = Object.freeze([
  'README.md',
  'plugin.json',
  ...EXPECTED_AGENT_IDS.map((id) => `${AGENTS_PATH}/${id}.md`),
  `${SKILL_PATH}/SKILL.md`,
  ...SKILL_REFERENCES.map((fileName) => `${SKILL_PATH}/references/${fileName}`),
  SKILL_NOTICE,
].sort());
const PLUGIN_DIRECTORIES = new Set(PLUGIN_FILES.flatMap((file) => {
  const parts = file.split('/');
  return parts.slice(1).map((_, index) => parts.slice(0, index + 1).join('/'));
}));
// Keep a byte order mark visible: the Awesome Copilot gates reject a manifest that starts with one.
const UTF8_DECODER = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
// O_NONBLOCK keeps a named pipe from blocking the open on POSIX systems.
const OPEN_READ_FLAGS = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0);
// Fail-closed path checks for plugin Markdown. They read the whole text, code included, so that
// no link syntax can hide a path that leaves the installed plugin. Each form also matches when it
// is percent-encoded or written as an HTML character reference.
const ENCODED_DOT = String.raw`(?:\.|%2e|&#0*46;|&#x0*2e;|&period;)`;
const ENCODED_SLASH = String.raw`(?:[\\/]|%2f|%5c|&#0*47;|&#x0*2f;|&sol;|&#0*92;|&#x0*5c;|&bsol;)`;
// A parent segment is `..` that is not part of a longer name, followed by a slash or by the end of a path.
const PARENT_PATH = new RegExp(String.raw`(?<![\w.~%;-])${ENCODED_DOT}${ENCODED_DOT}(?=${ENCODED_SLASH}|[)\]>"'\s#?]|$)`, 'im');
const ROOT_RELATIVE_PATH = new RegExp(String.raw`(?:\]\(\s*<?\s*|\]:\s*<?\s*|=\s*["']?\s*)${ENCODED_SLASH}(?!${ENCODED_SLASH})`, 'i');
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
const TEXT_FILE_NAMES = new Set(['LICENSE', 'NOTICE']);

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

// License: LICENSE and the skill NOTICE both end with the complete MIT permission notice. LICENSE has a
// GitHub copyright line that points to the notice, and the notice has the GitHub copyright line.

function collapseWhitespace(text) {
  return text.replace(/\s+/g, ' ').trim();
}

// Returns the non-empty lines above the permission notice, or null after an error.
function licenseHeaderLines(label, text) {
  const normalized = text.replace(/\r\n?/g, '\n');
  const start = normalized.search(PERMISSION_START);
  if (start === -1 || contentHash(collapseWhitespace(normalized.slice(start))) !== MIT_PERMISSION_SHA256) {
    addError(`${label} must end with the complete MIT permission notice.`);
    return null;
  }
  return normalized.slice(0, start).split('\n').map((line) => line.trim()).filter(Boolean);
}

// GitHub reported "Other" instead of MIT for a LICENSE line above the permission notice that did not
// start with a copyright symbol. Thus the pointer to the notice is part of a copyright line.
function validateLicenseHeader(lines) {
  for (const line of lines.filter((candidate) => candidate !== 'MIT License' && !candidate.startsWith('Copyright '))) {
    addError(`LICENSE line "${line}" must be the title or start with "Copyright". GitHub can then report "Other" instead of MIT.`);
  }
  if (!lines.includes(LICENSE_NOTICE_LINE)) {
    addError(`LICENSE must have the line "${LICENSE_NOTICE_LINE}".`);
  }
}

function validateLicenseNotice(inventory, payload) {
  const licenseEntry = inventory.entries.find((entry) => entry.relativePath === 'LICENSE');
  const license = licenseEntry ? entryText(licenseEntry, payload) : null;
  if (license === null) {
    addError('LICENSE is missing or is not a regular file.');
  }
  const licenseLines = license === null ? null : licenseHeaderLines('LICENSE', license);
  if (licenseLines !== null) {
    validateLicenseHeader(licenseLines);
  }
  const notice = readPayloadText(payload, SKILL_NOTICE);
  const noticeLines = notice === null ? null : licenseHeaderLines(payloadLabel(SKILL_NOTICE), notice);
  if (noticeLines !== null && !noticeLines.includes(UPSTREAM_COPYRIGHT)) {
    addError(`${payloadLabel(SKILL_NOTICE)} must have the line "${UPSTREAM_COPYRIGHT}".`);
  }
}

// Link forms. The check reads them in the raw text, code examples included: a scan that skips code
// must agree with the Markdown parser of every client, and a difference can hide a link. In plugin
// Markdown, a URL attribute counts also outside a well-formed tag, for the same reason. As in the HTML
// tokenizer, an attribute name follows white space, a slash or a quote, only ASCII white space can
// surround `=`, and an unquoted value ends only at ASCII white space or `>`. A name in the path of a
// full URL, as in `https://example.com/src=x`, is not an attribute. A link ends only at ASCII white
// space or an ASCII control character, never at other white space such as U+00A0. Thus the patterns
// that end a link do not use `\s`.
const URL_ATTRIBUTE = /(?<=[\s/"'])(?<![A-Za-z][A-Za-z0-9+.-]*:\/\/[^\x00-\x20"'<>]*)(action|background|cite|data|formaction|href|poster|src|srcset|xlink:href)[\t\n\f\r ]*=[\t\n\f\r ]*(?:"([^"]*)"|'([^']*)'|([^\t\n\f\r "'>][^\t\n\f\r >]*))/gi;
const HTML_TAG = /<[A-Za-z](?:[^<>"']|"[^"]*"|'[^']*')*>/g;
// CommonMark allows spaces, tabs and one line break before a destination.
const INLINE_LINK_START = /\]\([ \t]*(?:\n[ \t]*)?/g;
const ANGLE_DESTINATION_AT = /<[^<>\n]*>/y;
const ESCAPABLE = /[!-/:-@[-`{-~]/;
const DESTINATION_END = /[\x00-\x20\x7F]/;
// Reference definitions, also inside block quotes and list items, and with escaped brackets in the label.
const REFERENCE_DEFINITION = /^(?:[ \t>]|[-*+][ \t]|\d{1,9}[.)][ \t])*\[(?:\\.|[^\\\]])+\]:[ \t]*\n?[ \t>]*(<[^>\n]*>|[^\x00-\x20\x7F]+)/gm;
// An autolink, such as `<https://example.com>`. Its content is literal.
const AUTOLINK = /<([A-Za-z][A-Za-z0-9+.-]{1,31}:[^\x00-\x20\x7F<>]*)>/g;
// A file URL or a Windows drive path, also a drive-relative one such as `C:notes.md`. It never points
// into an installed plugin.
const LOCAL_FILE_DESTINATION = /^(?:file:|[A-Za-z]:)/i;

// Returns the end of an inline link destination without angle brackets. It ends at a space, at an
// ASCII control character, or at a `)` that closes no `(`. An escaped parenthesis does not count.
function rawDestinationEnd(text, begin) {
  let depth = 0;
  let index = begin;
  while (index < text.length && !DESTINATION_END.test(text[index])) {
    const character = text[index];
    if (character === '\\' && ESCAPABLE.test(text[index + 1] ?? '')) {
      index += 1;
    } else if (character === '(') {
      depth += 1;
    } else if (character === ')') {
      if (depth === 0) {
        break;
      }
      depth -= 1;
    }
    index += 1;
  }
  return index;
}

function inlineDestinations(text) {
  return [...text.matchAll(INLINE_LINK_START)].map((start) => {
    const begin = start.index + start[0].length;
    ANGLE_DESTINATION_AT.lastIndex = begin;
    const angle = ANGLE_DESTINATION_AT.exec(text);
    return angle ? angle[0] : text.slice(begin, rawDestinationEnd(text, begin));
  });
}

// Reads the candidate URLs of a srcset value. A URL can contain commas, for example a data URL.
// ASCII white space separates the parts.
function srcsetUrls(value) {
  const urls = [];
  let rest = value;
  while (rest.replace(/^[\t\n\f\r ,]+/, '') !== '') {
    rest = rest.replace(/^[\t\n\f\r ,]+/, '');
    const url = /^[^\t\n\f\r ]+/.exec(rest)[0];
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

// Named character references that can change a path.
const NAMED_REFERENCES = new Map(Object.entries({
  amp: '&', apos: "'", bsol: '\\', colon: ':', comma: ',', gt: '>', lt: '<', newline: '\n', num: '#',
  percnt: '%', period: '.', quest: '?', quot: '"', sol: '/', tab: '\t',
}));
// A character reference. A browser also decodes numeric references with more digits than CommonMark.
const CHARACTER_REFERENCE = /&(?:#(\d+)|#[xX]([0-9A-Fa-f]+)|([A-Za-z][A-Za-z0-9]{1,31}));/g;
// A backslash escape or a character reference. A Markdown client decodes both in one pass.
const ESCAPE_OR_REFERENCE = /\\([!-/:-@[-`{-~])|&(?:#(\d+)|#[xX]([0-9A-Fa-f]+)|([A-Za-z][A-Za-z0-9]{1,31}));/g;

function decodeReference(reference, decimal, hex, name) {
  if (name !== undefined) {
    return NAMED_REFERENCES.get(name.toLowerCase()) ?? reference;
  }
  const codePoint = Number.parseInt(decimal ?? hex, decimal === undefined ? 16 : 10);
  return codePoint > 0 && codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : '\uFFFD';
}

// HTML decodes character references only. A backslash stays.
function decodeHtml(text) {
  return text.replace(CHARACTER_REFERENCE, decodeReference);
}

function unescapeMarkdown(text) {
  return text.replace(ESCAPE_OR_REFERENCE, (match, escaped, decimal, hex, name) => (
    escaped === undefined ? decodeReference(match, decimal, hex, name) : escaped));
}

function attributeDestinations(text) {
  return [...text.matchAll(URL_ATTRIBUTE)].flatMap((match) => {
    // A browser decodes character references before it splits srcset candidates.
    const value = decodeHtml(match[2] ?? match[3] ?? match[4]);
    return match[1].toLowerCase() === 'srcset' ? srcsetUrls(value) : [value];
  });
}

function markdownLinkDestinations(text) {
  const definitions = [...text.matchAll(REFERENCE_DEFINITION)].map((match) => match[1]);
  const destinations = [...definitions, ...inlineDestinations(text)].map((destination) => unescapeMarkdown(
    destination.startsWith('<') && destination.endsWith('>') ? destination.slice(1, -1) : destination));
  return [...destinations, ...[...text.matchAll(AUTOLINK)].map((match) => match[1])];
}

// Returns a target as a URL parser reads it: without tabs and line breaks, and without ASCII control
// characters and spaces at its ends. Other white space, such as U+00A0, stays.
function urlParserView(destination) {
  const value = destination.replace(/[\t\n\r]/g, '');
  let start = 0;
  let end = value.length;
  while (start < end && value.charCodeAt(start) <= 0x20) {
    start += 1;
  }
  while (end > start && value.charCodeAt(end - 1) <= 0x20) {
    end -= 1;
  }
  return value.slice(start, end);
}

// Every link form counts, also in a code example. Thus an example uses an existing target or a full URL.
// Repository Markdown reads URL attributes only in HTML tags, so that code such as `data = x` is not a link.
function markdownDestinations(markdown, inPlugin) {
  const text = markdown.replace(/\r\n?/g, '\n');
  const attributes = inPlugin
    ? attributeDestinations(text)
    : [...text.matchAll(HTML_TAG)].flatMap((tag) => attributeDestinations(tag[0]));
  return [...attributes, ...markdownLinkDestinations(text)].map(urlParserView);
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
    const inPlugin = pluginRelativePath(entry.absolutePath) !== null;
    const destinations = contents === null ? [] : markdownDestinations(contents, inPlugin);
    for (const destination of destinations) {
      if (inPlugin && LOCAL_FILE_DESTINATION.test(destination)) {
        addError(`${entry.relativePath} has a local file link, which installed copies cannot resolve: ${destination}`);
      } else if (!isExternalDestination(destination)) {
        validateLink(entry, destination, inventory, payload);
      }
    }
  }
}

function validatePayloadPaths(payload) {
  for (const [relativePath, text] of [...payload].filter(([file]) => file.endsWith('.md'))) {
    const contents = `${text}\n${decodeHtml(text)}\n${unescapeMarkdown(text)}`;
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
    || TEXT_FILE_NAMES.has(path.posix.basename(entry.relativePath));
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
validateLicenseNotice(inventory, payload);
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
