// =============================================================================
// Filesystem Tools Registration
// =============================================================================
// Registers filesystem CRUD tools with the tool router

import { z } from 'zod';
import { toolRouter, type ToolResult } from '../../../router/index.js';
import * as ops from './operations.js';
import { log } from '../../../utils/logger.js';

// =============================================================================
// Schemas
// =============================================================================

const readFileSchema = z.object({
  path: z.string().min(1, 'Path cannot be empty'),
  encoding: z.enum(['utf-8', 'ascii', 'base64', 'binary']).optional().default('utf-8'),
});

const writeFileSchema = z.object({
  path: z.string().min(1, 'Path cannot be empty'),
  content: z.string(),
  append: z.boolean().optional().default(false),
});

const deleteFileSchema = z.object({
  path: z.string().min(1, 'Path cannot be empty'),
});

const listDirectorySchema = z.object({
  path: z.string().min(1, 'Path cannot be empty'),
  showHidden: z.boolean().optional().default(false),
  recursive: z.boolean().optional().default(false),
});

const createDirectorySchema = z.object({
  path: z.string().min(1, 'Path cannot be empty'),
});

const deleteDirectorySchema = z.object({
  path: z.string().min(1, 'Path cannot be empty'),
  recursive: z.boolean().optional().default(false),
});

const moveSchema = z.object({
  source: z.string().min(1, 'Source path cannot be empty'),
  destination: z.string().min(1, 'Destination path cannot be empty'),
});

const copySchema = z.object({
  source: z.string().min(1, 'Source path cannot be empty'),
  destination: z.string().min(1, 'Destination path cannot be empty'),
});

const fileInfoSchema = z.object({
  path: z.string().min(1, 'Path cannot be empty'),
});

const existsSchema = z.object({
  path: z.string().min(1, 'Path cannot be empty'),
});

const searchSchema = z.object({
  directory: z.string().min(1, 'Directory cannot be empty'),
  pattern: z.string().min(1, 'Pattern cannot be empty'),
  maxResults: z.number().positive().optional().default(100),
});

// =============================================================================
// Handlers
// =============================================================================

async function handleReadFile(args: unknown): Promise<ToolResult> {
  const parsed = readFileSchema.safeParse(args);
  if (!parsed.success) {
    return {
      content: [{ type: 'text', text: `Invalid arguments: ${parsed.error.message}` }],
      isError: true,
    };
  }

  const { path: filePath, encoding } = parsed.data;

  try {
    let content: string;
    
    if (encoding === 'binary' || encoding === 'base64') {
      content = await ops.readFileBinary(filePath);
      return {
        content: [{ 
          type: 'text', 
          text: `File content (base64 encoded, ${content.length} chars):\n\n${content}` 
        }],
      };
    } else {
      content = await ops.readFile(filePath, encoding as BufferEncoding);
      return {
        content: [{ type: 'text', text: content }],
      };
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: 'text', text: `Failed to read file: ${errorMessage}` }],
      isError: true,
    };
  }
}

async function handleWriteFile(args: unknown): Promise<ToolResult> {
  const parsed = writeFileSchema.safeParse(args);
  if (!parsed.success) {
    return {
      content: [{ type: 'text', text: `Invalid arguments: ${parsed.error.message}` }],
      isError: true,
    };
  }

  const { path: filePath, content, append } = parsed.data;

  try {
    if (append) {
      await ops.appendFile(filePath, content);
      return {
        content: [{ type: 'text', text: `Content appended to: ${filePath}` }],
      };
    } else {
      await ops.writeFile(filePath, content);
      return {
        content: [{ type: 'text', text: `File written: ${filePath} (${content.length} bytes)` }],
      };
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: 'text', text: `Failed to write file: ${errorMessage}` }],
      isError: true,
    };
  }
}

async function handleDeleteFile(args: unknown): Promise<ToolResult> {
  const parsed = deleteFileSchema.safeParse(args);
  if (!parsed.success) {
    return {
      content: [{ type: 'text', text: `Invalid arguments: ${parsed.error.message}` }],
      isError: true,
    };
  }

  try {
    await ops.deleteFile(parsed.data.path);
    return {
      content: [{ type: 'text', text: `File deleted: ${parsed.data.path}` }],
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: 'text', text: `Failed to delete file: ${errorMessage}` }],
      isError: true,
    };
  }
}

