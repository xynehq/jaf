# Custom Sanitization Guide

JAF provides powerful data sanitization capabilities to protect sensitive information in logs and traces. This guide shows you how to configure custom sanitization rules for your specific use case.

## Quick Start

```typescript
import { configureSanitization } from 'jaf';

// Blacklist mode (default): Add custom sensitive fields
configureSanitization({
  sensitiveFields: ['customerId', 'merchantId', 'accountNumber']
});

// Whitelist mode: Only allow specific fields
configureSanitization({
  mode: 'whitelist',
  allowedFields: ['userId', 'timestamp', 'status', 'operation']
});
```

## Features

- **Default Protection**: Automatically redacts common sensitive fields (passwords, tokens, API keys, etc.)
- **Blacklist Mode**: Allow all fields except sensitive ones (default)
- **Whitelist Mode**: Redact all fields except explicitly allowed ones
- **Custom Fields**: Add your own sensitive field patterns
- **Custom Sanitizers**: Write custom logic for field-level sanitization
- **Flexible Configuration**: Configure redaction placeholders, max depth, and more

## Configuration Options

### 1. Choosing a Sanitization Mode

JAF supports two modes for sanitization:

#### Blacklist Mode (Default)

In blacklist mode, all fields are allowed **except** those marked as sensitive:

```typescript
configureSanitization({
  mode: 'blacklist',  // Optional, this is the default
  sensitiveFields: [
    'customerId',
    'bankAccount',
    'ssn',
    'creditCard',
    'merchantId'
  ]
});
```

Any field name containing these patterns (case-insensitive) will be redacted.

#### Whitelist Mode

In whitelist mode, **all fields are redacted by default** except those explicitly allowed. This is the most secure approach:

```typescript
configureSanitization({
  mode: 'whitelist',
  allowedFields: [
    'userId',        // User identifiers
    'timestamp',     // Timing information
    'status',        // Status codes
    'operation',     // Operation names
    'duration',      // Performance metrics
    'error_code'     // Error codes (but not messages)
  ]
});
```

**Important: Field Matching Behavior**
- Whitelist mode uses **exact, case-insensitive matching** for security
- Example: If you whitelist `'id'`, only fields named exactly `'id'` (any case) will be allowed
- Fields like `'customerId'`, `'userId'`, or `'cardId'` will be **redacted** (not matched)
- This prevents accidental data leaks through similar field names

**When to use whitelist mode:**
- You want maximum security and control over what data is sent to Langfuse
- You only need specific metadata fields for debugging
- You're dealing with highly sensitive data (PII, PHI, financial data)
- You want to comply with strict data privacy regulations (GDPR, HIPAA, PCI-DSS)

**When to use blacklist mode:**
- You need comprehensive debugging information
- You have a well-defined set of sensitive fields
- Your data is less sensitive overall

### 2. Adding Custom Sensitive Fields (Blacklist Mode)

```typescript
configureSanitization({
  sensitiveFields: [
    'customerId',
    'bankAccount',
    'ssn',
    'creditCard',
    'merchantId'
  ]
});
```

Any field name containing these patterns (case-insensitive) will be redacted.

### 3. Custom Sanitizer Function

```typescript
configureSanitization({
  customSanitizer: (key, value, depth) => {
    // Email masking
    if (key === 'email' && typeof value === 'string') {
      const atIndex = value.lastIndexOf('@');
      if (atIndex > 0 && atIndex < value.length - 1) {
        const local = value.substring(0, atIndex);
        const domain = value.substring(atIndex);
        const masked = local.length >= 2
          ? `${local.substring(0, 2)}***${domain}`
          : `${local[0] || ''}***${domain}`;
        return masked;
      }
      return '[INVALID_EMAIL]';
    }

    // Phone masking
    if (key === 'phone' && typeof value === 'string') {
      return `***-***-${value.slice(-4)}`;
    }

    // Return undefined to use default sanitization
    return undefined;
  }
});
```

### 4. Custom Redaction Placeholder

```typescript
configureSanitization({
  redactionPlaceholder: '[PII_PROTECTED]'
});
```

### 5. Maximum Depth

```typescript
configureSanitization({
  maxDepth: 10  // Default is 5
});
```

## Complete Examples

### Blacklist Mode Example

