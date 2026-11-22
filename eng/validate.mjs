import {
  existsSync,
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
} from './path-safety.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PLUGIN_NAME = 'ai-team-orchestration';
const SKILL_NAME = 'ai-team-orchestration';
const PLUGIN_ROOT_PATH = `plugins/${PLUGIN_NAME}`;
const PLUGIN_ROOT = path.join(REPO_ROOT, ...PLUGIN_ROOT_PATH.split('/'));
const AGENTS_PATH = `${PLUGIN_ROOT_PATH}/com.github.copilot/agents`;
const SKILLS_PATH = `${PLUGIN_ROOT_PATH}/skills`;
const EXPECTED_AGENT_IDS = Object.freeze([
  'ai-team-dev',
  'ai-team-producer',
  'ai-team-qa',
]);
// The plugin root is the installed payload; anything else here would be installed too.
const EXPECTED_PLUGIN_ROOT_ENTRIES = Object.freeze([
  'README.md',
  'com.github.copilot',
  'plugin.json',
  'skills',
]);
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
const SKILL_FILE_MAX_BYTES = 5 * 1024 * 1024;
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

function repoPath(filePath) {
  return path.relative(REPO_ROOT, filePath).split(path.sep).join('/');
}

function addError(message) {
  errors.push(message);
}

function readJson(filePath, label) {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch (error) {
    addError(`${label} is not valid JSON: ${error.message}`);
    return undefined;
  }
}

function sameArray(actual, expected) {
  return Array.isArray(actual)
    && actual.length === expected.length
    && actual.every((value, index) => value === expected[index]);
}

