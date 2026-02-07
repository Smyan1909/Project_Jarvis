// =============================================================================
// Filesystem Operations
// =============================================================================
// Core filesystem operations using Node.js fs/promises

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { log } from '../../../utils/logger.js';

/**
 * File/directory info
 */
export interface FileInfo {
  name: string;
  path: string;
  type: 'file' | 'directory' | 'symlink' | 'other';
  size: number;
  modified: string;
  created: string;
  permissions: string;
  isReadable: boolean;
  isWritable: boolean;
}

/**
 * Directory listing entry
 */
export interface DirectoryEntry {
  name: string;
  type: 'file' | 'directory' | 'symlink' | 'other';
  size: number;
  modified: string;
}

/**
 * Read file contents
 */
export async function readFile(filePath: string, encoding: BufferEncoding = 'utf-8'): Promise<string> {
  log.debug('Reading file', { path: filePath });
  const content = await fs.readFile(filePath, { encoding });
  log.debug('File read successfully', { path: filePath, size: content.length });
  return content;
}

/**
 * Read file as binary (returns base64)
 */
export async function readFileBinary(filePath: string): Promise<string> {
  log.debug('Reading binary file', { path: filePath });
  const buffer = await fs.readFile(filePath);
  const base64 = buffer.toString('base64');
  log.debug('Binary file read successfully', { path: filePath, size: buffer.length });
  return base64;
}

/**
 * Write content to a file (creates or overwrites)
 */
export async function writeFile(filePath: string, content: string): Promise<void> {
  log.debug('Writing file', { path: filePath, size: content.length });
  
  // Ensure parent directory exists
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  
  await fs.writeFile(filePath, content, 'utf-8');
  log.info('File written successfully', { path: filePath });
}

/**
 * Append content to a file (creates if doesn't exist)
 */
export async function appendFile(filePath: string, content: string): Promise<void> {
  log.debug('Appending to file', { path: filePath, size: content.length });
  
  // Ensure parent directory exists
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  
  await fs.appendFile(filePath, content, 'utf-8');
  log.info('Content appended successfully', { path: filePath });
}

/**
 * Delete a file
 */
export async function deleteFile(filePath: string): Promise<void> {
  log.debug('Deleting file', { path: filePath });
  await fs.unlink(filePath);
  log.info('File deleted successfully', { path: filePath });
}

/**
 * List directory contents
 */
export async function listDirectory(
  dirPath: string,
  options: { showHidden?: boolean; recursive?: boolean } = {}
): Promise<DirectoryEntry[]> {
  const { showHidden = false, recursive = false } = options;
  
  log.debug('Listing directory', { path: dirPath, showHidden, recursive });
  
  const entries: DirectoryEntry[] = [];
  
  async function processDir(currentPath: string, prefix: string = ''): Promise<void> {
    const items = await fs.readdir(currentPath, { withFileTypes: true });
    
    for (const item of items) {
      // Skip hidden files unless requested
      if (!showHidden && item.name.startsWith('.')) {
        continue;
      }
      
      const fullPath = path.join(currentPath, item.name);
      const relativeName = prefix ? `${prefix}/${item.name}` : item.name;
      
      try {
        const stat = await fs.stat(fullPath);
        
        let type: DirectoryEntry['type'] = 'other';
        if (item.isFile()) type = 'file';
        else if (item.isDirectory()) type = 'directory';
        else if (item.isSymbolicLink()) type = 'symlink';
        
        entries.push({
          name: relativeName,
          type,
          size: stat.size,
          modified: stat.mtime.toISOString(),
        });
        
        // Recurse into directories if requested
        if (recursive && item.isDirectory()) {
          await processDir(fullPath, relativeName);
        }
      } catch (error) {
        // Skip files we can't stat (permission issues, etc.)
        log.debug('Could not stat file', { path: fullPath, error });
      }
    }
  }
  
  await processDir(dirPath);
  
  // Sort: directories first, then alphabetically
  entries.sort((a, b) => {
    if (a.type === 'directory' && b.type !== 'directory') return -1;
    if (a.type !== 'directory' && b.type === 'directory') return 1;
    return a.name.localeCompare(b.name);
  });
  
  log.debug('Directory listed', { path: dirPath, count: entries.length });
  return entries;
}

/**
 * Create a directory (with parents if needed)
 */
export async function createDirectory(dirPath: string): Promise<void> {
  log.debug('Creating directory', { path: dirPath });
  await fs.mkdir(dirPath, { recursive: true });
  log.info('Directory created successfully', { path: dirPath });
}

/**
 * Delete a directory
 */
