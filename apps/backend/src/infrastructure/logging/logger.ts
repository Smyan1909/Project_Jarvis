import { randomUUID } from 'crypto';
import { trace } from '@opentelemetry/api';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogContext {
    correlationId?: string;
    userId?: string;
    runId?: string;
    [key: string]: unknown;
}

class Logger {
    private context: LogContext = {};

    child(context: LogContext): Logger {
        const child = new Logger();
        child.context = { ...this.context, ...context };
        return child;
    }

    private log(level: LogLevel, message: string, data?: Record<string, unknown>) {
        // Get trace context from OpenTelemetry
        const span = trace.getActiveSpan();
        const spanContext = span?.spanContext();

        const entry = {
            timestamp: new Date().toISOString(),
            level,
            message,
            // Include trace context for log correlation
            trace_id: spanContext?.traceId,
            span_id: spanContext?.spanId,
            ...this.context,
            ...data,
        };

        // In production, send to log aggregator
        // For now, structured JSON to stdout
        console.log(JSON.stringify(entry));
    }

    debug(message: string, data?: Record<string, unknown>) {
        if (process.env.NODE_ENV !== 'production') {
            this.log('debug', message, data);
        }
    }

    info(message: string, data?: Record<string, unknown>) {
        this.log('info', message, data);
    }

    warn(message: string, data?: Record<string, unknown>) {
        this.log('warn', message, data);
    }

    error(message: string, error?: unknown, data?: Record<string, unknown>) {
        let errorData: Record<string, unknown> | undefined;
        
        if (error instanceof Error) {
            errorData = { message: error.message, stack: error.stack, name: error.name };
        } else if (error !== undefined) {
            errorData = { message: String(error) };
        }
        
        this.log('error', message, {
            ...data,
            error: errorData,
        });
    }
}

export const logger = new Logger();

// Middleware to add correlation ID
export function correlationMiddleware(req: any, res: any, next: any) {
    const correlationId = req.headers['x-correlation-id'] || randomUUID();
    req.correlationId = correlationId;
    req.logger = logger.child({ correlationId });
    res.setHeader('x-correlation-id', correlationId);
    next();
}