function parseFrontmatter(filePath, allowedFields) {
  const contents = readFileSync(filePath, 'utf8').replace(/\r\n?/g, '\n');
  const lines = contents.split('\n');

  if (lines[0] !== '---') {
    addError(`${repoPath(filePath)} must start with YAML frontmatter.`);
    return null;
  }

  const closingIndex = lines.indexOf('---', 1);
  if (closingIndex === -1) {
    addError(`${repoPath(filePath)} has unterminated YAML frontmatter.`);
    return null;
  }

  const fields = new Map();
  for (let index = 1; index < closingIndex; index += 1) {
    if (lines[index].trim() === '') {
      continue;
    }
    const match = /^([A-Za-z][A-Za-z0-9-]*):(?:[ \t]+(.*))?$/.exec(lines[index]);
    if (!match) {
      addError(`${repoPath(filePath)} contains unsupported frontmatter syntax: ${lines[index]}`);
      continue;
    }

    const [, key, value = ''] = match;
    if (fields.has(key)) {
      addError(`${repoPath(filePath)} has duplicate frontmatter field "${key}".`);
      continue;
    }
    if (!allowedFields.has(key)) {
      addError(`${repoPath(filePath)} contains unsupported frontmatter field "${key}".`);
      continue;
    }
    fields.set(key, value.replace(/[ \t]+$/, ''));
  }

  return fields;
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

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function validatePlugin() {
  const label = `${PLUGIN_ROOT_PATH}/plugin.json`;
  const pluginPath = path.join(PLUGIN_ROOT, 'plugin.json');
  if (!existsSync(pluginPath)) {
    addError(`${label} is missing.`);
    return null;
  }
  const plugin = readJson(pluginPath, label);
  if (plugin === undefined) {
    return null;
  }
  if (!plugin || typeof plugin !== 'object' || Array.isArray(plugin)) {
    addError(`${label} must contain a JSON object.`);
    return null;
  }

  for (const field of Object.keys(plugin)) {
    if (!AGENT_PLUGIN_FIELDS.has(field)) {
      addError(`${label} top-level field "${field}" is not part of Agent Plugins 1.0.`);
    }
  }
  if (plugin.$schema !== AGENT_PLUGIN_SCHEMA_URL) {
    addError(`${label} field "$schema" must be exactly "${AGENT_PLUGIN_SCHEMA_URL}".`);
  }
  if (plugin.name !== PLUGIN_NAME) {
    addError(`${label} field "name" must be exactly "${PLUGIN_NAME}".`);
  }

  for (const field of ['description', 'version', 'repository', 'license']) {
    if (!isNonEmptyString(plugin[field])) {
      addError(`${label} field "${field}" must be a non-empty string.`);
    }
  }
  if (typeof plugin.description === 'string'
    && plugin.description.length > 500) {
    addError(`${label} field "description" must not exceed 500 characters.`);
  }
  if (!SEMVER_PATTERN.test(plugin.version ?? '')) {
    addError(`${label} version "${plugin.version ?? ''}" is not valid SemVer.`);
  }
  if (isNonEmptyString(plugin.repository)
    && !plugin.repository.startsWith('https://github.com/')) {
    addError(`${label} field "repository" must be an https://github.com/ URL.`);
  }
  if (plugin.homepage !== undefined && !isNonEmptyString(plugin.homepage)) {
    addError(`${label} field "homepage" must be a non-empty string when present.`);
  }
  if (plugin.extensions !== undefined
    && (!plugin.extensions
      || typeof plugin.extensions !== 'object'
      || Array.isArray(plugin.extensions)
      || Object.values(plugin.extensions).some((value) => !value
        || typeof value !== 'object'
        || Array.isArray(value)))) {
    addError(`${label} field "extensions" must map namespaces to objects.`);
  }

  if (!Array.isArray(plugin.keywords)
    || plugin.keywords.length === 0
    || plugin.keywords.length > 10
    || plugin.keywords.some((keyword) => typeof keyword !== 'string'
      || keyword.length < 1
      || keyword.length > 30
      || !SLUG_PATTERN.test(keyword))) {
    addError(`${label} field "keywords" must contain 1-10 lowercase slugs no longer than 30 characters.`);
  }

  const author = plugin.author;
  const validAuthor = author
    && typeof author === 'object'
    && !Array.isArray(author)
    && isNonEmptyString(author.name)
    && Object.entries(author).every(([field, value]) => AGENT_PLUGIN_AUTHOR_FIELDS.has(field)
      && typeof value === 'string');
  if (!validAuthor) {
    addError(`${label} field "author" must be an object with a non-empty name and only string name, email, and url fields.`);
  }

  return plugin;
}

function sameEntries(directoryPath, expectedNames, label) {
  const actualNames = readdirSync(directoryPath).sort();
  if (!sameArray(actualNames, [...expectedNames].sort())) {
    addError(`${label} must contain exactly: ${[...expectedNames].sort().join(', ')}; found: ${actualNames.join(', ') || '(none)'}.`);
    return false;
  }
  return true;
}

function validatePluginLayout() {
  let rootInfo;
  try {
    rootInfo = createRootInfo(REPO_ROOT, 'Repository root');
    for (const directory of [
      PLUGIN_ROOT_PATH,
      `${PLUGIN_ROOT_PATH}/com.github.copilot`,
      AGENTS_PATH,
      SKILLS_PATH,
    ]) {
      assertManagedDirectory(rootInfo, directory, directory);
    }
  } catch (error) {
    addError(error.message);
    return false;
  }

  sameEntries(PLUGIN_ROOT, EXPECTED_PLUGIN_ROOT_ENTRIES, PLUGIN_ROOT_PATH);
  sameEntries(path.join(PLUGIN_ROOT, 'com.github.copilot'), ['agents'], `${PLUGIN_ROOT_PATH}/com.github.copilot`);
  return true;
}

function validateSingleCopy(files) {
  const agentFileNames = new Set(EXPECTED_AGENT_IDS.flatMap((id) => [`${id}.md`, `${id}.agent.md`]));
  for (const filePath of files) {
    if (isContainedPath(PLUGIN_ROOT, filePath, false)) {
      continue;
    }
    const fileName = path.basename(filePath);
    if (fileName === 'plugin.json'
      || fileName === 'SKILL.md'
      || fileName.endsWith('.agent.md')
      || agentFileNames.has(fileName)) {
      addError(`${repoPath(filePath)} is plugin content outside ${PLUGIN_ROOT_PATH}; keep exactly one copy in the plugin root.`);
    }
  }
}

function validateAgents() {
  const agentsDirectory = path.join(REPO_ROOT, ...AGENTS_PATH.split('/'));
  if (!sameEntries(agentsDirectory, EXPECTED_AGENT_IDS.map((id) => `${id}.md`), AGENTS_PATH)) {
    return;
  }

  for (const fileId of EXPECTED_AGENT_IDS) {
    const filePath = path.join(agentsDirectory, `${fileId}.md`);
    const fileStat = lstatSync(filePath);
    if (!fileStat.isFile() || fileStat.isSymbolicLink() || fileStat.nlink !== 1) {
      addError(`${repoPath(filePath)} must be a non-hard-linked regular file.`);
      continue;
    }
    const fields = parseFrontmatter(filePath, new Set(['name', 'description', 'include-custom-instructions']));
    if (!fields) {
      continue;
    }

    const frontmatterName = quotedValue(fields.get('name'));
    if (frontmatterName === null) {
      addError(`${repoPath(filePath)} frontmatter name must be quoted.`);
    } else if (frontmatterName !== fileId) {
      addError(`${repoPath(filePath)} filename ID "${fileId}" does not match frontmatter name "${frontmatterName}".`);
    }

    const description = quotedValue(fields.get('description'));
    if (description === null || description.trim() === '' || description.length > DESCRIPTION_MAX_LENGTH) {
      addError(`${repoPath(filePath)} frontmatter description must be matching-quoted, non-empty, and no longer than ${DESCRIPTION_MAX_LENGTH} characters.`);
    }

    if (fields.get('include-custom-instructions') !== 'true') {
      addError(`${repoPath(filePath)} frontmatter must contain exactly "include-custom-instructions: true".`);
    }
  }
}

function validateSkillTree(skillDirectory) {
  for (const entry of readdirSync(skillDirectory, { withFileTypes: true })) {
    const entryPath = path.join(skillDirectory, entry.name);
    const entryStat = lstatSync(entryPath);
    if (entryStat.isSymbolicLink()) {
      addError(`${repoPath(entryPath)} must not be a symbolic link, junction, or reparse point.`);
    } else if (entryStat.isDirectory()) {
      validateSkillTree(entryPath);
    } else if (entryStat.isFile()) {
      if (entryStat.nlink !== 1) {
        addError(`${repoPath(entryPath)} must not be hard-linked.`);
      }
      if (entryStat.size > SKILL_FILE_MAX_BYTES) {
        addError(`${repoPath(entryPath)} exceeds the ${SKILL_FILE_MAX_BYTES}-byte skill file limit.`);
      }
    } else {
      addError(`${repoPath(entryPath)} must be a regular file or directory.`);
    }
  }
}

function validateSkills() {
  const skillsDirectory = path.join(REPO_ROOT, ...SKILLS_PATH.split('/'));
  if (!sameEntries(skillsDirectory, [SKILL_NAME], SKILLS_PATH)) {
    return;
  }

  const folderName = SKILL_NAME;
  const skillDirectory = path.join(skillsDirectory, folderName);
  if (!lstatSync(skillDirectory).isDirectory()) {
    addError(`${SKILLS_PATH}/${folderName} must be a directory.`);
    return;
  }
  validateSkillTree(skillDirectory);
  const skillPath = path.join(skillDirectory, 'SKILL.md');
  if (!existsSync(skillPath)) {
    addError(`${SKILLS_PATH}/${folderName} is missing SKILL.md.`);
    return;
  }

  const fields = parseFrontmatter(skillPath, new Set(['name', 'description']));
  if (!fields) {
    return;
  }

  const frontmatterName = scalarValue(fields.get('name'));
  if (!frontmatterName) {
    addError(`${repoPath(skillPath)} must have a non-empty frontmatter name.`);
  } else if (frontmatterName !== folderName) {
    addError(`${repoPath(skillPath)} frontmatter name "${frontmatterName}" must match folder name "${folderName}".`);
  }
  const lines = readFileSync(skillPath, 'utf8').replace(/\r\n?/g, '\n').split('\n');
  const closingIndex = lines.indexOf('---', 1);
  const nameLines = lines
    .slice(1, closingIndex)
    .filter((line) => /^\s*name\s*:/.test(line));
  if (nameLines.length !== 1 || nameLines[0] !== `name: ${SKILL_NAME}`) {
    addError(`${repoPath(skillPath)} frontmatter name line must be exactly "name: ${SKILL_NAME}".`);
  }

  const description = quotedValue(fields.get('description'));
  if (description === null || description.length < 10 || description.length > DESCRIPTION_MAX_LENGTH) {
    addError(`${repoPath(skillPath)} frontmatter description must be matching-quoted and between 10 and ${DESCRIPTION_MAX_LENGTH} characters.`);
  }
}

function walkFiles(directory, relativeDirectory = '') {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (relativeDirectory === '' && (entry.name === '.git' || entry.name === 'node_modules')) {
      continue;
    }

    const relativePath = path.join(relativeDirectory, entry.name);
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(absolutePath, relativePath));
    } else if (entry.isFile()) {
      files.push(path.join(REPO_ROOT, relativePath));
    }
  }
  return files.sort();
}

