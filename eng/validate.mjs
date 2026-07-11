import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  statSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = path.resolve(process.env.AI_TEAM_VALIDATE_ROOT || DEFAULT_REPO_ROOT);
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
const DELIVERY_WORKFLOW_PATH = 'skills/ai-team/references/delivery-workflow.md';
const DELIVERY_WORKFLOW_LINK = './references/delivery-workflow.md';
const SHARED_DELIVERY_HEADING = '## Shared Delivery Lifecycle';
const DELIVERY_STATE_MACHINE = 'Plan → Implement → Dev self-review → Independent review gate → QA acceptance on PR head → Fix/re-verify loop → regular merge → post-merge smoke check';
const REQUIRED_DELIVERY_CONTRACTS = [
  'Every PR-head change invalidates both SHA-bound gates.',
  'A commit cannot durably contain its own SHA.',
  'docs-only closeout PR',
  'no further closeout required',
  'no closeout-of-closeout PR is created',
];
const STALE_POSITIVE_INSTRUCTIONS = [
  'After dev merges, QA',
  'Sprint N is merged to main. Do full playthrough',
  'git pull origin main && git checkout -b',
  '--track origin/main',
  '--track upstream/main',
  'when its verdict was affected',
  'may invalidate that evidence',
  'Self-review SHA: [SHA]',
];
const SLUG_PATTERN = /^[a-z0-9-]+$/;
const AGENT_NAME_MAX_LENGTH = 50;
const DESCRIPTION_MAX_LENGTH = 1024;
const SKILL_NAME_MAX_LENGTH = 64;
const SKILL_DESCRIPTION_MIN_LENGTH = 10;
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

function quotedValue(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const match = /^(['"])(.*)\1$/.exec(value.trim());
  return match ? match[2] : null;
}

function scalarValue(value) {
  if (typeof value !== 'string') {
    return null;
  }
  return quotedValue(value) ?? value.trim();
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

  if (typeof plugin.name === 'string'
    && (plugin.name.length < 1
      || plugin.name.length > 50
      || !SLUG_PATTERN.test(plugin.name))) {
    addError('plugin.json field "name" must be a lowercase slug between 1 and 50 characters.');
  }

  if (typeof plugin.description === 'string'
    && (plugin.description.length < 1 || plugin.description.length > 500)) {
    addError('plugin.json field "description" must be between 1 and 500 characters.');
  }

  if (!SEMVER_PATTERN.test(plugin.version ?? '')) {
    addError(`plugin.json version "${plugin.version ?? ''}" is not valid SemVer.`);
  }

  if (!Array.isArray(plugin.keywords)
    || plugin.keywords.length === 0
    || plugin.keywords.length > 10
    || plugin.keywords.some((keyword) => typeof keyword !== 'string'
      || keyword.length < 1
      || keyword.length > 30
      || !SLUG_PATTERN.test(keyword))) {
    addError('plugin.json field "keywords" must contain 1-10 lowercase slugs, each between 1 and 30 characters.');
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
    } else {
      if (frontmatterName.length < 1
        || frontmatterName.length > AGENT_NAME_MAX_LENGTH
        || !SLUG_PATTERN.test(frontmatterName)) {
        addError(`${repoPath(filePath)} frontmatter name must be a lowercase slug between 1 and ${AGENT_NAME_MAX_LENGTH} characters.`);
      }
      if (frontmatterName !== fileId) {
        addError(`${repoPath(filePath)} filename ID "${fileId}" does not match frontmatter name "${frontmatterName}".`);
      }
    }

    const description = quotedValue(fields.get('description'));
    if (description === null) {
      addError(`${repoPath(filePath)} frontmatter description must be properly matching-quoted.`);
    } else if (description.trim() === '' || description.length > DESCRIPTION_MAX_LENGTH) {
      addError(`${repoPath(filePath)} frontmatter description must be between 1 and ${DESCRIPTION_MAX_LENGTH} characters.`);
    }

    const tools = fields.get('tools');
    if (tools !== undefined) {
      const toolsMatch = typeof tools === 'string' ? /^\[(.*)\]$/.exec(tools) : null;
      if (!toolsMatch) {
        addError(`${repoPath(filePath)} tools must be an inline array of quoted strings.`);
        continue;
      }

      const toolsBody = toolsMatch[1].trim();
      if (toolsBody !== '') {
        const toolEntries = toolsBody.split(',').map((entry) => entry.trim());
        const toolNames = toolEntries.map((entry) => quotedValue(entry));
        if (toolNames.some((entry) => entry === null || entry.trim() === '')) {
          addError(`${repoPath(filePath)} tools must contain only non-empty quoted strings.`);
        }
      }
    }
  }

  return actualIds;
}

function validateSkillTree(skillDirectory) {
  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      const entryStat = lstatSync(entryPath);
      if (entryStat.isSymbolicLink()) {
        addError(`${repoPath(entryPath)} must not be a symbolic link, junction, or reparse point.`);
      } else if (entryStat.isDirectory()) {
        visit(entryPath);
      } else if (entryStat.isFile()) {
        if (entryStat.size > SKILL_FILE_MAX_BYTES) {
          addError(`${repoPath(entryPath)} exceeds the ${SKILL_FILE_MAX_BYTES}-byte skill file limit.`);
        }
      } else {
        addError(`${repoPath(entryPath)} must be a regular file or directory.`);
      }
    }
  }
  visit(skillDirectory);
}