export async function deleteDirectory(dirPath: string, recursive: boolean = false): Promise<void> {
  log.debug('Deleting directory', { path: dirPath, recursive });
  
  if (recursive) {
    await fs.rm(dirPath, { recursive: true, force: true });
  } else {
    await fs.rmdir(dirPath);
  }
  
  log.info('Directory deleted successfully', { path: dirPath });
}

/**
 * Move/rename a file or directory
 */
export async function move(sourcePath: string, destPath: string): Promise<void> {
  log.debug('Moving', { from: sourcePath, to: destPath });
  
  // Ensure destination parent exists
  const destDir = path.dirname(destPath);
  await fs.mkdir(destDir, { recursive: true });
  
  await fs.rename(sourcePath, destPath);
  log.info('Moved successfully', { from: sourcePath, to: destPath });
}

/**
 * Copy a file
 */
export async function copyFile(sourcePath: string, destPath: string): Promise<void> {
  log.debug('Copying file', { from: sourcePath, to: destPath });
  
  // Ensure destination parent exists
  const destDir = path.dirname(destPath);
  await fs.mkdir(destDir, { recursive: true });
  
  await fs.copyFile(sourcePath, destPath);
  log.info('File copied successfully', { from: sourcePath, to: destPath });
}

/**
 * Copy a directory recursively
 */
export async function copyDirectory(sourcePath: string, destPath: string): Promise<void> {
  log.debug('Copying directory', { from: sourcePath, to: destPath });
  
  await fs.cp(sourcePath, destPath, { recursive: true });
  log.info('Directory copied successfully', { from: sourcePath, to: destPath });
}

/**
 * Get file/directory info
 */
export async function getFileInfo(filePath: string): Promise<FileInfo> {
  log.debug('Getting file info', { path: filePath });
  
  const stat = await fs.stat(filePath);
  const lstat = await fs.lstat(filePath);
  
  let type: FileInfo['type'] = 'other';
  if (stat.isFile()) type = 'file';
  else if (stat.isDirectory()) type = 'directory';
  else if (lstat.isSymbolicLink()) type = 'symlink';
  
  // Check permissions
  let isReadable = false;
  let isWritable = false;
  try {
    await fs.access(filePath, fs.constants.R_OK);
    isReadable = true;
  } catch { /* not readable */ }
  try {
    await fs.access(filePath, fs.constants.W_OK);
    isWritable = true;
  } catch { /* not writable */ }
  
  // Format permissions as octal
  const permissions = (stat.mode & 0o777).toString(8).padStart(3, '0');
  
  return {
    name: path.basename(filePath),
    path: path.resolve(filePath),
    type,
    size: stat.size,
    modified: stat.mtime.toISOString(),
    created: stat.birthtime.toISOString(),
    permissions,
    isReadable,
    isWritable,
  };
}

/**
 * Check if a file/directory exists
 */
export async function exists(filePath: string): Promise<{ exists: boolean; type?: 'file' | 'directory' | 'other' }> {
  try {
    const stat = await fs.stat(filePath);
    let type: 'file' | 'directory' | 'other' = 'other';
    if (stat.isFile()) type = 'file';
    else if (stat.isDirectory()) type = 'directory';
    
    return { exists: true, type };
  } catch {
    return { exists: false };
  }
}

/**
 * Search for files matching a glob pattern
 */
export async function searchFiles(
  directory: string,
  pattern: string,
  options: { maxResults?: number } = {}
): Promise<string[]> {
  const { maxResults = 100 } = options;
  
  log.debug('Searching files', { directory, pattern, maxResults });
  
  const results: string[] = [];
  
  // Convert glob pattern to regex
  const regexPattern = pattern
    .replace(/\./g, '\\.')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  
  const regex = new RegExp(`^${regexPattern}$`, 'i');
  
  async function searchDir(currentPath: string): Promise<boolean> {
    if (results.length >= maxResults) return true; // Stop if we have enough
    
    try {
      const items = await fs.readdir(currentPath, { withFileTypes: true });
      
      for (const item of items) {
        if (results.length >= maxResults) return true;
        
        const fullPath = path.join(currentPath, item.name);
        
        // Check if name matches pattern
        if (regex.test(item.name)) {
          results.push(fullPath);
        }
        
        // Recurse into directories
        if (item.isDirectory() && !item.name.startsWith('.')) {
          const shouldStop = await searchDir(fullPath);
          if (shouldStop) return true;
        }
      }
    } catch {
      // Skip directories we can't read
    }
    
    return false;
  }
  
  await searchDir(directory);
  
  log.debug('Search complete', { directory, pattern, found: results.length });
  return results;
}
