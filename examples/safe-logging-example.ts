/**
 * Example: Safe Console Logging with Automatic Sanitization
 *
 * This example demonstrates how to use JAF's safe console logging
 * to automatically sanitize sensitive data in terminal/CLI logs.
 */

import { safeConsole, sanitizeObject } from '../src/utils/logger.js';
import { configureSanitization } from '../src/core/tracing.js';

// ============================================================================
// Configure Sanitization
// ============================================================================

console.log('\n=== Configuring Sanitization ===\n');

// Configure custom sensitive fields
configureSanitization({
  mode: 'blacklist',
  sensitiveFields: [
    'customerId',
    'merchantId',
    'accountNumber'
  ]
});

console.log('✓ Sanitization configured with custom sensitive fields\n');

// ============================================================================
// Example 1: Unsafe vs Safe Logging
// ============================================================================

console.log('\n=== Example 1: Unsafe vs Safe Logging ===\n');

const userData = {
  userId: 'user123',
  email: 'john@example.com',
  password: 'secret123',
  token: 'abc-xyz-token',
  sessionId: 'session-456',
  firstName: 'John',
  lastName: 'Doe',
  phoneNumber: '+1234567890',
  customerId: 'cust-789'
};

// ❌ UNSAFE: This will log all sensitive data
console.log('UNSAFE - Raw user data:', userData);

// ✅ SAFE: This will automatically sanitize sensitive fields
safeConsole.log('SAFE - Sanitized user data:', userData);

console.log('\n');

// ============================================================================
// Example 2: Logging Complex Nested Objects
// ============================================================================

console.log('\n=== Example 2: Nested Objects ===\n');

const orderData = {
  orderId: 'order-123',
  customer: {
    customerId: 'cust-456',
    name: 'Jane Smith',
    email: 'jane@example.com',
    address: {
      street: '123 Main St',
      city: 'New York',
      zipCode: '10001',
      accountNumber: 'ACC-789'
    }
  },
  payment: {
    cardNumber: '4111-1111-1111-1111',
    cvv: '123',
    token: 'payment-token-xyz'
  },
  items: [
    { productId: 'prod-1', name: 'Widget', price: 29.99 },
    { productId: 'prod-2', name: 'Gadget', price: 49.99 }
  ]
};

// ❌ UNSAFE
console.log('UNSAFE - Order with payment details:', orderData);

// ✅ SAFE
safeConsole.log('SAFE - Sanitized order data:', orderData);

console.log('\n');

// ============================================================================
// Example 3: Using safeConsole for Different Log Levels
// ============================================================================

console.log('\n=== Example 3: Different Log Levels ===\n');

const debugContext = {
  operation: 'user_login',
  timestamp: new Date().toISOString(),
  userId: 'user-456',
  sessionId: 'session-789',
  token: 'auth-token-abc',
  ipAddress: '192.168.1.1'
};

// All log levels support sanitization
safeConsole.debug('DEBUG:', debugContext);
safeConsole.info('INFO:', debugContext);
safeConsole.warn('WARN:', debugContext);
safeConsole.error('ERROR:', debugContext);

console.log('\n');

// ============================================================================
// Example 4: Manual Sanitization for Custom Use Cases
// ============================================================================

console.log('\n=== Example 4: Manual Sanitization ===\n');

const sensitiveData = {
  username: 'admin',
  password: 'admin123',
  apiKey: 'sk-1234567890',
  publicInfo: 'This is safe to log'
};

// Manually sanitize and use in custom logging
const sanitized = sanitizeObject(sensitiveData);
console.log('Manually sanitized data:', sanitized);

console.log('\n');

// ============================================================================
// Example 5: Whitelist Mode
// ============================================================================

console.log('\n=== Example 5: Whitelist Mode (Most Secure) ===\n');

// Switch to whitelist mode for maximum security
configureSanitization({
  mode: 'whitelist',
  allowedFields: ['userId', 'timestamp', 'status', 'operation']
});

const serverEvent = {
  userId: 'user-123',
  timestamp: Date.now(),
  status: 'success',
  operation: 'data_fetch',
  sessionId: 'session-456',    // Will be redacted
  token: 'auth-token',          // Will be redacted
  customerData: {               // Will be redacted
    name: 'John Doe',
    email: 'john@example.com'
  }
};

safeConsole.log('Whitelist mode - only allowed fields visible:', serverEvent);

console.log('\n');

// ============================================================================
// Best Practices
// ============================================================================

console.log('\n=== Best Practices ===\n');
console.log('1. Always use safeConsole.log() instead of console.log() for objects');
console.log('2. Configure sanitization early in your application startup');
console.log('3. Use whitelist mode for production environments');
console.log('4. Add domain-specific sensitive fields to sensitiveFields array');
console.log('5. Review logs regularly to ensure no sensitive data is leaked');
console.log('6. The same sanitization applies to both OTEL traces and console logs');
console.log('\n');

// ============================================================================
// Integration with Existing Code
// ============================================================================

console.log('\n=== Integration Example ===\n');

// In your application initialization:
function initializeApp() {
  // Configure sanitization once at startup
  configureSanitization({
    mode: 'whitelist',
    allowedFields: [
      'userId',
      'sessionId',
      'conversationId',
      'toolName',
      'timestamp',
      'operation',
      'status',
      'statusCode',
      'error_code',
      'executionTimeMs'
    ]
  });

  console.log('✓ Application initialized with sanitization');
}

// In your logging code:
function logUserActivity(activity: any) {
  // Replace console.log with safeConsole.log
  safeConsole.log('[USER_ACTIVITY]', activity);
}

// Example usage
initializeApp();
logUserActivity({
  userId: 'user-123',
  operation: 'login',
  timestamp: Date.now(),
  sessionId: 'session-456',
  token: 'auth-token',  // Will be redacted
  password: 'secret'     // Will be redacted
});

console.log('\n=== Example Complete ===\n');
