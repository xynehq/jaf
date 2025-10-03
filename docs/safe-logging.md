# Safe Console Logging

JAF provides built-in sanitization for both OpenTelemetry traces **and** console/terminal logging. This ensures sensitive data is never exposed in your application logs.

## Quick Start

### 1. Configure Sanitization

Configure sanitization once at application startup:

```typescript
import { configureSanitization } from 'jaf';

// Configure sensitive fields
configureSanitization({
  mode: 'whitelist',
  allowedFields: [
    'userId',
    'sessionId',
    'conversationId',
    'toolName',
    'timestamp',
    'operation',
    'status'
  ]
});
```

### 2. Use Safe Console Logging

Replace `console.log` with `safeConsole.log`:

```typescript
import { safeConsole } from 'jaf/utils/logger';

// ❌ UNSAFE: Logs all data including sensitive fields
console.log('User data:', {
  userId: 'user123',
  email: 'john@example.com',
  password: 'secret',
  token: 'abc-xyz'
});

// ✅ SAFE: Automatically sanitizes sensitive data
safeConsole.log('User data:', {
  userId: 'user123',
  email: 'john@example.com',
  password: 'secret',  // Will show [REDACTED]
  token: 'abc-xyz'     // Will show [REDACTED]
});
```

## Features

### Automatic Sanitization

All `safeConsole` methods automatically sanitize objects before logging:

- `safeConsole.log()` - Info level logging with sanitization
- `safeConsole.debug()` - Debug level logging with sanitization
- `safeConsole.info()` - Info level logging with sanitization
- `safeConsole.warn()` - Warning level logging with sanitization
- `safeConsole.error()` - Error level logging with sanitization

### Default Sensitive Fields

JAF automatically redacts these common sensitive fields:

- `password`, `token`, `apiKey`, `secret`
- `authorization`, `auth`, `credential`
- `sessionId`, `accessToken`, `refreshToken`
- `privateKey`, `expiry`

### Custom Sensitive Fields

Add domain-specific sensitive fields:

```typescript
configureSanitization({
  mode: 'blacklist',
  sensitiveFields: [
    'customerId',
    'merchantId',
    'accountNumber',
    'ssn',
    'creditCard'
  ]
});
```

## Sanitization Modes

### Blacklist Mode (Default)

Allow all fields except those marked as sensitive:

```typescript
configureSanitization({
  mode: 'blacklist',
  sensitiveFields: ['customerId', 'bankAccount']
});

const data = {
  userId: 'user123',      // ✓ Visible
  name: 'John Doe',       // ✓ Visible
  customerId: 'cust456',  // ✗ [REDACTED]
  bankAccount: '1234'     // ✗ [REDACTED]
};

safeConsole.log('Data:', data);
// Output: { userId: 'user123', name: 'John Doe', customerId: '[REDACTED]', bankAccount: '[REDACTED]' }
```

### Whitelist Mode (Recommended for Production)

Redact all fields except those explicitly allowed:

```typescript
configureSanitization({
  mode: 'whitelist',
  allowedFields: ['userId', 'timestamp', 'status']
});

const data = {
  userId: 'user123',      // ✓ Visible
  timestamp: Date.now(),  // ✓ Visible
  status: 'active',       // ✓ Visible
  email: 'john@ex.com',   // ✗ [REDACTED]
  token: 'abc'            // ✗ [REDACTED]
};

safeConsole.log('Data:', data);
// Output: { userId: 'user123', timestamp: 1234567890, status: 'active', email: '[REDACTED]', token: '[REDACTED]' }
```

## Manual Sanitization

For custom use cases, manually sanitize data:

```typescript
import { sanitizeObject } from 'jaf/utils/logger';

const sensitiveData = {
  username: 'admin',
  password: 'secret123',
  publicInfo: 'safe data'
};

const sanitized = sanitizeObject(sensitiveData);
console.log(sanitized);
// Output: { username: 'admin', password: '[REDACTED]', publicInfo: 'safe data' }
```

