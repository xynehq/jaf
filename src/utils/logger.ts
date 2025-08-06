/**
 * JAF Logging System
 * 
 * Provides structured logging with different levels and output targets
 */

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  FATAL = 4,
  SILENT = 5
}

export interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: Date;
  context?: string;
  metadata?: Record<string, unknown>;
  error?: Error;
}

export interface LoggerConfig {
  level?: LogLevel;
  context?: string;
  output?: LogOutput;
  format?: LogFormat;
}

export type LogOutput = 'console' | 'silent' | 'custom';
export type LogFormat = 'json' | 'text' | 'pretty';

export interface Logger {
  debug: (message: string, metadata?: Record<string, unknown>) => void;
  info: (message: string, metadata?: Record<string, unknown>) => void;
  warn: (message: string, metadata?: Record<string, unknown>) => void;
  error: (message: string, error?: Error | unknown, metadata?: Record<string, unknown>) => void;
  fatal: (message: string, error?: Error | unknown, metadata?: Record<string, unknown>) => void;
  child: (context: string) => Logger;
  setLevel: (level: LogLevel) => void;
}

// Global configuration
let globalLogLevel = LogLevel.INFO;
let globalOutput: LogOutput = 'console';
let globalFormat: LogFormat = 'text';

// Set from environment
if (process.env.LOG_LEVEL) {
  const level = process.env.LOG_LEVEL.toUpperCase();
  globalLogLevel = LogLevel[level as keyof typeof LogLevel] || LogLevel.INFO;
}

if (process.env.NODE_ENV === 'test') {
  globalOutput = 'silent';
} else if (process.env.NODE_ENV === 'production') {
  globalFormat = 'json';
}

/**
 * Format log entry based on format type
 */
const formatLogEntry = (entry: LogEntry, format: LogFormat): string => {
  switch (format) {
    case 'json':
      return JSON.stringify({
        level: LogLevel[entry.level],
        timestamp: entry.timestamp.toISOString(),
        message: entry.message,
        context: entry.context,
        ...entry.metadata,
        ...(entry.error && {
          error: {
            message: entry.error.message,
            stack: entry.error.stack,
            name: entry.error.name
          }
        })
      });
    
    case 'pretty': {
      const levelColors: Record<number, string> = {
        [LogLevel.DEBUG]: '\x1b[36m', // Cyan
        [LogLevel.INFO]: '\x1b[32m',  // Green
        [LogLevel.WARN]: '\x1b[33m',  // Yellow
        [LogLevel.ERROR]: '\x1b[31m', // Red
        [LogLevel.FATAL]: '\x1b[35m',  // Magenta
        [LogLevel.SILENT]: '' // No color for silent
      };
      const reset = '\x1b[0m';
      const color = levelColors[entry.level] || '';
      const levelStr = LogLevel[entry.level].padEnd(5);
      const contextStr = entry.context ? `[${entry.context}] ` : '';
      const metaStr = entry.metadata ? ` ${JSON.stringify(entry.metadata)}` : '';
      const errorStr = entry.error ? `\n  ${entry.error.stack || entry.error.message}` : '';
      
      return `${color}${levelStr}${reset} ${contextStr}${entry.message}${metaStr}${errorStr}`;
    }
    
    case 'text':
    default: {
      const level = LogLevel[entry.level].padEnd(5);
      const context = entry.context ? `[${entry.context}] ` : '';
      const meta = entry.metadata ? ` ${JSON.stringify(entry.metadata)}` : '';
      const error = entry.error ? ` Error: ${entry.error.message}` : '';
      
      return `${level} ${context}${entry.message}${meta}${error}`;
    }
  }
};

/**
 * Output log entry based on output type
 */
const outputLogEntry = (entry: LogEntry, output: LogOutput, format: LogFormat): void => {
  if (output === 'silent') {
    return;
  }
  
  const formatted = formatLogEntry(entry, format);
  
  if (output === 'console') {
    switch (entry.level) {
      case LogLevel.DEBUG:
      case LogLevel.INFO:
        console.log(formatted);
        break;
      case LogLevel.WARN:
        console.warn(formatted);
        break;
      case LogLevel.ERROR:
      case LogLevel.FATAL:
        console.error(formatted);
        break;
    }
  }
};

/**
 * Create a logger instance
 */
export const createLogger = (config?: LoggerConfig): Logger => {
  const level = config?.level ?? globalLogLevel;
  const context = config?.context;
  const output = config?.output ?? globalOutput;
  const format = config?.format ?? globalFormat;
  
  const log = (logLevel: LogLevel, message: string, error?: Error | unknown, metadata?: Record<string, unknown>): void => {
    if (logLevel < level) {
      return;
    }
    
    const entry: LogEntry = {
      level: logLevel,
      message,
      timestamp: new Date(),
      context,
      metadata,
      error: error instanceof Error ? error : undefined
    };
    
    outputLogEntry(entry, output, format);
  };
  
  return {
    debug: (message: string, metadata?: Record<string, unknown>) => {
      log(LogLevel.DEBUG, message, undefined, metadata);
    },
    
    info: (message: string, metadata?: Record<string, unknown>) => {
      log(LogLevel.INFO, message, undefined, metadata);
    },
    
    warn: (message: string, metadata?: Record<string, unknown>) => {
      log(LogLevel.WARN, message, undefined, metadata);
    },
    
    error: (message: string, error?: Error | unknown, metadata?: Record<string, unknown>) => {
      log(LogLevel.ERROR, message, error, metadata);
    },
    
    fatal: (message: string, error?: Error | unknown, metadata?: Record<string, unknown>) => {
      log(LogLevel.FATAL, message, error, metadata);
    },
    
    child: (childContext: string): Logger => {
      return createLogger({
        level,
        context: context ? `${context}:${childContext}` : childContext,
        output,
        format
      });
    },
    
    setLevel: (newLevel: LogLevel) => {
      // Note: This only affects this instance, not the global level
      return createLogger({
        level: newLevel,
        context,
        output,
        format
      });
    }
  };
};

/**
 * Default logger instance
 */
export const logger = createLogger();

/**
 * Configure global logger settings
 */
export const configureLogger = (config: {
  level?: LogLevel;
  output?: LogOutput;
  format?: LogFormat;
}): void => {
  if (config.level !== undefined) {
    globalLogLevel = config.level;
  }
  if (config.output !== undefined) {
    globalOutput = config.output;
  }
  if (config.format !== undefined) {
    globalFormat = config.format;
  }
};

/**
 * Create a context-specific logger
 */
export const getLogger = (context: string): Logger => {
  return createLogger({ context });
};

/**
 * Utility to safely stringify errors
 */
export const stringifyError = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
};