import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  cpSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const AGENTS = ['com.github.copilot', 'agents'];
const SKILL = ['skills', 'ai-team-orchestration'];

function createRepositoryCopy(context) {
  const targetRoot = mkdtempSync(path.join(tmpdir(), 'ai-team-validate-'));
  context.after(() => rmSync(targetRoot, { force: true, recursive: true }));
  cpSync(REPO_ROOT, targetRoot, {
    filter: (sourcePath) => path.basename(sourcePath) !== '.git',
    recursive: true,
  });
  return targetRoot;
}

function pluginPath(targetRoot, ...segments) {
  return path.join(targetRoot, 'plugins', 'ai-team-orchestration', ...segments);
}

function runValidator(targetRoot) {
  return spawnSync(process.execPath, [path.join(targetRoot, 'eng', 'validate.mjs')], {
    cwd: targetRoot,
    encoding: 'utf8',
  });
}

// Runs the validator with a preload that records the path of each file whose content is read.
function runValidatorTracingReads(context, targetRoot) {
  const traceRoot = mkdtempSync(path.join(tmpdir(), 'ai-team-reads-'));
  context.after(() => rmSync(traceRoot, { force: true, recursive: true }));
  const logPath = path.join(traceRoot, 'reads.log');
  const preloadPath = path.join(traceRoot, 'trace-reads.cjs');
  writeFileSync(preloadPath, [
    "const fs = require('node:fs');",
    "const { syncBuiltinESMExports } = require('node:module');",
    'const descriptors = new Map();',
    'const openSync = fs.openSync;',
    'fs.openSync = function tracedOpenSync(file, ...rest) {',
    '  const descriptor = openSync.call(this, file, ...rest);',
    '  descriptors.set(descriptor, String(file));',
    '  return descriptor;',
    '};',
    'const readFileSync = fs.readFileSync;',
    'fs.readFileSync = function tracedReadFileSync(file, ...rest) {',
    "  const name = typeof file === 'number' ? descriptors.get(file) ?? `fd:${file}` : String(file);",
    `  fs.appendFileSync(${JSON.stringify(logPath)}, \`\${name}\\n\`);`,
    '  return readFileSync.call(this, file, ...rest);',
    '};',
    'syncBuiltinESMExports();',
    '',
  ].join('\n'), 'utf8');
  const result = spawnSync(process.execPath, ['--require', preloadPath, path.join(targetRoot, 'eng', 'validate.mjs')], {
    cwd: targetRoot,
    encoding: 'utf8',
  });
  const reads = readFileSync(logPath, 'utf8').split('\n').filter(Boolean).map(comparablePath);
  return { result, reads };
}

function comparablePath(file) {
  let resolved = path.resolve(file);
  try {
    resolved = realpathSync.native(resolved);
  } catch {
    // Keep the lexical path for a file that does not exist.
  }
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function mutateText(filePath, oldText, newText) {
  const contents = readFileSync(filePath, 'utf8');
  assert.ok(contents.includes(oldText), `Fixture text not found: ${oldText}`);
  writeFileSync(filePath, contents.replace(oldText, newText), 'utf8');
}

function mutatePlugin(targetRoot, mutation) {
  const manifestPath = pluginPath(targetRoot, 'plugin.json');
  const plugin = JSON.parse(readFileSync(manifestPath, 'utf8'));
  mutation(plugin);
  writeFileSync(manifestPath, `${JSON.stringify(plugin, null, 2)}\n`, 'utf8');
}

function copyFile(sourcePath, targetPath) {
  mkdirSync(path.dirname(targetPath), { recursive: true });
  cpSync(sourcePath, targetPath);
}

function assertRejected(targetRoot, pattern) {
  const result = runValidator(targetRoot);
  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stderr, pattern);
}

function trySymlink(context, target, linkPath) {
  try {
    symlinkSync(target, linkPath, process.platform === 'win32' ? 'file' : undefined);
    return true;
  } catch (error) {
    context.skip(`Symbolic links are unavailable: ${error.message}`);
    return false;
  }
}

