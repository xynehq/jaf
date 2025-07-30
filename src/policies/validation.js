"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.composeValidations = void 0;
exports.withValidation = withValidation;
exports.createPathValidator = createPathValidator;
exports.createContentFilter = createContentFilter;
exports.createRateLimiter = createRateLimiter;
exports.createPermissionValidator = createPermissionValidator;
const composeValidations = (...fns) => (a, c) => fns.reduce((acc, f) => (acc.isValid ? f(a, c) : acc), { isValid: true });
exports.composeValidations = composeValidations;
function withValidation(tool, validate) {
    return {
        ...tool,
        async execute(args, ctx) {
            const result = validate(args, ctx);
            if (!result.isValid) {
                return JSON.stringify({
                    error: "validation_error",
                    message: result.errorMessage,
                    tool_name: tool.schema.name,
                });
            }
            return tool.execute(args, ctx);
        },
    };
}
function createPathValidator(allowedPaths, contextAccessor) {
    return (args, ctx) => {
        const context = contextAccessor?.(ctx);
        for (const allowedPath of allowedPaths) {
            if (args.path.startsWith(allowedPath)) {
                if (allowedPath.includes('/admin') && context?.permissions) {
                    if (!context.permissions.includes('admin')) {
                        return {
                            isValid: false,
                            errorMessage: 'Admin access required for this path'
                        };
                    }
                }
                return { isValid: true };
            }
        }
        return {
            isValid: false,
            errorMessage: `Path ${args.path} is not allowed`
        };
    };
}
function createContentFilter() {
    const blockedPatterns = [
        /password/i,
        /secret/i,
        /api[_-]?key/i,
        /token/i,
        /private[_-]?key/i
    ];
    return (input) => {
        for (const pattern of blockedPatterns) {
            if (pattern.test(input)) {
                return {
                    isValid: false,
                    errorMessage: 'Content contains potentially sensitive information'
                };
            }
        }
        return { isValid: true };
    };
}
function createRateLimiter(maxCalls, windowMs, keyExtractor) {
    const callCounts = new Map();
    return (input) => {
        const key = keyExtractor(input);
        const now = Date.now();
        const entry = callCounts.get(key);
        if (!entry || now > entry.resetTime) {
            callCounts.set(key, { count: 1, resetTime: now + windowMs });
            return { isValid: true };
        }
        if (entry.count >= maxCalls) {
            return {
                isValid: false,
                errorMessage: `Rate limit exceeded. Max ${maxCalls} calls per ${windowMs}ms`
            };
        }
        entry.count++;
        return { isValid: true };
    };
}
function createPermissionValidator(requiredPermission, contextAccessor) {
    return (args, ctx) => {
        const context = contextAccessor(ctx);
        if (!context.permissions?.includes(requiredPermission)) {
            return {
                isValid: false,
                errorMessage: `Required permission: ${requiredPermission}`
            };
        }
        return { isValid: true };
    };
}
