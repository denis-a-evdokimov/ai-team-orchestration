import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXPECTED_AGENT_IDS = [
  'ai-team-dev',
  'ai-team-producer',
  'ai-team-qa',
];
const EXPECTED_MANAGED_PLUGIN_FIELDS = [
  'description',
  'version',
  'keywords',
  'author',
  'license',
];
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
    return null;
  }
}

function sameArray(actual, expected) {
  return Array.isArray(actual)
    && actual.length === expected.length
    && actual.every((value, index) => value === expected[index]);
}

function parseFrontmatter(filePath) {
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
    const match = /^([A-Za-z][A-Za-z0-9-]*):\s*(.*)$/.exec(lines[index]);
    if (!match) {
      continue;
    }

    const [, key, value] = match;
    if (fields.has(key)) {
      addError(`${repoPath(filePath)} has duplicate frontmatter field "${key}".`);
      continue;
    }
    fields.set(key, value.trim());
  }

  return fields;
}

function unquote(value) {
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

function validatePlugin() {
  const pluginPath = path.join(REPO_ROOT, 'plugin.json');
  const plugin = readJson(pluginPath, 'plugin.json');
  if (!plugin) {
    return null;
  }

  const requiredStringFields = [
    'name',
    'description',
    'version',
    'repository',
    'license',
    'skills',
    'agents',
  ];
  for (const field of requiredStringFields) {
    if (typeof plugin[field] !== 'string' || plugin[field].trim() === '') {
      addError(`plugin.json field "${field}" must be a non-empty string.`);
    }
  }

  if (!SEMVER_PATTERN.test(plugin.version ?? '')) {
    addError(`plugin.json version "${plugin.version ?? ''}" is not valid SemVer.`);
  }

  if (!Array.isArray(plugin.keywords)
    || plugin.keywords.length === 0
    || plugin.keywords.some((keyword) => typeof keyword !== 'string' || keyword.trim() === '')) {
    addError('plugin.json field "keywords" must be a non-empty array of non-empty strings.');
  }

  const validAuthor = (typeof plugin.author === 'string' && plugin.author.trim() !== '')
    || (plugin.author
      && typeof plugin.author === 'object'
      && typeof plugin.author.name === 'string'
      && plugin.author.name.trim() !== '');
  if (!validAuthor) {
    addError('plugin.json field "author" must be a non-empty string or an object with a non-empty name.');
  }

  for (const field of ['skills', 'agents']) {
    if (typeof plugin[field] !== 'string' || plugin[field].trim() === '') {
      continue;
    }

    const configuredPath = path.resolve(REPO_ROOT, plugin[field]);
    const relativePath = path.relative(REPO_ROOT, configuredPath);
    if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
      addError(`plugin.json field "${field}" must stay within the repository.`);
    } else if (!existsSync(configuredPath) || !statSync(configuredPath).isDirectory()) {
      addError(`plugin.json field "${field}" does not resolve to a directory: ${plugin[field]}`);
    }
  }

  return plugin;
}

function validateAgents() {
  const agentsDirectory = path.join(REPO_ROOT, 'agents');
  if (!existsSync(agentsDirectory) || !statSync(agentsDirectory).isDirectory()) {
    addError('Required agents/ directory is missing.');
    return [];
  }
  const agentFiles = readdirSync(agentsDirectory)
    .filter((fileName) => fileName.endsWith('.agent.md'))
    .sort();
  const actualIds = agentFiles.map((fileName) => fileName.slice(0, -'.agent.md'.length));

  if (!sameArray(actualIds, EXPECTED_AGENT_IDS)) {
    addError(`agents/ must contain exactly these agent IDs: ${EXPECTED_AGENT_IDS.join(', ')}; found: ${actualIds.join(', ') || '(none)'}.`);
  }

  for (const fileName of agentFiles) {
    const filePath = path.join(agentsDirectory, fileName);
    const fields = parseFrontmatter(filePath);
    if (!fields) {
      continue;
    }

    const fileId = fileName.slice(0, -'.agent.md'.length);
    const frontmatterName = quotedValue(fields.get('name'));
    if (frontmatterName === null) {
      addError(`${repoPath(filePath)} frontmatter name must be quoted.`);
    } else if (frontmatterName !== fileId) {
      addError(`${repoPath(filePath)} filename ID "${fileId}" does not match frontmatter name "${frontmatterName}".`);
    }

    if (!unquote(fields.get('description'))) {
      addError(`${repoPath(filePath)} must have a non-empty frontmatter description.`);
    }

    const tools = fields.get('tools');
    const toolsMatch = typeof tools === 'string' ? /^\[(.*)\]$/.exec(tools) : null;
    if (!toolsMatch || toolsMatch[1].trim() === '') {
      addError(`${repoPath(filePath)} must have a non-empty frontmatter tools array.`);
      continue;
    }

    const toolEntries = toolsMatch[1].split(',').map((entry) => entry.trim());
    if (toolEntries.some((entry) => quotedValue(entry) === null)) {
      addError(`${repoPath(filePath)} tools must be quoted array entries.`);
    }
  }

  return actualIds;
}