test('validator accepts the plugin repository', (context) => {
  const targetRoot = createRepositoryCopy(context);
  const result = runValidator(targetRoot);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Validation passed/);
});

test('bundled agents intentionally omit tools and model', (context) => {
  for (const field of ['tools', 'model']) {
    const targetRoot = createRepositoryCopy(context);
    mutateText(
      pluginPath(targetRoot, ...AGENTS, 'ai-team-dev.md'),
      "name: 'ai-team-dev'",
      `name: 'ai-team-dev'\n${field}: 'unexpected'`,
    );
    assertRejected(targetRoot, new RegExp(`unsupported frontmatter field "${field}"`));
  }
});

test('bundled agents opt in to repository instructions as subagents', (context) => {
  for (const replacement of [
    '',
    'include-custom-instructions: false',
    'include-custom-instructions:true',
    'include-custom-instructions: \u00a0true',
  ]) {
    const targetRoot = createRepositoryCopy(context);
    mutateText(
      pluginPath(targetRoot, ...AGENTS, 'ai-team-qa.md'),
      'include-custom-instructions: true',
      replacement,
    );
    assertRejected(targetRoot, /must contain exactly "include-custom-instructions: true"/);
  }
});

test('validator enforces the three stable agent IDs and file names', async (context) => {
  for (const renamedFile of ['dev.md', 'ai-team-dev.agent.md']) {
    await context.test(`rename to ${renamedFile}`, (subtest) => {
      const targetRoot = createRepositoryCopy(subtest);
      const agentPath = pluginPath(targetRoot, ...AGENTS, 'ai-team-dev.md');
      copyFile(agentPath, pluginPath(targetRoot, ...AGENTS, renamedFile));
      rmSync(agentPath);
      assertRejected(targetRoot, /com\.github\.copilot\/agents\/ai-team-dev\.md is missing/);
    });
  }
});

test('validator enforces the skill identity and frontmatter', async (context) => {
  for (const [name, oldText, newText, pattern] of [
    ['another name', 'name: ai-team-orchestration', 'name: ai-team', /must match folder name/],
    ['quoted name', 'name: ai-team-orchestration', "name: 'ai-team-orchestration'", /name line must be exactly "name: ai-team-orchestration"/],
    ['extra field', "description: 'Bootstrap", "tools: []\ndescription: 'Bootstrap", /unsupported frontmatter field "tools"/],
  ]) {
    await context.test(name, (subtest) => {
      const targetRoot = createRepositoryCopy(subtest);
      mutateText(pluginPath(targetRoot, ...SKILL, 'SKILL.md'), oldText, newText);
      assertRejected(targetRoot, pattern);
    });
  }
});

test('validator rejects unresolved relative Markdown links', (context) => {
  const targetRoot = createRepositoryCopy(context);
  mutateText(
    pluginPath(targetRoot, ...SKILL, 'SKILL.md'),
    '[anti-patterns](./references/anti-patterns.md)',
    '[anti-patterns](./references/missing.md)',
  );
  assertRejected(targetRoot, /unresolved relative Markdown link: \.\/references\/missing\.md/);
});

