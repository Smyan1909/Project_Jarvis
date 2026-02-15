// =============================================================================
// Logger Utility
// =============================================================================
// Simple logging utility with timestamps for debugging.

function getTimestamp(): string {
  const now = new Date();
  return now.toISOString();
}

function formatMessage(level: string, namespace: string, message: string): string {
  return `[${getTimestamp()}] [${level}] [${namespace}] ${message}`;
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    let output = `Error: ${error.message}`;
    if (error.stack) {
      output += `\nStack Trace:\n${error.stack}`;
    }
    return output;
  }
  return String(error);
}

function processArgs(args: unknown[]): { processedArgs: unknown[]; hasError: boolean; errorOutput?: string } {
  let hasError = false;
  let errorOutput = '';
  const processedArgs = args.map((arg) => {
    if (arg instanceof Error) {
      hasError = true;
      errorOutput += formatError(arg) + '\n';
      return { errorMessage: arg.message, errorName: arg.name };
    }
    return arg;
  });
  return { processedArgs, hasError, errorOutput: errorOutput || undefined };
}

export const logger = {
  debug: (namespace: string, message: string, ...args: unknown[]) => {
    const { processedArgs, hasError, errorOutput } = processArgs(args);
    console.log(formatMessage('DEBUG', namespace, message), ...processedArgs);
    if (hasError && errorOutput) {
      console.log(formatMessage('DEBUG', namespace, 'Stack Trace:'), '\n' + errorOutput);
    }
  },

  info: (namespace: string, message: string, ...args: unknown[]) => {
    const { processedArgs, hasError, errorOutput } = processArgs(args);
    console.log(formatMessage('INFO', namespace, message), ...processedArgs);
    if (hasError && errorOutput) {
      console.log(formatMessage('INFO', namespace, 'Stack Trace:'), '\n' + errorOutput);
    }
  },

  warn: (namespace: string, message: string, ...args: unknown[]) => {
    const { processedArgs, hasError, errorOutput } = processArgs(args);
    console.warn(formatMessage('WARN', namespace, message), ...processedArgs);
    if (hasError && errorOutput) {
      console.warn(formatMessage('WARN', namespace, 'Stack Trace:'), '\n' + errorOutput);
    }
  },

  error: (namespace: string, message: string, ...args: unknown[]) => {
    const { processedArgs, hasError, errorOutput } = processArgs(args);
    console.error(formatMessage('ERROR', namespace, message), ...processedArgs);
    if (hasError && errorOutput) {
      console.error(formatMessage('ERROR', namespace, 'Stack Trace:'), '\n' + errorOutput);
    }
  },
};

export default logger;
