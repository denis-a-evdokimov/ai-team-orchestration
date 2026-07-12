import {
  lstatSync,
  realpathSync,
} from 'node:fs';
import path from 'node:path';

export function tryLstat(filePath) {
  try {
    return lstatSync(filePath);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

export function sameFilesystemPath(left, right) {
  const normalizedLeft = path.resolve(left);
  const normalizedRight = path.resolve(right);
  return process.platform === 'win32'
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}

export function isContainedPath(rootPath, candidatePath, allowRoot = true) {
  const relativePath = path.relative(rootPath, candidatePath);
  if (relativePath === '') {
    return allowRoot;
  }
  return relativePath !== '..'
    && !relativePath.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relativePath);
}

export function validatePortableRelativePath(portablePath, label) {
  if (typeof portablePath !== 'string' || portablePath.length === 0) {
    throw new Error(`${label} must be a non-empty relative path.`);
  }
  if (portablePath.includes('\\')
    || portablePath.includes('\0')
    || path.posix.isAbsolute(portablePath)
    || path.win32.isAbsolute(portablePath)) {
    throw new Error(`${label} must be a portable relative path without drive or separator escapes: ${portablePath}`);
  }

  const parts = portablePath.split('/');
  if (parts.some((part) => part === ''
    || part === '.'
    || part === '..'
    || /^[A-Za-z]:/.test(part))) {
    throw new Error(`${label} contains an empty, dot, or drive-form path segment: ${portablePath}`);
  }
  return parts;
}

export function createRootInfo(rootPath, label) {
  const resolvedPath = path.resolve(rootPath);
  const rootStat = tryLstat(resolvedPath);
  if (!rootStat) {
    throw new Error(`${label} does not exist: ${resolvedPath}`);
  }
  if (rootStat.isSymbolicLink()) {
    throw new Error(`${label} must not be a symbolic link, junction, or reparse point: ${resolvedPath}`);
  }
  if (!rootStat.isDirectory()) {
    throw new Error(`${label} must be a directory: ${resolvedPath}`);
  }
  const realPath = realpathSync(resolvedPath);
  if (!sameFilesystemPath(realPath, resolvedPath)) {
    throw new Error(`${label} must not resolve through a symbolic link, junction, mount, or reparse point: ${resolvedPath}`);
  }

  return {
    label,
    path: resolvedPath,
    realPath,
  };
}

export function resolveManagedPath(rootInfo, portablePath, label = portablePath) {
  const parts = validatePortableRelativePath(portablePath, label);
  const resolvedPath = path.resolve(rootInfo.path, ...parts);
  if (!isContainedPath(rootInfo.path, resolvedPath, false)) {
    throw new Error(`${label} resolves outside ${rootInfo.label}: ${portablePath}`);
  }
  return resolvedPath;
}

export function assertSafeManagedPath(rootInfo, portablePath, label = portablePath) {
  const parts = validatePortableRelativePath(portablePath, label);
  const resolvedPath = resolveManagedPath(rootInfo, portablePath, label);
  const rootStat = tryLstat(rootInfo.path);
  if (!rootStat || rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw new Error(`${rootInfo.label} changed into a missing or linked path.`);
  }
  const currentRootRealPath = realpathSync(rootInfo.path);
  if (!sameFilesystemPath(currentRootRealPath, rootInfo.realPath)) {
    throw new Error(`${rootInfo.label} changed its real path during synchronization.`);
  }
  let currentPath = rootInfo.path;

  for (let index = 0; index < parts.length; index += 1) {
    currentPath = path.join(currentPath, parts[index]);
    const currentStat = tryLstat(currentPath);
    if (!currentStat) {
      break;
    }
    if (currentStat.isSymbolicLink()) {
      throw new Error(`${label} contains a symbolic link, junction, or reparse point: ${currentPath}`);
    }

    const currentRealPath = realpathSync(currentPath);
    if (!isContainedPath(rootInfo.realPath, currentRealPath, true)) {
      throw new Error(`${label} escapes ${rootInfo.label} through a reparse point: ${currentPath}`);
    }
    if (index < parts.length - 1 && !currentStat.isDirectory()) {
      throw new Error(`${label} has a non-directory path component: ${currentPath}`);
    }
  }

  return resolvedPath;
}

export function assertManagedDirectory(rootInfo, portablePath, label = portablePath) {
  const absolutePath = assertSafeManagedPath(rootInfo, portablePath, label);
  const targetStat = tryLstat(absolutePath);
  if (!targetStat || !targetStat.isDirectory()) {
    throw new Error(`${label} must be an existing directory.`);
  }
  return absolutePath;
}

export function assertManagedRegularFile(rootInfo, portablePath, label = portablePath) {
  const absolutePath = assertSafeManagedPath(rootInfo, portablePath, label);
  const targetStat = tryLstat(absolutePath);
  if (!targetStat || !targetStat.isFile()) {
    throw new Error(`${label} must be an existing regular file.`);
  }
  return absolutePath;
}