test('validator rejects plugin links that leave the installed payload', async (context) => {
  for (const [name, link, pattern] of [
    ['parent-relative link', '[License](../../LICENSE)', /links outside plugins\/ai-team-orchestration/],
    ['root-relative link', '[License](/LICENSE)', /root-relative link/],
    ['link with a parenthesized title', '[License](../../LICENSE (License))', /links outside plugins\/ai-team-orchestration/],
    ['link text with nested brackets', '[[License]](../../LICENSE)', /links outside plugins\/ai-team-orchestration/],
    ['reference with an escaped label', '[License][a\\]]\n\n[a\\]]: ../../LICENSE', /links outside plugins\/ai-team-orchestration/],
    ['HTML link', '<a href="../../LICENSE">License</a>', /links outside plugins\/ai-team-orchestration/],
    ['HTML link without quotes', '<a href=../../LICENSE>License</a>', /links outside plugins\/ai-team-orchestration/],
    ['HTML attribute with a quoted >', '<a title="a>b" href="../../LICENSE">License</a>', /links outside plugins\/ai-team-orchestration/],
    ['data-src before src', '<img data-src="./README.md" src="../../LICENSE">', /links outside plugins\/ai-team-orchestration/],
    ['reference definition in a block quote', '[License][a]\n\n> [a]: ../../LICENSE', /links outside plugins\/ai-team-orchestration/],
    ['link after a longer closing fence', '```\ncode\n````\n\n[License](../../LICENSE)', /links outside plugins\/ai-team-orchestration/],
    ['link after a tilde fence that contains backticks', '~~~\n```\n~~~\n\n[License](../../LICENSE)', /links outside plugins\/ai-team-orchestration/],
    ['link after a fence in a list item', '- Item\n  ```\n  code\n- [License](../../LICENSE)', /links outside plugins\/ai-team-orchestration/],
    ['reference definition in angle brackets', '[License][a]\n\n[a]: <../../LICENSE>', /links outside plugins\/ai-team-orchestration/],
    ['destination in angle brackets', '[License](<LICENSE>)', /unresolved relative Markdown link: LICENSE/],
    ['parent path in a code span', 'Do not write `../../LICENSE` here.', /README\.md contains a parent-directory path/],
    ['bare parent segment in a code span', 'Do not write `[Parent](..)` here.', /README\.md contains a parent-directory path/],
    ['link after an indented fence with a flush-left closer', '  ```\ncode\n```\n\n[License](../../LICENSE)', /links outside plugins\/ai-team-orchestration/],
    ['encoded parent path', 'See %2E%2E%2fLICENSE and &#46;&#46;&#47;x.', /README\.md contains a parent-directory path/],
    ['root-relative srcset candidate after prose with a colon', 'Example [dark]:\n<img srcset="./README.md 1x, /root.png 2x" alt="">', /root-relative link/],
    ['escaped root-relative link after a fence on a list marker', '- ```\n  code\n  ```\n  [License](\\/LICENSE)', /root-relative link/],
    ['root-relative HTML link with a leading space', '- Item\n  ```\n  code\n```\n\n<a href=" /LICENSE">License</a>', /root-relative link/],
    ['attribute after a quoted value without white space', '<img alt="x"src="../../LICENSE">', /links outside plugins\/ai-team-orchestration/],
    ['attribute value with encoded line breaks', '<div>\n<img src=".&#10;./.&#10;./LICENSE">\n</div>', /links outside plugins\/ai-team-orchestration/],
    ['destination with an escaped parenthesis', '[License](README.md\\)/../../LICENSE)', /links outside plugins\/ai-team-orchestration/],
    ['file URL with outer white space', '<a href=" file:///LICENSE ">License</a>', /README\.md has a local file link, which installed copies cannot resolve: file:\/\/\/LICENSE/],
    ['file URL in an autolink', '<file:///LICENSE>', /README\.md has a local file link, which installed copies cannot resolve: file:\/\/\/LICENSE/],
    ['file URL in an autolink with a nonbreaking space', '<file:///my\u00A0notes.md>', /README\.md has a local file link, which installed copies cannot resolve: file:\/\/\/my\u00A0notes\.md/],
    ['unquoted attribute value with a nonbreaking space', '<img src=README.md\u00A0/.&#10;./.&#10;./LICENSE>', /links outside plugins\/ai-team-orchestration/],
    ['destination with a nonbreaking space', '[License](README.md\u00A0/../../LICENSE)', /links outside plugins\/ai-team-orchestration/],
    ['HTML link with a trailing nonbreaking space', '<a href="README.md\u00A0">x</a>', /unresolved relative Markdown link: README\.md\u00A0/],
    ['unquoted HTML link with a leading nonbreaking space', '<a href=\u00A0README.md>x</a>', /unresolved relative Markdown link: \u00A0README\.md/],
    ['destination with a leading nonbreaking space', '[x](\u00A0README.md)', /unresolved relative Markdown link: \u00A0README\.md/],
    ['HTML link to a Windows path with an escaped-looking dot', '<a href="C:\\.cache\\notes.md">Notes</a>', /README\.md has a local file link, which installed copies cannot resolve: C:\\\.cache\\notes\.md/],
    ['srcset candidate after an encoded comma', '<img srcset="README.md 1x&#44;/root.png 2x" alt="">', /root-relative link/],
    ['srcset candidate after a named comma reference', '<img srcset="README.md 1x&comma;/root.png 2x" alt="">', /root-relative link/],
    ['destination with nested parentheses', '[Missing](((draft)).md)', /unresolved relative Markdown link: \(\(draft\)\)\.md/],
  ]) {
    await context.test(name, (subtest) => {
      const targetRoot = createRepositoryCopy(subtest);
      mutateText(pluginPath(targetRoot, 'README.md'), '## Origin', `${link}\n\n## Origin`);
      assertRejected(targetRoot, pattern);
    });
  }
  for (const [name, text] of [
    ['data URL in srcset', '<img srcset="data:image/png;base64,AAAA 1x" alt="">'],
    ['full URL with an attribute name in its path', 'See https://example.com/src=icon for details.'],
    ['full URL with a nonbreaking space before an attribute-like path', '<https://example.com/a\u00A0b/src=icon>'],
  ]) {
    await context.test(`ignores a ${name}`, (subtest) => {
      const targetRoot = createRepositoryCopy(subtest);
      mutateText(pluginPath(targetRoot, 'README.md'), '## Origin', `${text}\n\n## Origin`);
      const result = runValidator(targetRoot);
      assert.equal(result.status, 0, result.stderr);
    });
  }
});

