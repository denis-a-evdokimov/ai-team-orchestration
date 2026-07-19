const REMOTE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const BRANCH_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/;
const HOST_PATTERN = '[A-Za-z0-9.-]+';
const PORT_PATTERN = '(?::[0-9]{1,5})?';
const PATH_SEGMENT_PATTERN = '[A-Za-z0-9._+-]+';
const PATH_PATTERN = `${PATH_SEGMENT_PATTERN}(?:\/${PATH_SEGMENT_PATTERN})*`;
const HTTPS_PATTERN = new RegExp(`^https:\/\/${HOST_PATTERN}${PORT_PATTERN}\/${PATH_PATTERN}$`);
const SSH_PATTERN = new RegExp(`^ssh:\/\/(?:[A-Za-z0-9._+-]+@)?${HOST_PATTERN}${PORT_PATTERN}\/${PATH_PATTERN}$`);
const SCP_PATTERN = new RegExp(`^[A-Za-z0-9._+-]+@${HOST_PATTERN}:${PATH_PATTERN}$`);
const CLONE_DESTINATION_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9_-])?$/;
const WINDOWS_RESERVED_BASENAME_PATTERN =
  /^(?:con|prn|aux|nul|clock\$|com[1-9]|lpt[1-9])(?:\.|$)/i;

export const SAFE_GIT_GRAMMAR_ROWS = new Map([
  ['Remote name', ['`^[A-Za-z0-9][A-Za-z0-9._-]*$`', 'Must also form a valid `refs/remotes/NAME/__probe__` ref.']],
  ['Target or working branch', ['slash-separated segments matching `[A-Za-z0-9][A-Za-z0-9._-]*`', 'Must pass `git check-ref-format --branch`; working and target branches differ.']],
  ['Base ref', ['exactly `refs/remotes/<base-remote>/<target-branch>`', 'No tag, short revision, arbitrary SHA, peel operator, or revision expression.']],
  ['HTTPS URL', ['`https://HOST/PATH` using letters, digits, `.`, `_`, `+`, `-`, optional numeric port, and `/`', 'No credentials, query, fragment, empty segment, `.` segment, or `..` segment.']],
  ['SSH URL', ['`ssh://[USER@]HOST[:PORT]/PATH` with the same safe path characters', 'No secrets in the username or URL.']],
  ['SCP-style SSH URL', ['`USER@HOST:PATH` with the same safe path characters', '`USER@` is required so it cannot be confused with a Windows drive path.']],
  ['Clone destination', ['1–64 characters matching `[A-Za-z0-9][A-Za-z0-9._-]*`', 'One relative segment, no trailing `.`, must not already exist, and no Windows reserved device basename.']],
]);