## Integration Examples

### Example 1: JAF Server

```typescript
import { safeConsole } from 'jaf/utils/logger';
import { configureSanitization } from 'jaf';

// Configure at startup
configureSanitization({
  mode: 'whitelist',
  allowedFields: ['userId', 'sessionId', 'operation', 'timestamp']
});

// In your request handler
app.post('/chat', async (req, reply) => {
  const { messages, context } = req.body;

  // Safe logging - automatically sanitizes context
  safeConsole.log('[REQUEST]', { context, messageCount: messages.length });

  // ... rest of handler
});
```

### Example 2: Agent Engine

```typescript
import { safeConsole } from 'jaf/utils/logger';

export async function run(initialState, config) {
  // Safe logging of state
  safeConsole.log('[ENGINE] Starting run', {
    runId: initialState.runId,
    context: initialState.context  // Automatically sanitized
  });

  // ... rest of engine code
}
```

### Example 3: Custom Tools

```typescript
import { safeConsole } from 'jaf/utils/logger';

const myTool = {
  name: 'customer_lookup',
  async execute(args) {
    // Safe logging of tool arguments
    safeConsole.log('[TOOL] Executing customer_lookup', args);

    const result = await lookupCustomer(args.customerId);

    // Safe logging of results
    safeConsole.log('[TOOL] Result:', result);

    return result;
  }
};
```

## Advanced Configuration

### Custom Sanitizer Function

```typescript
configureSanitization({
  customSanitizer: (key, value, depth) => {
    // Mask email addresses
    if (key === 'email' && typeof value === 'string') {
      const [local, domain] = value.split('@');
      return `${local.substring(0, 2)}***@${domain}`;
    }

    // Mask phone numbers
    if (key === 'phoneNumber' && typeof value === 'string') {
      return `***-***-${value.slice(-4)}`;
    }

    // Use default behavior for other fields
    return undefined;
  }
});
```

### Adjust Sanitization Depth

```typescript
configureSanitization({
  maxDepth: 10,  // Default is 5
  redactionPlaceholder: '[PROTECTED]'  // Default is '[REDACTED]'
});
```

## Benefits

1. **Unified Sanitization**: Same configuration applies to both OTEL traces and console logs
2. **Zero-Config**: Works out of the box with sensible defaults
3. **Flexible**: Supports both blacklist and whitelist modes
4. **Drop-in Replacement**: Just replace `console.log` with `safeConsole.log`
5. **Nested Objects**: Sanitizes deeply nested objects automatically
6. **Performance**: Minimal overhead, only sanitizes when logging

## Best Practices

1. **Configure Early**: Set up sanitization at application startup
2. **Use Whitelist in Production**: Most secure for production environments
3. **Use safeConsole Everywhere**: Replace all `console.log` calls for objects
4. **Review Logs**: Regularly audit logs to ensure no leaks
5. **Document Allowed Fields**: Keep a record of why certain fields are allowed
6. **Test Sanitization**: Verify sensitive data is properly redacted

## Migration Guide

### Before (Unsafe)

```typescript
// Configuration
console.log('Starting server with config:', config);

// User data
console.log('User logged in:', userData);

// Context
console.log('Context:', context);
```

### After (Safe)

```typescript
import { safeConsole } from 'jaf/utils/logger';
import { configureSanitization } from 'jaf';

// Configure once
configureSanitization({
  mode: 'whitelist',
  allowedFields: ['userId', 'sessionId', 'operation']
});

// Use safeConsole
safeConsole.log('Starting server with config:', config);  // Sanitized
safeConsole.log('User logged in:', userData);              // Sanitized
safeConsole.log('Context:', context);                       // Sanitized
```

## See Also

- [Custom Sanitization Guide](./sanitization.md) - Advanced sanitization patterns
- [Tracing Documentation](./tracing.md) - OpenTelemetry trace sanitization
- [Examples](../examples/safe-logging-example.ts) - Complete working examples