test('validator checks link forms in code examples', async (context) => {
  for (const [name, file, example, pattern] of [
    ['fenced code block in plugin Markdown', 'plugin', '```html\n<img src="assets/example.png">\n```', /README\.md has an unresolved relative Markdown link: assets\/example\.png/],
    ['HTML tag in a code span in plugin Markdown', 'plugin', 'Use `<img src="assets/example.png">` in a page.', /README\.md has an unresolved relative Markdown link: assets\/example\.png/],
    ['fenced block with CRLF line endings in repository Markdown', 'repository', '~~~\r\n[x](./not-a-file.md)\r\n~~~', /CONTRIBUTING\.md has an unresolved relative Markdown link: \.\/not-a-file\.md/],
  ]) {
    await context.test(name, (subtest) => {
      const targetRoot = createRepositoryCopy(subtest);
      const [filePath, heading] = file === 'plugin'
        ? [pluginPath(targetRoot, 'README.md'), '## Origin']
        : [path.join(targetRoot, 'CONTRIBUTING.md'), '## Pull requests'];
      mutateText(filePath, heading, `${example}\n\n${heading}`);
      assertRejected(targetRoot, pattern);
    });
  }
});

test('validator reports broken repository links without failing', async (context) => {
  for (const [name, link, pattern] of [
    ['path through a file', '[x](./LICENSE/x.md)', /unresolved relative Markdown link: \.\/LICENSE\/x\.md/],
    ['encoded NUL character', '[x](./bad%00name.md)', /invalid encoded Markdown link: \.\/bad%00name\.md/],
    ['HTML link after a quoted greater-than sign', '<a title="x>y" href="./not-a-file.md">x</a>', /CONTRIBUTING\.md has an unresolved relative Markdown link: \.\/not-a-file\.md/],
  ]) {
    await context.test(name, (subtest) => {
      const targetRoot = createRepositoryCopy(subtest);
      mutateText(path.join(targetRoot, 'CONTRIBUTING.md'), '## Pull requests', `${link}\n\n## Pull requests`);
      assertRejected(targetRoot, pattern);
    });
  }
  await context.test('ignores an assignment outside an HTML tag', (subtest) => {
    const targetRoot = createRepositoryCopy(subtest);
    mutateText(path.join(targetRoot, 'CONTRIBUTING.md'), '## Pull requests', "```python\ndata = load('input.json')\n```\n\n## Pull requests");
    const result = runValidator(targetRoot);
    assert.equal(result.status, 0, result.stderr);
  });
  await context.test('keeps an unknown character reference literal', (subtest) => {
    const targetRoot = createRepositoryCopy(subtest);
    writeFileSync(path.join(targetRoot, 'docs', 'a&constructor;.md'), '# Example\n', 'utf8');
    mutateText(path.join(targetRoot, 'CONTRIBUTING.md'), '## Pull requests', '[x](./docs/a&constructor;.md)\n\n## Pull requests');
    const result = runValidator(targetRoot);
    assert.equal(result.status, 0, result.stderr);
  });
  await context.test('dangling symbolic link', (subtest) => {
    const targetRoot = createRepositoryCopy(subtest);
    if (trySymlink(subtest, path.join(targetRoot, 'missing.md'), path.join(targetRoot, 'docs', 'dangling.md'))) {
      mutateText(path.join(targetRoot, 'CONTRIBUTING.md'), '## Pull requests', '[x](./docs/dangling.md)\n\n## Pull requests');
      assertRejected(targetRoot, /unresolved relative Markdown link: \.\/docs\/dangling\.md/);
    }
  });
});