export const SAFE_GIT_FIXED_COMMANDS = [
  'git check-ref-format refs/remotes/BASE_REMOTE/__probe__',
  'git check-ref-format refs/remotes/PUSH_REMOTE/__probe__',
  'git check-ref-format --branch TARGET_BRANCH',
  'git check-ref-format --branch WORKING_BRANCH',
  'git check-ref-format BASE_REF',
  'git config --get-regexp remote.BASE_REMOTE',
  'git config --get-all core.fsmonitor',
  'git ls-remote --get-url -- BASE_REMOTE_URL',
  'git -c core.hooksPath=.git/disabled-hooks -c fetch.bundleURI= -c remote.BASE_REMOTE.serverOption= clone --template= --no-checkout --no-tags --no-recurse-submodules --single-branch --branch TARGET_BRANCH --origin BASE_REMOTE --upload-pack=git-upload-pack -- BASE_REMOTE_URL CLONE_DESTINATION',
  'git -C CLONE_DESTINATION config --get-all core.fsmonitor',
  'git -C CLONE_DESTINATION -c core.hooksPath=.git/disabled-hooks -c core.sparseCheckout=false -c core.sparseCheckoutCone=false checkout --force TARGET_BRANCH',
  'git -C CLONE_DESTINATION remote get-url --all BASE_REMOTE',
  'git -C CLONE_DESTINATION show-ref',
  'git -C CLONE_DESTINATION symbolic-ref --quiet refs/remotes/BASE_REMOTE/HEAD',
  'git -C CLONE_DESTINATION branch --show-current',
  'git -C CLONE_DESTINATION cat-file -t refs/heads/TARGET_BRANCH',
  'git -C CLONE_DESTINATION config --get-all core.fsmonitor',
  'git -C CLONE_DESTINATION ls-files -v',
  'git -C CLONE_DESTINATION -c core.ignoreStat=false status --porcelain=v1 --untracked-files=all --ignore-submodules=none',
  'git remote get-url --all BASE_REMOTE',
  'git remote get-url --push --all PUSH_REMOTE',
  'git remote add -- REMOTE_NAME REMOTE_URL',
  'git config --get-all core.fsmonitor',
  'git ls-files -v',
  'git -c core.ignoreStat=false status --porcelain=v1 --untracked-files=all --ignore-submodules=none',
  'git -c core.hooksPath=.git/disabled-hooks -c fetch.bundleURI= -c fetch.prune=false -c fetch.pruneTags=false -c fetch.recurseSubmodules=false -c fetch.writeCommitGraph=false -c gc.auto=0 -c maintenance.auto=false -c remote.BASE_REMOTE.prune=false -c remote.BASE_REMOTE.pruneTags=false -c remote.BASE_REMOTE.serverOption= fetch --refmap= --no-tags --no-recurse-submodules --upload-pack=git-upload-pack BASE_REMOTE +refs/heads/TARGET_BRANCH:BASE_REF',
  'git show-ref --verify -- BASE_REF',
  'git rev-parse --verify --end-of-options BASE_REF',
  'git cat-file -t BASE_REF',
  'git -c core.hooksPath=.git/disabled-hooks -c core.sparseCheckout=false -c core.sparseCheckoutCone=false switch --no-track --create WORKING_BRANCH -- BASE_REF',
  'git branch --show-current',
  'git show-ref --verify -- refs/heads/WORKING_BRANCH',
  'git merge-base --is-ancestor BASE_REF refs/heads/WORKING_BRANCH',
  'git -c core.hooksPath=.git/disabled-hooks -c core.sparseCheckout=false -c core.sparseCheckoutCone=false switch -- WORKING_BRANCH',
  'git branch --show-current',
  'git config --get branch.WORKING_BRANCH.remote',
  'git config --get branch.WORKING_BRANCH.merge',
  'git config --get-all core.fsmonitor',
  'git ls-files -v',
  'git -c core.ignoreStat=false status --porcelain=v1 --untracked-files=all --ignore-submodules=none',
  'git remote get-url --push --all PUSH_REMOTE',
  'git branch --show-current',
  'git rev-parse --verify --end-of-options refs/heads/WORKING_BRANCH',
  'git cat-file -t refs/heads/WORKING_BRANCH',
  'git -c core.hooksPath=.git/disabled-hooks -c push.followTags=false -c push.gpgSign=false -c push.negotiate=false -c push.pushOption= -c push.recurseSubmodules=no -c remote.PUSH_REMOTE.mirror=false push --no-follow-tags --no-signed --no-verify --recurse-submodules=no --receive-pack=git-receive-pack --set-upstream PUSH_REMOTE refs/heads/WORKING_BRANCH:refs/heads/WORKING_BRANCH',
];

function nonEmptyString(value, label) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  if (/\s|[\x00-\x1f\x7f]/.test(value)) {
    throw new Error(`${label} contains whitespace or control characters.`);
  }
  if (/['"`$;|&<>(){}\[\]*?!\\]/.test(value) || value.startsWith('-')) {
    throw new Error(`${label} contains shell metacharacters or a leading-option form.`);
  }
  return value;
}