```typescript
import { configureSanitization, OpenTelemetryTraceCollector } from 'jaf';

// Configure sanitization BEFORE creating trace collectors
configureSanitization({
  mode: 'blacklist', // Optional, this is the default

  // Add domain-specific sensitive fields
  sensitiveFields: ['customerId', 'merchantId', 'orderId'],

  // Custom sanitizer for fine-grained control
  customSanitizer: (key, value, depth) => {
    // Mask emails
    if (key.toLowerCase().includes('email') && typeof value === 'string') {
      const atIndex = value.lastIndexOf('@');
      if (atIndex > 0 && atIndex < value.length - 1) {
        const local = value.substring(0, atIndex);
        const domain = value.substring(atIndex);
        return local.length >= 2
          ? `${local.substring(0, 2)}***${domain}`
          : `${local[0] || ''}***${domain}`;
      }
      return '[INVALID_EMAIL]';
    }

    // Mask phone numbers
    if ((key === 'phone' || key === 'phoneNumber') && typeof value === 'string') {
      return `***-***-${value.slice(-4)}`;
    }

    // Mask credit cards
    if (key.toLowerCase().includes('card') && typeof value === 'string') {
      const digits = value.replace(/\D/g, '');
      if (digits.length === 16) {
        return `****-****-****-${digits.slice(-4)}`;
      }
    }

    return undefined; // Use default behavior for other fields
  },

  // Custom redaction text
  redactionPlaceholder: '[REDACTED]',

  // Increase depth for deeply nested objects
  maxDepth: 10
});

// Now create your trace collector
const traceCollector = new OpenTelemetryTraceCollector();
```

### Whitelist Mode Example

```typescript
import { configureSanitization, OpenTelemetryTraceCollector } from 'jaf';

// Configure WHITELIST mode for maximum security
configureSanitization({
  mode: 'whitelist',

  // Only allow these specific fields - everything else is redacted
  allowedFields: [
    // Identifiers (non-sensitive)
    'userId',
    'sessionId',
    'requestId',
    'traceId',

    // Metadata
    'timestamp',
    'operation',
    'method',
    'path',

    // Status and metrics
    'status',
    'statusCode',
    'duration',
    'latency',
    'error_code',

    // Non-sensitive business data
    'product_category',
    'transaction_type',
    'currency_code'
  ],

  // Still use custom sanitizer for allowed fields if needed
  customSanitizer: (key, value, depth) => {
    // Even for allowed fields, you can apply transformations
    if (key === 'userId' && typeof value === 'string') {
      // Hash user IDs for privacy while maintaining uniqueness
      const hash = value.split('').reduce((acc, char) => {
        return ((acc << 5) - acc) + char.charCodeAt(0);
      }, 0);
      return `user_${Math.abs(hash)}`;
    }

    return undefined;
  },

  redactionPlaceholder: '[PROTECTED]',
  maxDepth: 10
});

// Now create your trace collector
const traceCollector = new OpenTelemetryTraceCollector();
```

## Domain-Specific Examples

### E-commerce (Blacklist Mode)

```typescript
configureSanitization({
  mode: 'blacklist',
  sensitiveFields: [
    'customerId', 'customerEmail',
    'cardNumber', 'cvv', 'expiryDate',
    'orderToken', 'transactionId'
  ],
  customSanitizer: (key, value) => {
    if (key === 'price' && typeof value === 'number') {
      return `~${Math.round(value / 10) * 10}`; // Round for privacy
    }
    return undefined;
  }
});
```

### E-commerce (Whitelist Mode - Recommended)

```typescript
configureSanitization({
  mode: 'whitelist',
  allowedFields: [
    // Order metadata (non-sensitive)
    'orderId',           // Order ID is fine to log
    'orderStatus',       // Status tracking
    'orderTimestamp',    // Timing info

    // Product info
    'productId',
    'productCategory',
    'quantity',

    // Payment status (not details)
    'paymentStatus',
    'paymentMethod',     // e.g., 'credit_card', not the actual number

    // Shipping info (aggregate)
    'shippingMethod',
    'estimatedDelivery'
  ]
});
```

### Financial Services (Blacklist Mode)

```typescript
configureSanitization({
  mode: 'blacklist',
  sensitiveFields: [
    'accountNumber', 'iban', 'routingNumber',
    'ssn', 'taxId', 'transactionAmount', 'balance'
  ],
  customSanitizer: (key, value) => {
    if (key.includes('amount') || key.includes('balance')) {
      return '[AMOUNT_REDACTED]';
    }
    return undefined;
  },
  redactionPlaceholder: '[PII_REDACTED]'
});
```

