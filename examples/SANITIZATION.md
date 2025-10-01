# Custom Sanitization Guide

JAF provides powerful data sanitization capabilities to protect sensitive information in logs and traces. This guide shows you how to configure custom sanitization rules for your specific use case.

## Quick Start

```typescript
import { configureSanitization } from 'jaf';

// Add custom sensitive fields
configureSanitization({
  sensitiveFields: ['customerId', 'merchantId', 'accountNumber']
});
```

## Features

- **Default Protection**: Automatically redacts common sensitive fields (passwords, tokens, API keys, etc.)
- **Custom Fields**: Add your own sensitive field patterns
- **Custom Sanitizers**: Write custom logic for field-level sanitization
- **Flexible Configuration**: Configure redaction placeholders, max depth, and more

## Configuration Options

### 1. Adding Custom Sensitive Fields

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

### 2. Custom Sanitizer Function

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

### 3. Custom Redaction Placeholder

```typescript
configureSanitization({
  redactionPlaceholder: '[PII_PROTECTED]'
});
```

### 4. Maximum Depth

```typescript
configureSanitization({
  maxDepth: 10  // Default is 5
});
```

## Complete Example

```typescript
import { configureSanitization, OpenTelemetryTraceCollector } from 'jaf';

// Configure sanitization BEFORE creating trace collectors
configureSanitization({
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

## Domain-Specific Examples

### E-commerce

```typescript
configureSanitization({
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

### Financial Services

```typescript
configureSanitization({
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

### Healthcare (HIPAA)

```typescript
configureSanitization({
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

## Default Sensitive Fields

JAF automatically redacts these fields by default:

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

## API Reference

### `configureSanitization(config: SanitizationConfig)`

Configure global sanitization settings for all trace collectors.

**Parameters:**
- `config.sensitiveFields?: string[]` - Additional sensitive field patterns
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
2. **Test Your Rules**: Verify sanitization works as expected with sample data
3. **Balance Privacy & Utility**: Don't over-sanitize; keep data useful for debugging
4. **Use Custom Sanitizers Sparingly**: Only for fields needing special handling
5. **Document Your Rules**: Keep a record of what fields are sensitive and why

## See Also

- [custom-sanitization-example.ts](./custom-sanitization-example.ts) - Complete examples
- [JAF Tracing Documentation](../docs/tracing.md)