function validateSkills() {
  const skillsDirectory = path.join(REPO_ROOT, 'skills');
  if (!existsSync(skillsDirectory) || !statSync(skillsDirectory).isDirectory()) {
    addError('Required skills/ directory is missing.');
    return [];
  }
  const skillNames = readdirSync(skillsDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  for (const folderName of skillNames) {
    const skillPath = path.join(skillsDirectory, folderName, 'SKILL.md');
    if (!existsSync(skillPath)) {
      addError(`skills/${folderName} is missing SKILL.md.`);
      continue;
    }

    const fields = parseFrontmatter(skillPath);
    if (!fields) {
      continue;
    }

    const frontmatterName = unquote(fields.get('name'));
    if (!frontmatterName) {
      addError(`${repoPath(skillPath)} must have a non-empty frontmatter name.`);
    } else if (frontmatterName !== folderName) {
      addError(`${repoPath(skillPath)} frontmatter name "${frontmatterName}" must match folder name "${folderName}".`);
    }
    if (folderName === 'ai-team') {
      const lines = readFileSync(skillPath, 'utf8').replace(/\r\n?/g, '\n').split('\n');
      const closingIndex = lines.indexOf('---', 1);
      const nameLines = lines
        .slice(1, closingIndex)
        .filter((line) => /^\s*name\s*:/.test(line));
      if (nameLines.length !== 1 || nameLines[0] !== 'name: ai-team') {
        addError(`${repoPath(skillPath)} canonical frontmatter name line must be exactly "name: ai-team".`);
      }
    }

    if (!unquote(fields.get('description'))) {
      addError(`${repoPath(skillPath)} must have a non-empty frontmatter description.`);
    }
  }

  return skillNames;
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

function validatePortableStrings(value, location = 'sync manifest') {
  if (typeof value === 'string') {
    if (path.posix.isAbsolute(value) || path.win32.isAbsolute(value)) {
      addError(`${location} contains an absolute path: ${value}`);
    }
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => validatePortableStrings(item, `${location}[${index}]`));
    return;
  }

  if (value && typeof value === 'object') {
    for (const [key, nestedValue] of Object.entries(value)) {
      validatePortableStrings(nestedValue, `${location}.${key}`);
    }
  }
}

function validateSyncManifest(plugin, agentIds, skillNames) {
  const manifestPath = path.join(REPO_ROOT, 'eng', 'awesome-copilot-sync.json');
  const manifest = readJson(manifestPath, 'eng/awesome-copilot-sync.json');
  if (!manifest) {
    return;
  }

  validatePortableStrings(manifest);

  if (!sameArray(Object.keys(manifest).sort(), ['agents', 'plugin', 'skill'])) {
    addError('sync manifest must contain only agents, skill, and plugin top-level keys.');
  }
  if (!sameArray(manifest.agents, EXPECTED_AGENT_IDS)) {
    addError(`sync manifest agents must be exactly: ${EXPECTED_AGENT_IDS.join(', ')}.`);
  }
  if (!sameArray(agentIds, EXPECTED_AGENT_IDS)) {
    addError('sync manifest agent mappings do not match the standalone agent files.');
  }

  if (!manifest.skill || !sameArray(Object.keys(manifest.skill).sort(), ['source', 'target'])) {
    addError('sync manifest skill mapping must contain only source and target.');
  } else {
    if (manifest.skill.source !== 'ai-team') {
      addError('sync manifest source skill must remain "ai-team".');
    }
    if (manifest.skill.target !== 'ai-team-orchestration') {
      addError('sync manifest target skill must be "ai-team-orchestration".');
    }
    if (!skillNames.includes(manifest.skill.source)) {
      addError(`sync manifest source skill does not exist: ${manifest.skill.source}`);
    }
  }

  if (!manifest.plugin || !sameArray(Object.keys(manifest.plugin).sort(), ['managedFields', 'target'])) {
    addError('sync manifest plugin mapping must contain only target and managedFields.');
  } else {
    if (manifest.plugin.target !== 'ai-team-orchestration') {
      addError('sync manifest target plugin must be "ai-team-orchestration".');
    }
    if (!sameArray(manifest.plugin.managedFields, EXPECTED_MANAGED_PLUGIN_FIELDS)) {
      addError(`sync manifest managed plugin fields must be exactly: ${EXPECTED_MANAGED_PLUGIN_FIELDS.join(', ')}.`);
    }
    if (plugin && plugin.name !== manifest.plugin.target) {
      addError(`plugin.json name "${plugin.name}" must match sync target plugin "${manifest.plugin.target}".`);
    }
    for (const field of EXPECTED_MANAGED_PLUGIN_FIELDS) {
      if (plugin && !(field in plugin)) {
        addError(`sync manifest manages plugin.json field "${field}", but the source field is missing.`);
      }
    }
  }
}

const plugin = validatePlugin();
const agentIds = validateAgents();
const skillNames = validateSkills();
const files = walkFiles(REPO_ROOT);
validateMarkdownLinks(files);
validateLegacyReferences(files);
validateSyncManifest(plugin, agentIds, skillNames);

if (errors.length > 0) {
  console.error(`Validation failed with ${errors.length} error${errors.length === 1 ? '' : 's'}:`);
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exitCode = 1;
} else {
  console.log('Validation passed.');
}