### Financial Services (Whitelist Mode - Recommended)

```typescript
configureSanitization({
  mode: 'whitelist',
  allowedFields: [
    // Transaction metadata only
    'transactionId',
    'transactionType',     // e.g., 'transfer', 'payment'
    'transactionStatus',
    'timestamp',

    // Currency and codes (not amounts)
    'currencyCode',
    'countryCode',

    // Error tracking
    'errorCode',
    'statusCode',

    // Performance metrics
    'processingTime',
    'queueTime'
  ],
  redactionPlaceholder: '[PII_REDACTED]'
});
```

### Healthcare/HIPAA (Blacklist Mode)

```typescript
configureSanitization({
  mode: 'blacklist',
  sensitiveFields: [
    'patientId', 'mrn', 'dateOfBirth',
    'diagnosis', 'medication', 'labResults',
    'insuranceId', 'memberId'
  ],
  customSanitizer: (key, value) => {
    // Convert DOB to age ranges
    if ((key === 'dateOfBirth' || key === 'dob') && typeof value === 'string') {
      const age = new Date().getFullYear() - new Date(value).getFullYear();
      return `Age Range: ${Math.floor(age / 10) * 10}-${Math.floor(age / 10) * 10 + 9}`;
    }
    return undefined;
  },
  redactionPlaceholder: '[PHI_PROTECTED]'
});
```

### Healthcare/HIPAA (Whitelist Mode - Recommended)

```typescript
configureSanitization({
  mode: 'whitelist',
  allowedFields: [
    // Appointment metadata only
    'appointmentId',
    'appointmentType',    // e.g., 'checkup', 'followup'
    'appointmentStatus',
    'timestamp',

    // Department/facility (non-PHI)
    'department',
    'facilityId',

    // System metadata
    'requestId',
    'sessionId',

    // Error tracking
    'errorCode',
    'statusCode'
  ],
  redactionPlaceholder: '[PHI_PROTECTED]'
});
```

## Default Sensitive Fields (Blacklist Mode Only)

In blacklist mode, JAF automatically redacts these fields by default:

- `password`
- `token`, `accessToken`, `refreshToken`
- `apiKey`, `api_key`
- `secret`
- `authorization`, `auth`
- `credential`, `credentials`
- `sessionId`, `session_id`
- `privateKey`, `private_key`
- `expiry`
- `davv`

**Note:** In whitelist mode, these defaults are ignored. Only fields in `allowedFields` are preserved.

## API Reference

### `configureSanitization(config: SanitizationConfig)`

Configure global sanitization settings for all trace collectors.

**Parameters:**
- `config.mode?: 'blacklist' | 'whitelist'` - Sanitization mode (default: 'blacklist')
- `config.allowedFields?: string[]` - Fields to allow in whitelist mode
- `config.sensitiveFields?: string[]` - Additional sensitive field patterns (blacklist mode)
- `config.customSanitizer?: CustomSanitizerFn` - Custom sanitizer function
- `config.maxDepth?: number` - Maximum recursion depth (default: 5)
- `config.redactionPlaceholder?: string` - Redaction text (default: '[REDACTED]')

### `resetSanitizationConfig()`

Reset sanitization configuration to defaults.

### `CustomSanitizerFn`

```typescript
type CustomSanitizerFn = (
  key: string,      // Field key
  value: any,       // Field value
  depth: number     // Current depth in object tree
) => any | undefined;
```

Return the sanitized value, or `undefined` to use default behavior.

## Best Practices

1. **Configure Early**: Call `configureSanitization()` before creating trace collectors
2. **Use Whitelist Mode for Maximum Security**: When dealing with sensitive data (PII, PHI, financial), use whitelist mode to ensure only explicitly allowed fields are logged
3. **Start Restrictive, Then Relax**: Begin with a minimal `allowedFields` list and add fields as needed during debugging
4. **Test Your Rules**: Verify sanitization works as expected with sample data
5. **Balance Privacy & Utility**: Don't over-sanitize; keep data useful for debugging
6. **Use Custom Sanitizers Sparingly**: Only for fields needing special handling
7. **Document Your Rules**: Keep a record of what fields are sensitive/allowed and why
8. **Review Regularly**: Periodically audit your `allowedFields` list to ensure it doesn't include newly sensitive data

## See Also

- [JAF Tracing Documentation](./tracing.md)