async function handleListDirectory(args: unknown): Promise<ToolResult> {
  const parsed = listDirectorySchema.safeParse(args);
  if (!parsed.success) {
    return {
      content: [{ type: 'text', text: `Invalid arguments: ${parsed.error.message}` }],
      isError: true,
    };
  }

  const { path: dirPath, showHidden, recursive } = parsed.data;

  try {
    const entries = await ops.listDirectory(dirPath, { showHidden, recursive });
    
    if (entries.length === 0) {
      return {
        content: [{ type: 'text', text: `Directory is empty: ${dirPath}` }],
      };
    }

    // Format as a table-like output
    let output = `Contents of ${dirPath}:\n\n`;
    output += `${'Type'.padEnd(12)} ${'Size'.padStart(10)} ${'Modified'.padEnd(20)} Name\n`;
    output += `${'─'.repeat(12)} ${'─'.repeat(10)} ${'─'.repeat(20)} ${'─'.repeat(30)}\n`;
    
    for (const entry of entries) {
      const type = entry.type === 'directory' ? '[DIR]' : entry.type === 'symlink' ? '[LINK]' : '';
      const size = entry.type === 'directory' ? '-' : formatBytes(entry.size);
      const modified = new Date(entry.modified).toLocaleString();
      output += `${type.padEnd(12)} ${size.padStart(10)} ${modified.padEnd(20)} ${entry.name}\n`;
    }
    
    output += `\nTotal: ${entries.length} items`;

    return {
      content: [{ type: 'text', text: output }],
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: 'text', text: `Failed to list directory: ${errorMessage}` }],
      isError: true,
    };
  }
}

async function handleCreateDirectory(args: unknown): Promise<ToolResult> {
  const parsed = createDirectorySchema.safeParse(args);
  if (!parsed.success) {
    return {
      content: [{ type: 'text', text: `Invalid arguments: ${parsed.error.message}` }],
      isError: true,
    };
  }

  try {
    await ops.createDirectory(parsed.data.path);
    return {
      content: [{ type: 'text', text: `Directory created: ${parsed.data.path}` }],
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: 'text', text: `Failed to create directory: ${errorMessage}` }],
      isError: true,
    };
  }
}

async function handleDeleteDirectory(args: unknown): Promise<ToolResult> {
  const parsed = deleteDirectorySchema.safeParse(args);
  if (!parsed.success) {
    return {
      content: [{ type: 'text', text: `Invalid arguments: ${parsed.error.message}` }],
      isError: true,
    };
  }

  const { path: dirPath, recursive } = parsed.data;

  try {
    await ops.deleteDirectory(dirPath, recursive);
    return {
      content: [{ type: 'text', text: `Directory deleted: ${dirPath}` }],
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: 'text', text: `Failed to delete directory: ${errorMessage}` }],
      isError: true,
    };
  }
}

async function handleMove(args: unknown): Promise<ToolResult> {
  const parsed = moveSchema.safeParse(args);
  if (!parsed.success) {
    return {
      content: [{ type: 'text', text: `Invalid arguments: ${parsed.error.message}` }],
      isError: true,
    };
  }

  const { source, destination } = parsed.data;

  try {
    await ops.move(source, destination);
    return {
      content: [{ type: 'text', text: `Moved: ${source} -> ${destination}` }],
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: 'text', text: `Failed to move: ${errorMessage}` }],
      isError: true,
    };
  }
}

async function handleCopy(args: unknown): Promise<ToolResult> {
  const parsed = copySchema.safeParse(args);
  if (!parsed.success) {
    return {
      content: [{ type: 'text', text: `Invalid arguments: ${parsed.error.message}` }],
      isError: true,
    };
  }

  const { source, destination } = parsed.data;

  try {
    // Check if source is a directory
    const info = await ops.getFileInfo(source);
    
    if (info.type === 'directory') {
      await ops.copyDirectory(source, destination);
    } else {
      await ops.copyFile(source, destination);
    }
    
    return {
      content: [{ type: 'text', text: `Copied: ${source} -> ${destination}` }],
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: 'text', text: `Failed to copy: ${errorMessage}` }],
      isError: true,
    };
  }
}

