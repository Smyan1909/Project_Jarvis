// =============================================================================
// Logger Utility
// =============================================================================
// Simple logging utility for the MCP server

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogContext {
  [key: string]: unknown;
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

class Logger {
  private level: LogLevel = 'info';
  private context: LogContext = {};

  constructor(context: LogContext = {}) {
    this.context = context;
    
    // Get log level from environment
    const envLevel = process.env.LOG_LEVEL?.toLowerCase();
    if (envLevel && envLevel in LOG_LEVELS) {
      this.level = envLevel as LogLevel;
    }
  }

  /**
   * Create a child logger with additional context
   */
  child(context: LogContext): Logger {
    const child = new Logger({ ...this.context, ...context });
    child.level = this.level;
    return child;
  }

  /**
   * Set the log level
   */
  setLevel(level: LogLevel): void {
    this.level = level;
  }

  /**
   * Log at debug level
   */
  debug(message: string, context?: LogContext): void {
    this.log('debug', message, context);
  }

  /**
   * Log at info level
   */
  info(message: string, context?: LogContext): void {
    this.log('info', message, context);
  }

  /**
   * Log at warn level
   */
  warn(message: string, context?: LogContext): void {
    this.log('warn', message, context);
  }

  /**
   * Log at error level
   */
  error(message: string, context?: LogContext): void {
    this.log('error', message, context);
  }

  private log(level: LogLevel, message: string, context?: LogContext): void {
    if (LOG_LEVELS[level] < LOG_LEVELS[this.level]) {
      return;
    }

    const timestamp = new Date().toISOString();
    const mergedContext = { ...this.context, ...context };

    const logEntry = {
      timestamp,
      level: level.toUpperCase(),
      message,
      ...mergedContext,
    };

    // Format for console output
    const contextStr = Object.keys(mergedContext).length > 0
      ? ` ${JSON.stringify(mergedContext)}`
      : '';

    const output = `[${timestamp}] ${level.toUpperCase().padEnd(5)} ${message}${contextStr}`;

    switch (level) {
      case 'debug':
        console.debug(output);
        break;
      case 'info':
        console.info(output);
        break;
      case 'warn':
        console.warn(output);
        break;
      case 'error':
        console.error(output);
        break;
    }
  }
}

// Export singleton instance
export const log = new Logger({ module: 'mcp-server' });

// Export class for creating child loggers
export { Logger };