test('validator requires an Agent Plugins 1.0 manifest', async (context) => {
  for (const [name, mutation, pattern] of [
    ['legacy agents field', (plugin) => { plugin.agents = 'agents/'; }, /field "agents" is not part of Agent Plugins 1\.0/],
    ['missing $schema', (plugin) => { delete plugin.$schema; }, /field "\$schema" must be exactly/],
    ['missing description', (plugin) => { delete plugin.description; }, /field "description" must be a non-empty string/],
    ['version object', (plugin) => { plugin.version = { toString: null }; }, /field "version" must be a non-empty string/],
    ['author string', (plugin) => { plugin.author = 'Example Author'; }, /field "author" must be an object/],
    ['repository outside GitHub', (plugin) => { plugin.repository = 'https://example.com/plugin'; }, /field "repository" must be an https:\/\/github\.com\/ URL/],
    ['empty homepage', (plugin) => { plugin.homepage = ''; }, /field "homepage" must be a non-empty string/],
    ['extensions array', (plugin) => { plugin.extensions = []; }, /field "extensions" must map namespaces to objects/],
  ]) {
    await context.test(name, (subtest) => {
      const targetRoot = createRepositoryCopy(subtest);
      mutatePlugin(targetRoot, mutation);
      assertRejected(targetRoot, pattern);
    });
  }
});