function validateSkills() {
  const skillsDirectory = path.join(REPO_ROOT, 'skills');
  if (!existsSync(skillsDirectory) || !statSync(skillsDirectory).isDirectory()) {
    addError('Required skills/ directory is missing.');
    return [];
  }
  const skillEntries = readdirSync(skillsDirectory, { withFileTypes: true });
  for (const entry of skillEntries.filter((candidate) => candidate.isSymbolicLink())) {
    addError(`skills/${entry.name} must not be a symbolic link, junction, or reparse point.`);
  }
  const skillNames = skillEntries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  for (const folderName of skillNames) {
    const skillDirectory = path.join(skillsDirectory, folderName);
    if (folderName.length < 1
      || folderName.length > SKILL_NAME_MAX_LENGTH
      || !SLUG_PATTERN.test(folderName)) {
      addError(`skills/${folderName} folder name must be a lowercase slug between 1 and ${SKILL_NAME_MAX_LENGTH} characters.`);
    }
    validateSkillTree(skillDirectory);

    const skillPath = path.join(skillDirectory, 'SKILL.md');
    if (!existsSync(skillPath)) {
      addError(`skills/${folderName} is missing SKILL.md.`);
      continue;
    }

    const fields = parseFrontmatter(skillPath);
    if (!fields) {
      continue;
    }

    const frontmatterName = scalarValue(fields.get('name'));
    if (!frontmatterName) {
      addError(`${repoPath(skillPath)} must have a non-empty frontmatter name.`);
    } else {
      if (frontmatterName.length > SKILL_NAME_MAX_LENGTH
        || !SLUG_PATTERN.test(frontmatterName)) {
        addError(`${repoPath(skillPath)} frontmatter name must be a lowercase slug between 1 and ${SKILL_NAME_MAX_LENGTH} characters.`);
      }
      if (frontmatterName !== folderName) {
        addError(`${repoPath(skillPath)} frontmatter name "${frontmatterName}" must match folder name "${folderName}".`);
      }
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

    const description = quotedValue(fields.get('description'));
    if (description === null) {
      addError(`${repoPath(skillPath)} frontmatter description must be properly matching-quoted.`);
    } else if (description.length < SKILL_DESCRIPTION_MIN_LENGTH
      || description.length > DESCRIPTION_MAX_LENGTH) {
      addError(`${repoPath(skillPath)} frontmatter description must be between ${SKILL_DESCRIPTION_MIN_LENGTH} and ${DESCRIPTION_MAX_LENGTH} characters.`);
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
    if (entry.isSymbolicLink()) {
      continue;
    } else if (entry.isDirectory()) {
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

function extractUniqueH2Section(contents, heading, filePath) {
  const headingPattern = new RegExp(`^${escapeRegExp(heading)}\\r?$`, 'gm');
  const matches = [...contents.matchAll(headingPattern)];
  if (matches.length !== 1) {
    addError(`${repoPath(filePath)} must contain exactly one "${heading}" section; found ${matches.length}.`);
    return null;
  }

  const startIndex = matches[0].index;
  const headingLineEnd = contents.indexOf('\n', startIndex);
  if (headingLineEnd === -1) {
    return contents.slice(startIndex);
  }

  const nextHeadingPattern = /^## [^\r\n]+\r?$/gm;
  nextHeadingPattern.lastIndex = headingLineEnd + 1;
  const nextHeading = nextHeadingPattern.exec(contents);
  const endIndex = nextHeading ? nextHeading.index : contents.length;
  return contents.slice(startIndex, endIndex);
}

function validateDeliveryWorkflow(files) {
  const deliveryPath = path.join(REPO_ROOT, DELIVERY_WORKFLOW_PATH);
  if (!existsSync(deliveryPath) || !statSync(deliveryPath).isFile()) {
    addError(`${DELIVERY_WORKFLOW_PATH} is required.`);
  } else {
    const deliveryWorkflow = readFileSync(deliveryPath, 'utf8');
    for (const contract of REQUIRED_DELIVERY_CONTRACTS) {
      if (!deliveryWorkflow.includes(contract)) {
        addError(`${DELIVERY_WORKFLOW_PATH} must contain canonical contract "${contract}".`);
      }
    }
  }

  const skillPath = path.join(REPO_ROOT, 'skills', 'ai-team', 'SKILL.md');
  if (existsSync(skillPath)) {
    const skillContents = readFileSync(skillPath, 'utf8');
    if (!markdownDestinations(skillContents).includes(DELIVERY_WORKFLOW_LINK)) {
      addError(`skills/ai-team/SKILL.md must link to ${DELIVERY_WORKFLOW_LINK}.`);
    }
  }

  const sharedSections = [];
  for (const agentId of EXPECTED_AGENT_IDS) {
    const agentPath = path.join(REPO_ROOT, 'agents', `${agentId}.agent.md`);
    if (!existsSync(agentPath)) {
      continue;
    }

    const contents = readFileSync(agentPath, 'utf8');
    const section = extractUniqueH2Section(
      contents,
      SHARED_DELIVERY_HEADING,
      agentPath,
    );
    if (section === null) {
      continue;
    }
    if (!section.includes(DELIVERY_STATE_MACHINE)) {
      addError(`${repoPath(agentPath)} shared delivery section must contain the canonical state machine.`);
    }
    sharedSections.push({ agentPath, section });
  }

  if (sharedSections.length === EXPECTED_AGENT_IDS.length) {
    const [{ section: expectedSection }] = sharedSections;
    for (const { agentPath, section } of sharedSections.slice(1)) {
      if (section !== expectedSection) {
        addError(`${repoPath(agentPath)} Shared Delivery Lifecycle section must be byte-identical across all agents.`);
      }
    }
  }

  const projectBriefPath = path.join(
    REPO_ROOT,
    'skills',
    'ai-team',
    'references',
    'project-brief-template.md',
  );
  if (existsSync(projectBriefPath)) {
    const projectBrief = readFileSync(projectBriefPath, 'utf8');
    if (!/^## 15\. Delivery & Review Gates\s*\r?$/m.test(projectBrief)) {
      addError(`${repoPath(projectBriefPath)} must contain Section 15: Delivery & Review Gates.`);
    }
  }

  const sprintPlanPath = path.join(
    REPO_ROOT,
    'skills',
    'ai-team',
    'references',
    'sprint-plan-template.md',
  );
  if (existsSync(sprintPlanPath)) {
    const sprintPlan = readFileSync(sprintPlanPath, 'utf8');
    const qaHeading = '## QA Acceptance and Archive Template';
    const qaHeadingMatches = [...sprintPlan.matchAll(
      new RegExp(`^${escapeRegExp(qaHeading)}\\r?$`, 'gm'),
    )];
    if (qaHeadingMatches.length !== 1) {
      addError(`${repoPath(sprintPlanPath)} must contain exactly one "${qaHeading}" section; found ${qaHeadingMatches.length}.`);
    } else {
      const qaSignoff = sprintPlan.slice(qaHeadingMatches[0].index);
      if (!/Commit SHA:/i.test(qaSignoff)) {
        addError(`${repoPath(sprintPlanPath)} QA sign-off must record a commit SHA.`);
      }
      if (!qaSignoff.includes('Ready for merge') || !qaSignoff.includes('Blocked')) {
        addError(`${repoPath(sprintPlanPath)} QA sign-off must use Ready for merge / Blocked semantics.`);
      }
      if (!qaSignoff.includes('PR review, comment, or check')) {
        addError(`${repoPath(sprintPlanPath)} QA acceptance must be recorded as a live PR artifact before archival.`);
      }
    }
    if (!sprintPlan.includes('git switch --no-track --create')) {
      addError(`${repoPath(sprintPlanPath)} must create feature branches without tracking origin/main.`);
    }
    if (!sprintPlan.includes('Post-Merge Closeout')) {
      addError(`${repoPath(sprintPlanPath)} must define the post-merge docs-only closeout.`);
    }
    for (const contract of [
      'no further closeout required',
      'do not create a closeout-of-closeout PR',
    ]) {
      if (!sprintPlan.includes(contract)) {
        addError(`${repoPath(sprintPlanPath)} closeout instructions must contain "${contract}".`);
      }
    }
  }

  for (const filePath of files.filter((candidate) => candidate.endsWith('.md'))) {
    const contents = readFileSync(filePath, 'utf8');
    for (const staleInstruction of STALE_POSITIVE_INSTRUCTIONS) {
      if (contents.includes(staleInstruction)) {
        addError(`${repoPath(filePath)} contains stale delivery instruction "${staleInstruction}".`);
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
validateDeliveryWorkflow(files);
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