function markdownDestinations(markdown) {
  const destinations = [];
  const inlinePattern = /!?\[[^\]]*\]\(\s*(<[^>]+>|[^\s)]+)(?:\s+['"][^'"]*['"])?\s*\)/g;
  const definitionPattern = /^\s*\[[^\]]+\]:\s*(<[^>]+>|\S+)/gm;

  for (const pattern of [inlinePattern, definitionPattern]) {
    for (const match of markdown.matchAll(pattern)) {
      destinations.push(match[1]);
    }
  }
  return destinations;
}

function validateMarkdownLinks(files) {
  for (const filePath of files.filter((candidate) => candidate.endsWith('.md'))) {
    const markdown = readFileSync(filePath, 'utf8');
    for (let destination of markdownDestinations(markdown)) {
      if (destination.startsWith('<') && destination.endsWith('>')) {
        destination = destination.slice(1, -1);
      }

      if (!destination
        || destination.startsWith('#')
        || destination.startsWith('/')
        || destination.startsWith('//')
        || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(destination)) {
        continue;
      }

      const pathPart = destination.split(/[?#]/, 1)[0];
      let decodedPath;
      try {
        decodedPath = decodeURIComponent(pathPart);
      } catch {
        addError(`${repoPath(filePath)} has an invalid encoded Markdown link: ${destination}`);
        continue;
      }

      const resolvedPath = path.resolve(path.dirname(filePath), decodedPath);
      const relativePath = path.relative(REPO_ROOT, resolvedPath);
      if (relativePath.startsWith('..') || path.isAbsolute(relativePath) || !existsSync(resolvedPath)) {
        addError(`${repoPath(filePath)} has an unresolved relative Markdown link: ${destination}`);
      } else if (isContainedPath(PLUGIN_ROOT, filePath, false)
        && !isContainedPath(PLUGIN_ROOT, resolvedPath, true)) {
        addError(`${repoPath(filePath)} links outside ${PLUGIN_ROOT_PATH}, which installed copies do not contain: ${destination}`);
      }
    }
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function validateLegacyReferences(files) {
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

  for (const filePath of files) {
    const extension = path.extname(filePath).toLowerCase();
    if (!TEXT_EXTENSIONS.has(extension) && path.basename(filePath) !== 'LICENSE') {
      continue;
    }

    const contents = readFileSync(filePath, 'utf8');
    for (const mention of legacyMentions) {
      if (contents.includes(mention)) {
        addError(`${repoPath(filePath)} contains legacy agent mention "${mention}".`);
      }
    }

    for (const fileName of oldAgentFileNames) {
      const pattern = new RegExp(`(^|[^A-Za-z0-9-])${escapeRegExp(fileName)}(?=$|[^A-Za-z0-9.-])`, 'm');
      if (pattern.test(contents)) {
        addError(`${repoPath(filePath)} contains legacy agent filename "${fileName}".`);
      }
    }
  }
}

if (validatePluginLayout()) {
  validatePlugin();
  validateAgents();
  validateSkills();
}
const files = walkFiles(REPO_ROOT);
validateSingleCopy(files);
validateMarkdownLinks(files);
validateLegacyReferences(files);
if (errors.length > 0) {
  console.error(`Validation failed with ${errors.length} error${errors.length === 1 ? '' : 's'}:`);
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exitCode = 1;
} else {
  console.log('Validation passed.');
}