test('validator keeps the installed file set exact', async (context) => {
  await context.test('extra top-level file', (subtest) => {
    const targetRoot = createRepositoryCopy(subtest);
    writeFileSync(pluginPath(targetRoot, 'NOTES.md'), '# Notes\n', 'utf8');
    assertRejected(targetRoot, /plugins\/ai-team-orchestration\/NOTES\.md is not part of the plugin file set/);
  });
  await context.test('second package inside the skill', (subtest) => {
    const targetRoot = createRepositoryCopy(subtest);
    copyFile(pluginPath(targetRoot, 'plugin.json'), pluginPath(targetRoot, ...SKILL, 'references', 'copy', 'plugin.json'));
    assertRejected(targetRoot, /references\/copy is not part of the plugin file set/);
  });
  await context.test('missing reference', (subtest) => {
    const targetRoot = createRepositoryCopy(subtest);
    rmSync(pluginPath(targetRoot, ...SKILL, 'references', 'anti-patterns.md'));
    assertRejected(targetRoot, /references\/anti-patterns\.md is missing or is not a regular file/);
  });
  await context.test('missing third-party notice', (subtest) => {
    const targetRoot = createRepositoryCopy(subtest);
    rmSync(pluginPath(targetRoot, ...SKILL, 'NOTICE'));
    assertRejected(targetRoot, /skills\/ai-team-orchestration\/NOTICE is missing or is not a regular file/);
  });
  await context.test('directory in place of README.md', (subtest) => {
    const targetRoot = createRepositoryCopy(subtest);
    const readmePath = pluginPath(targetRoot, 'README.md');
    const contents = readFileSync(readmePath);
    rmSync(readmePath);
    mkdirSync(readmePath);
    writeFileSync(path.join(readmePath, 'index.md'), contents);
    assertRejected(targetRoot, /README\.md is missing or is not a regular file/);
  });
  await context.test('empty extra skill directory', (subtest) => {
    const targetRoot = createRepositoryCopy(subtest);
    mkdirSync(pluginPath(targetRoot, 'skills', 'extra-skill'));
    assertRejected(targetRoot, /skills\/extra-skill is not part of the plugin file set/);
  });
  await context.test('reference that is not UTF-8', (subtest) => {
    const targetRoot = createRepositoryCopy(subtest);
    const referencePath = pluginPath(targetRoot, ...SKILL, 'references', 'anti-patterns.md');
    writeFileSync(referencePath, Buffer.concat([readFileSync(referencePath), Buffer.from([0xff, 0xfe, 0xfd])]));
    assertRejected(targetRoot, /references\/anti-patterns\.md is not valid UTF-8/);
  });
  await context.test('manifest with a byte order mark', (subtest) => {
    const targetRoot = createRepositoryCopy(subtest);
    const manifestPath = pluginPath(targetRoot, 'plugin.json');
    writeFileSync(manifestPath, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), readFileSync(manifestPath)]));
    assertRejected(targetRoot, /plugin\.json must not start with a UTF-8 byte order mark/);
  });
});

