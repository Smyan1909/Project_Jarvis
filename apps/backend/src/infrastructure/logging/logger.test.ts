import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { logger, correlationMiddleware } from './logger';

describe('Logger', () => {
    let consoleSpy: any;

    beforeEach(() => {
        consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => { });
    });

    afterEach(() => {
        consoleSpy.mockRestore();
    });

    it('should log info messages with correct structure', () => {
        logger.info('Test message', { key: 'value' });

        expect(consoleSpy).toHaveBeenCalledTimes(1);
        const logOutput = JSON.parse(consoleSpy.mock.calls[0][0]);

        expect(logOutput.level).toBe('info');
        expect(logOutput.message).toBe('Test message');
        expect(logOutput.key).toBe('value');
        expect(logOutput.timestamp).toBeDefined();
    });

    it('should log warn messages', () => {
        logger.warn('Warning message');

        const logOutput = JSON.parse(consoleSpy.mock.calls[0][0]);
        expect(logOutput.level).toBe('warn');
    });

    it('should log errors with stack trace', () => {
        const error = new Error('Test error');
        logger.error('Error occurred', error);

        const logOutput = JSON.parse(consoleSpy.mock.calls[0][0]);
        expect(logOutput.level).toBe('error');
        expect(logOutput.error.message).toBe('Test error');
        expect(logOutput.error.stack).toBeDefined();
    });

    it('should create child logger with context', () => {
        const childLogger = logger.child({ userId: 'user-123', runId: 'run-456' });
        childLogger.info('Child log');

        const logOutput = JSON.parse(consoleSpy.mock.calls[0][0]);
        expect(logOutput.userId).toBe('user-123');
        expect(logOutput.runId).toBe('run-456');
    });

    it('should merge child context with log data', () => {
        const childLogger = logger.child({ userId: 'user-123' });
        childLogger.info('Action', { action: 'login' });

        const logOutput = JSON.parse(consoleSpy.mock.calls[0][0]);
        expect(logOutput.userId).toBe('user-123');
        expect(logOutput.action).toBe('login');
    });
});

describe('Correlation Middleware', () => {
    it('should add correlation ID from header', () => {
        const req: any = { headers: { 'x-correlation-id': 'existing-id' } };
        const res: any = { setHeader: vi.fn() };
        const next = vi.fn();

        correlationMiddleware(req, res, next);

        expect(req.correlationId).toBe('existing-id');
        expect(res.setHeader).toHaveBeenCalledWith('x-correlation-id', 'existing-id');
        expect(next).toHaveBeenCalled();
    });

    it('should generate correlation ID if not provided', () => {
        const req: any = { headers: {} };
        const res: any = { setHeader: vi.fn() };
        const next = vi.fn();

        correlationMiddleware(req, res, next);

        expect(req.correlationId).toBeDefined();
        expect(req.correlationId.length).toBe(36); // UUID format
        expect(next).toHaveBeenCalled();
    });

    it('should attach child logger to request', () => {
        const req: any = { headers: {} };
        const res: any = { setHeader: vi.fn() };
        const next = vi.fn();

        correlationMiddleware(req, res, next);

        expect(req.logger).toBeDefined();
        expect(typeof req.logger.info).toBe('function');
    });
});