async function handleFileInfo(args: unknown): Promise<ToolResult> {
  const parsed = fileInfoSchema.safeParse(args);
  if (!parsed.success) {
    return {
      content: [{ type: 'text', text: `Invalid arguments: ${parsed.error.message}` }],
      isError: true,
    };
  }

  try {
    const info = await ops.getFileInfo(parsed.data.path);
    
    let output = `File Information:\n\n`;
    output += `Name:        ${info.name}\n`;
    output += `Path:        ${info.path}\n`;
    output += `Type:        ${info.type}\n`;
    output += `Size:        ${formatBytes(info.size)} (${info.size} bytes)\n`;
    output += `Modified:    ${info.modified}\n`;
    output += `Created:     ${info.created}\n`;
    output += `Permissions: ${info.permissions}\n`;
    output += `Readable:    ${info.isReadable ? 'Yes' : 'No'}\n`;
    output += `Writable:    ${info.isWritable ? 'Yes' : 'No'}`;

    return {
      content: [{ type: 'text', text: output }],
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: 'text', text: `Failed to get file info: ${errorMessage}` }],
      isError: true,
    };
  }
}

async function handleExists(args: unknown): Promise<ToolResult> {
  const parsed = existsSchema.safeParse(args);
  if (!parsed.success) {
    return {
      content: [{ type: 'text', text: `Invalid arguments: ${parsed.error.message}` }],
      isError: true,
    };
  }

  try {
    const result = await ops.exists(parsed.data.path);
    
    if (result.exists) {
      return {
        content: [{ type: 'text', text: `Yes, exists as: ${result.type}` }],
      };
    } else {
      return {
        content: [{ type: 'text', text: `No, does not exist` }],
      };
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: 'text', text: `Failed to check existence: ${errorMessage}` }],
      isError: true,
    };
  }
}

async function handleSearch(args: unknown): Promise<ToolResult> {
  const parsed = searchSchema.safeParse(args);
  if (!parsed.success) {
    return {
      content: [{ type: 'text', text: `Invalid arguments: ${parsed.error.message}` }],
      isError: true,
    };
  }

  const { directory, pattern, maxResults } = parsed.data;

  try {
    const results = await ops.searchFiles(directory, pattern, { maxResults });
    
    if (results.length === 0) {
      return {
        content: [{ type: 'text', text: `No files found matching "${pattern}" in ${directory}` }],
      };
    }

    let output = `Found ${results.length} file(s) matching "${pattern}":\n\n`;
    for (const file of results) {
      output += `${file}\n`;
    }
    
    if (results.length >= maxResults) {
      output += `\n(Results limited to ${maxResults})`;
    }

    return {
      content: [{ type: 'text', text: output }],
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: 'text', text: `Search failed: ${errorMessage}` }],
      isError: true,
    };
  }
}

// =============================================================================
// Helpers
// =============================================================================

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

// =============================================================================
// Registration
// =============================================================================