export function validateRemoteName(value, label = 'Remote name') {
  nonEmptyString(value, label);
  if (!REMOTE_PATTERN.test(value)) {
    throw new Error(`${label} must match ${REMOTE_PATTERN}.`);
  }
  return value;
}

export function validateBranchName(value, label = 'Branch name') {
  nonEmptyString(value, label);
  if (!BRANCH_PATTERN.test(value)) {
    throw new Error(`${label} must use slash-separated shell-safe Git segments.`);
  }
  return value;
}

export function expectedBaseRef(baseRemote, targetBranch) {
  validateRemoteName(baseRemote, 'Base remote');
  validateBranchName(targetBranch, 'Target branch');
  return `refs/remotes/${baseRemote}/${targetBranch}`;
}

export function validateBaseRef(value, baseRemote, targetBranch) {
  nonEmptyString(value, 'Base ref');
  const expected = expectedBaseRef(baseRemote, targetBranch);
  if (value !== expected) {
    throw new Error(`Base ref must be exactly ${expected}.`);
  }
  return value;
}

export function validateRemoteUrl(value, label = 'Remote URL') {
  nonEmptyString(value, label);
  let rawPath;
  if (value.startsWith('https://') || value.startsWith('ssh://')) {
    const authorityEnd = value.indexOf('/', value.indexOf('://') + 3);
    rawPath = authorityEnd === -1 ? '' : value.slice(authorityEnd + 1);
  } else {
    const separator = value.indexOf(':');
    rawPath = separator === -1 ? '' : value.slice(separator + 1);
  }
  if (rawPath.split('/').some((segment) => segment === '.' || segment === '..' || segment === '')) {
    throw new Error(`${label} contains an unsafe path segment.`);
  }
  if (!HTTPS_PATTERN.test(value) && !SSH_PATTERN.test(value) && !SCP_PATTERN.test(value)) {
    throw new Error(`${label} must be a credential-free HTTPS, SSH, or SCP-style URL in the safe baseline grammar.`);
  }
  if (value.startsWith('https://') || value.startsWith('ssh://')) {
    const parsed = new URL(value);
    if (parsed.username && value.startsWith('https://')) {
      throw new Error(`${label} must not contain HTTPS credentials.`);
    }
    if (parsed.search || parsed.hash) {
      throw new Error(`${label} must not contain a query or fragment.`);
    }
  }
  return value;
}

export function validateCloneDestination(value, label = 'Clone destination') {
  nonEmptyString(value, label);
  if (
    value.length > 64 ||
    !CLONE_DESTINATION_PATTERN.test(value) ||
    WINDOWS_RESERVED_BASENAME_PATTERN.test(value)
  ) {
    throw new Error(
      `${label} must be one portable relative directory-name segment and must not use a Windows reserved device basename.`,
    );
  }
  return value;
}

export function validateGitPlanCoordinates({
  baseRef,
  baseRemote,
  baseRemoteUrl,
  cloneDestination,
  pushRemote,
  pushRemoteUrl,
  targetBranch,
  workingBranch,
}) {
  validateRemoteName(baseRemote, 'Base remote');
  validateRemoteName(pushRemote, 'Push remote');
  validateBranchName(targetBranch, 'Target branch');
  validateBranchName(workingBranch, 'Working branch');
  if (targetBranch === workingBranch) {
    throw new Error('Working branch must differ from target branch.');
  }
  validateBaseRef(baseRef, baseRemote, targetBranch);
  validateRemoteUrl(baseRemoteUrl, 'Base remote URL');
  validateCloneDestination(cloneDestination);
  validateRemoteUrl(pushRemoteUrl, 'Push remote URL');
  if (baseRemoteUrl !== pushRemoteUrl && baseRemote === pushRemote) {
    throw new Error('Different base and push URLs require different remote names.');
  }
  return true;
}