test('validator requires the license notice for the upstream material', async (context) => {
  const noticePath = (targetRoot) => pluginPath(targetRoot, ...SKILL, 'NOTICE');
  const licensePath = (targetRoot) => path.join(targetRoot, 'LICENSE');
  const grant = 'Permission is hereby granted';
  // Keeps the text up to the grant, with or without the grant itself.
  const truncate = (filePath, keepGrant) => {
    const contents = readFileSync(filePath, 'utf8');
    assert.ok(contents.includes(grant), `Fixture text not found: ${grant}`);
    writeFileSync(filePath, contents.slice(0, contents.indexOf(grant) + (keepGrant ? grant.length : 0)), 'utf8');
  };
  for (const [name, mutate, pattern] of [
    ['notice without the GitHub copyright line', (root) => mutateText(noticePath(root), 'Copyright GitHub, Inc.', ''), /NOTICE must have the line "Copyright GitHub, Inc\."/],
    ['notice with a changed permission notice', (root) => mutateText(noticePath(root), 'and/or sell', 'or sell'), /NOTICE must end with the complete MIT permission notice/],
    ['notice with a legacy agent mention', (root) => mutateText(noticePath(root), 'Third-party notices', `Third-party notices @${'producer'}`), new RegExp(`NOTICE contains legacy agent mention "@${'producer'}"`)],
    ['LICENSE without the GitHub copyright line', (root) => mutateText(licensePath(root), 'Copyright GitHub, Inc. (portions;', 'Copyright (c) GitHub (portions;'), /LICENSE must have the line "Copyright GitHub, Inc\. \(portions; see/],
    ['LICENSE with a wrong notice path', (root) => mutateText(licensePath(root), 'ai-team-orchestration/NOTICE)', 'ai-team-orchestration/LICENSE)'), /LICENSE must have the line "Copyright GitHub, Inc\. \(portions; see/],
    ['LICENSE with a suffix after the notice path', (root) => mutateText(licensePath(root), 'ai-team-orchestration/NOTICE)', 'ai-team-orchestration/NOTICE.bak)'), /LICENSE must have the line "Copyright GitHub, Inc\. \(portions; see/],
    ['LICENSE line that GitHub does not detect', (root) => mutateText(licensePath(root), grant, `Portions Copyright GitHub, Inc.\n\n${grant}`), /LICENSE line "Portions Copyright GitHub, Inc\." must be the title or start with "Copyright"/],
    ['LICENSE without a permission notice', (root) => truncate(licensePath(root), false), /^- LICENSE must end with the complete MIT permission notice\.$/m],
    ['LICENSE with the grant joined to a copyright line', (root) => writeFileSync(licensePath(root), readFileSync(licensePath(root), 'utf8').replace(/\r?\n\s*Permission is hereby granted/, ' Permission is hereby granted'), 'utf8'), /^- LICENSE must end with the complete MIT permission notice\.$/m],
    ['LICENSE and notice truncated in the same way', (root) => { truncate(licensePath(root), true); truncate(noticePath(root), true); }, /^- LICENSE must end with the complete MIT permission notice\.$[\s\S]*NOTICE must end with the complete MIT permission notice/m],
  ]) {
    await context.test(name, (subtest) => {
      const targetRoot = createRepositoryCopy(subtest);
      mutate(targetRoot);
      assertRejected(targetRoot, pattern);
    });
  }
  await context.test('accepts a rewrapped permission notice', (subtest) => {
    const targetRoot = createRepositoryCopy(subtest);
    mutateText(licensePath(targetRoot), `${grant}, free of charge,`, 'Permission is hereby\ngranted, free of charge,');
    const result = runValidator(targetRoot);
    assert.equal(result.status, 0, result.stderr);
  });
});

test('validator never reads rejected plugin files', async (context) => {
  await context.test('hard-linked README', (subtest) => {
    const targetRoot = createRepositoryCopy(subtest);
    const readmePath = pluginPath(targetRoot, 'README.md');
    linkSync(readmePath, path.join(targetRoot, 'linked-readme.md'));
    const { result, reads } = runValidatorTracingReads(subtest, targetRoot);
    assert.equal(result.status, 1, result.stdout);
    assert.match(result.stderr, /README\.md must not be hard-linked/);
    assert.ok(reads.includes(comparablePath(pluginPath(targetRoot, 'plugin.json'))), 'The read trace must record payload reads.');
    assert.equal(reads.includes(comparablePath(readmePath)), false);
  });
  await context.test('unexpected Markdown file', (subtest) => {
    const targetRoot = createRepositoryCopy(subtest);
    const notesPath = pluginPath(targetRoot, 'NOTES.md');
    writeFileSync(notesPath, `[License](../../LICENSE) @${'producer'}\n`, 'utf8');
    const { result, reads } = runValidatorTracingReads(subtest, targetRoot);
    assert.equal(result.status, 1, result.stdout);
    assert.match(result.stderr, /NOTES\.md is not part of the plugin file set/);
    assert.doesNotMatch(result.stderr, /NOTES\.md (links|contains)/);
    assert.ok(reads.includes(comparablePath(pluginPath(targetRoot, 'plugin.json'))), 'The read trace must record payload reads.');
    assert.equal(reads.includes(comparablePath(notesPath)), false);
  });
});

test('validator keeps exactly one copy of plugin content', async (context) => {
  for (const [name, source, target, pattern] of [
    ['agent with the installed name', [...AGENTS, 'ai-team-dev.md'], ['agents', 'ai-team-dev.md'], /agents\/ai-team-dev\.md is plugin content outside/],
    ['agent with the legacy name', [...AGENTS, 'ai-team-dev.md'], ['agents', 'ai-team-dev.agent.md'], /agents\/ai-team-dev\.agent\.md is plugin content outside/],
    ['skill', [...SKILL, 'SKILL.md'], ['skills', 'ai-team-orchestration', 'SKILL.md'], /skills\/ai-team-orchestration\/SKILL\.md is plugin content outside/],
    ['manifest', ['plugin.json'], ['plugin.json'], /^- plugin\.json is plugin content outside/m],
    ['reference under another name', [...SKILL, 'references', 'anti-patterns.md'], ['docs', 'notes.md'], /docs\/notes\.md duplicates plugins\/ai-team-orchestration\/skills\/ai-team-orchestration\/references\/anti-patterns\.md/],
  ]) {
    await context.test(name, (subtest) => {
      const targetRoot = createRepositoryCopy(subtest);
      copyFile(pluginPath(targetRoot, ...source), path.join(targetRoot, ...target));
      assertRejected(targetRoot, pattern);
    });
  }
});

test('validator rejects linked plugin content', async (context) => {
  await context.test('linked reference', (subtest) => {
    const targetRoot = createRepositoryCopy(subtest);
    if (trySymlink(subtest, pluginPath(targetRoot, 'README.md'), pluginPath(targetRoot, ...SKILL, 'references', 'linked.md'))) {
      assertRejected(targetRoot, /references\/linked\.md must not be a symbolic link/);
    }
  });
  await context.test('linked manifest', (subtest) => {
    const targetRoot = createRepositoryCopy(subtest);
    const manifestPath = pluginPath(targetRoot, 'plugin.json');
    const outsidePath = path.join(targetRoot, 'outside.json');
    copyFile(manifestPath, outsidePath);
    rmSync(manifestPath);
    if (trySymlink(subtest, outsidePath, manifestPath)) {
      assertRejected(targetRoot, /plugin\.json must not be a symbolic link/);
    }
  });
  await context.test('linked manifest outside the plugin root', (subtest) => {
    const targetRoot = createRepositoryCopy(subtest);
    if (trySymlink(subtest, pluginPath(targetRoot, 'plugin.json'), path.join(targetRoot, 'plugin.json'))) {
      assertRejected(targetRoot, /^- plugin\.json is plugin content outside/m);
    }
  });
});

test('validator rejects hard-linked plugin files', (context) => {
  const targetRoot = createRepositoryCopy(context);
  linkSync(pluginPath(targetRoot, 'README.md'), path.join(targetRoot, 'linked-readme.md'));
  assertRejected(targetRoot, /plugins\/ai-team-orchestration\/README\.md must not be hard-linked/);
});

test('validator reports special and unreadable files without blocking', async (context) => {
  const posixUser = process.platform !== 'win32' && process.getuid?.() !== 0;
  await context.test('named pipe in place of a plugin file', (subtest) => {
    const targetRoot = createRepositoryCopy(subtest);
    const readmePath = pluginPath(targetRoot, 'README.md');
    rmSync(readmePath);
    if (process.platform === 'win32' || spawnSync('mkfifo', [readmePath]).status !== 0) {
      subtest.skip('Named pipes need mkfifo on a POSIX system.');
      return;
    }
    const result = spawnSync(process.execPath, [path.join(targetRoot, 'eng', 'validate.mjs')], {
      cwd: targetRoot,
      encoding: 'utf8',
      timeout: 30000,
    });
    assert.equal(result.status, 1, `Validator did not finish normally: ${result.signal ?? result.stdout}`);
    assert.match(result.stderr, /README\.md must be a regular file or directory/);
  });
  await context.test('unreadable repository file', (subtest) => {
    if (!posixUser) {
      subtest.skip('File permissions need a POSIX system and a user other than root.');
      return;
    }
    const targetRoot = createRepositoryCopy(subtest);
    const unreadablePath = path.join(targetRoot, 'docs', 'unreadable.md');
    writeFileSync(unreadablePath, '# Unreadable\n', 'utf8');
    chmodSync(unreadablePath, 0o000);
    assertRejected(targetRoot, /docs\/unreadable\.md could not be read \(EACCES\)/);
  });
});

test('formal workflow references are not part of the lightweight skill', (context) => {
  const targetRoot = createRepositoryCopy(context);
  for (const fileName of ['delivery-workflow.md', 'safe-git-values.md']) {
    assert.equal(
      readFileSync(pluginPath(targetRoot, ...SKILL, 'SKILL.md'), 'utf8').includes(fileName),
      false,
    );
  }
  const result = runValidator(targetRoot);
  assert.equal(result.status, 0, result.stderr);
});
