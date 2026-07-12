export const CANONICAL_AGENT_IDS = Object.freeze([
  'ai-team-dev',
  'ai-team-producer',
  'ai-team-qa',
]);

export const CANONICAL_SKILL_SOURCE = 'ai-team';
export const CANONICAL_SKILL_TARGET = 'ai-team-orchestration';
export const CANONICAL_PLUGIN_TARGET = 'ai-team-orchestration';
export const CANONICAL_MANAGED_PLUGIN_FIELDS = Object.freeze([
  'description',
  'version',
  'keywords',
  'author',
  'license',
]);

function sameArray(actual, expected) {
  return Array.isArray(actual)
    && actual.length === expected.length
    && actual.every((value, index) => value === expected[index]);
}

function hasExactKeys(value, expectedKeys) {
  return value
    && typeof value === 'object'
    && !Array.isArray(value)
    && sameArray(Object.keys(value).sort(), [...expectedKeys].sort());
}

export function assertCanonicalSyncManifest(manifest) {
  if (!hasExactKeys(manifest, ['agents', 'plugin', 'skill'])) {
    throw new Error('Synchronization manifest must contain only agents, skill, and plugin top-level keys.');
  }
  if (!sameArray(manifest.agents, CANONICAL_AGENT_IDS)) {
    throw new Error(`Synchronization manifest agents must be exactly: ${CANONICAL_AGENT_IDS.join(', ')}.`);
  }
  if (!hasExactKeys(manifest.skill, ['source', 'target'])) {
    throw new Error('Synchronization manifest skill mapping must contain only source and target.');
  }
  if (manifest.skill.source !== CANONICAL_SKILL_SOURCE) {
    throw new Error(`Synchronization manifest source skill must remain "${CANONICAL_SKILL_SOURCE}".`);
  }
  if (manifest.skill.target !== CANONICAL_SKILL_TARGET) {
    throw new Error(`Synchronization manifest target skill must be "${CANONICAL_SKILL_TARGET}".`);
  }
  if (!hasExactKeys(manifest.plugin, ['managedFields', 'target'])) {
    throw new Error('Synchronization manifest plugin mapping must contain only target and managedFields.');
  }
  if (manifest.plugin.target !== CANONICAL_PLUGIN_TARGET) {
    throw new Error(`Synchronization manifest target plugin must be "${CANONICAL_PLUGIN_TARGET}".`);
  }
  if (!sameArray(manifest.plugin.managedFields, CANONICAL_MANAGED_PLUGIN_FIELDS)) {
    throw new Error(`Synchronization manifest managed plugin fields must be exactly: ${CANONICAL_MANAGED_PLUGIN_FIELDS.join(', ')}.`);
  }
  return true;
}
