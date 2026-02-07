// =============================================================================
// Terminal Command Blocklist
// =============================================================================
// Patterns for dangerous commands that should be blocked

import { log } from '../../../utils/logger.js';

/**
 * Patterns that match dangerous commands
 * Each pattern is a regex that will be tested against the command
 */
const DANGEROUS_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  // Destructive root/system deletion
  {
    pattern: /rm\s+(-[rfRF]+\s+)*[\/\s]*(\*|\/\*|\/\s*$)/i,
    reason: 'Destructive deletion of root filesystem',
  },
  {
    pattern: /rm\s+(-[rfRF]+\s+)+\/(?!tmp|home)/i,
    reason: 'Destructive deletion of system directories',
  },
  
  // Disk formatting and partitioning
  {
    pattern: /\b(mkfs|mkfs\.\w+)\b/i,
    reason: 'Disk formatting command',
  },
  {
    pattern: /\bfdisk\b/i,
    reason: 'Disk partitioning command',
  },
  {
    pattern: /\bparted\b/i,
    reason: 'Disk partitioning command',
  },
  
  // System control
  {
    pattern: /\b(shutdown|poweroff|halt|reboot|init\s+[06])\b/i,
    reason: 'System shutdown/reboot command',
  },
  
  // Direct disk writes
  {
    pattern: /dd\s+.*of\s*=\s*\/dev\/(sd[a-z]|nvme|hd[a-z]|vd[a-z])/i,
    reason: 'Direct disk write with dd',
  },
  {
    pattern: />\s*\/dev\/(sd[a-z]|nvme|hd[a-z]|vd[a-z])/i,
    reason: 'Redirect to disk device',
  },
  
  // Fork bombs and resource exhaustion
  {
    pattern: /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;?\s*:/,
    reason: 'Fork bomb pattern detected',
  },
  {
    pattern: /while\s*\(\s*true\s*\)\s*;\s*do\s+fork/i,
    reason: 'Fork bomb pattern detected',
  },
  
  // Dangerous file overwrites
  {
    pattern: />\s*\/etc\/(passwd|shadow|sudoers|fstab)/i,
    reason: 'Overwriting critical system file',
  },
  {
    pattern: />\s*\/boot\//i,
    reason: 'Overwriting boot files',
  },
  
  // Kernel and system manipulation
  {
    pattern: /\binsmod\b|\brmmod\b|\bmodprobe\s+-r\b/i,
    reason: 'Kernel module manipulation',
  },
  {
    pattern: /echo\s+.*>\s*\/proc\//i,
    reason: 'Writing to /proc filesystem',
  },
  {
    pattern: /echo\s+.*>\s*\/sys\//i,
    reason: 'Writing to /sys filesystem',
  },
  
  // Network attacks
  {
    pattern: /iptables\s+(-F|-X|--flush|--delete-chain)/i,
    reason: 'Flushing firewall rules',
  },
  
  // Privilege escalation attempts (informational)
  {
    pattern: /chmod\s+[0-7]*777\s+\//i,
    reason: 'Setting dangerous permissions on root',
  },
  {
    pattern: /chown\s+.*\s+\/(?!tmp|home)/i,
    reason: 'Changing ownership of system directories',
  },
];

/**
 * Result of blocklist check
 */
export interface BlocklistCheckResult {
  blocked: boolean;
  reason?: string;
  pattern?: string;
}

/**
 * Check if a command matches any dangerous patterns
 */
export function checkBlocklist(command: string): BlocklistCheckResult {
  // Normalize the command (collapse whitespace)
  const normalized = command.replace(/\s+/g, ' ').trim();
  
  for (const { pattern, reason } of DANGEROUS_PATTERNS) {
    if (pattern.test(normalized)) {
      log.warn('Blocked dangerous command', {
        command: normalized.substring(0, 100),
        reason,
        pattern: pattern.toString(),
      });
      
      return {
        blocked: true,
        reason,
        pattern: pattern.toString(),
      };
    }
  }
  
  return { blocked: false };
}

/**
 * Get a list of all blocked patterns (for documentation)
 */
export function getBlockedPatterns(): Array<{ pattern: string; reason: string }> {
  return DANGEROUS_PATTERNS.map(({ pattern, reason }) => ({
    pattern: pattern.toString(),
    reason,
  }));
}