export function registerFilesystemTools(): void {
  log.info('Registering Filesystem tools');

  toolRouter.registerTool({
    id: 'fs.read_file',
    category: 'filesystem',
    name: 'Read File',
    description: 'Read the contents of a file. Supports text files (utf-8, ascii) and binary files (returns base64).',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute or relative path to the file' },
        encoding: { 
          type: 'string', 
          enum: ['utf-8', 'ascii', 'base64', 'binary'],
          description: 'Encoding for reading. Use binary/base64 for non-text files. Default: utf-8' 
        },
      },
      required: ['path'],
    },
    handler: handleReadFile,
    keywords: ['read', 'file', 'content', 'cat', 'open', 'view'],
  });

  toolRouter.registerTool({
    id: 'fs.write_file',
    category: 'filesystem',
    name: 'Write File',
    description: 'Create or overwrite a file with content. Parent directories are created automatically.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute or relative path to the file' },
        content: { type: 'string', description: 'Content to write to the file' },
        append: { type: 'boolean', description: 'If true, append to file instead of overwriting. Default: false' },
      },
      required: ['path', 'content'],
    },
    handler: handleWriteFile,
    keywords: ['write', 'file', 'create', 'save', 'content', 'echo'],
  });

  toolRouter.registerTool({
    id: 'fs.delete_file',
    category: 'filesystem',
    name: 'Delete File',
    description: 'Delete a file.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to the file to delete' },
      },
      required: ['path'],
    },
    handler: handleDeleteFile,
    keywords: ['delete', 'remove', 'file', 'rm', 'unlink'],
  });

  toolRouter.registerTool({
    id: 'fs.list_directory',
    category: 'filesystem',
    name: 'List Directory',
    description: 'List files and folders in a directory. Returns name, type, size, and modification date.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to the directory' },
        showHidden: { type: 'boolean', description: 'Show hidden files (starting with .). Default: false' },
        recursive: { type: 'boolean', description: 'List subdirectories recursively. Default: false' },
      },
      required: ['path'],
    },
    handler: handleListDirectory,
    keywords: ['list', 'directory', 'folder', 'ls', 'dir', 'files'],
  });

  toolRouter.registerTool({
    id: 'fs.create_directory',
    category: 'filesystem',
    name: 'Create Directory',
    description: 'Create a new directory. Parent directories are created automatically if needed.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path for the new directory' },
      },
      required: ['path'],
    },
    handler: handleCreateDirectory,
    keywords: ['create', 'directory', 'folder', 'mkdir'],
  });

  toolRouter.registerTool({
    id: 'fs.delete_directory',
    category: 'filesystem',
    name: 'Delete Directory',
    description: 'Delete a directory. Set recursive=true to delete non-empty directories.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to the directory to delete' },
        recursive: { type: 'boolean', description: 'Delete non-empty directories. Default: false' },
      },
      required: ['path'],
    },
    handler: handleDeleteDirectory,
    keywords: ['delete', 'remove', 'directory', 'folder', 'rmdir'],
  });

  toolRouter.registerTool({
    id: 'fs.move',
    category: 'filesystem',
    name: 'Move/Rename',
    description: 'Move or rename a file or directory.',
    inputSchema: {
      type: 'object',
      properties: {
        source: { type: 'string', description: 'Source path (file or directory to move)' },
        destination: { type: 'string', description: 'Destination path' },
      },
      required: ['source', 'destination'],
    },
    handler: handleMove,
    keywords: ['move', 'rename', 'mv'],
  });

  toolRouter.registerTool({
    id: 'fs.copy',
    category: 'filesystem',
    name: 'Copy',
    description: 'Copy a file or directory. Directories are copied recursively.',
    inputSchema: {
      type: 'object',
      properties: {
        source: { type: 'string', description: 'Source path to copy' },
        destination: { type: 'string', description: 'Destination path' },
      },
      required: ['source', 'destination'],
    },
    handler: handleCopy,
    keywords: ['copy', 'cp', 'duplicate'],
  });

  toolRouter.registerTool({
    id: 'fs.file_info',
    category: 'filesystem',
    name: 'File Info',
    description: 'Get detailed information about a file or directory (size, permissions, dates).',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to the file or directory' },
      },
      required: ['path'],
    },
    handler: handleFileInfo,
    keywords: ['info', 'stat', 'details', 'metadata', 'properties'],
  });

  toolRouter.registerTool({
    id: 'fs.exists',
    category: 'filesystem',
    name: 'Check Exists',
    description: 'Check if a file or directory exists.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to check' },
      },
      required: ['path'],
    },
    handler: handleExists,
    keywords: ['exists', 'check', 'test'],
  });

  toolRouter.registerTool({
    id: 'fs.search',
    category: 'filesystem',
    name: 'Search Files',
    description: 'Search for files by name pattern. Uses glob-like patterns (* for any chars, ? for single char).',
    inputSchema: {
      type: 'object',
      properties: {
        directory: { type: 'string', description: 'Directory to search in' },
        pattern: { type: 'string', description: 'Filename pattern (e.g., "*.txt", "test*", "*.ts")' },
        maxResults: { type: 'number', description: 'Maximum results to return. Default: 100' },
      },
      required: ['directory', 'pattern'],
    },
    handler: handleSearch,
    keywords: ['search', 'find', 'glob', 'pattern', 'locate'],
  });

  log.info('Filesystem tools registered', { count: 11 });
}
