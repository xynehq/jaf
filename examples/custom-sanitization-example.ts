/**
 * Example: Custom Sanitization Configuration
 *
 * This example demonstrates how to configure custom sanitization
 * for your JAF application to protect sensitive data in logs and traces.
 */

import { configureSanitization, resetSanitizationConfig } from '../src/core/tracing.js';

// ============================================================================
// Example 1: Adding Custom Sensitive Fields
// ============================================================================

console.log('\n=== Example 1: Adding Custom Sensitive Fields ===\n');

// Configure additional sensitive fields specific to your domain
configureSanitization({
  sensitiveFields: [
    'customerId',      // E-commerce customer IDs
    'bankAccount',     // Banking information
    'ssn',            // Social Security Numbers
    'creditCard',     // Credit card numbers
    'merchantId',     // Merchant identifiers
    'accountNumber'   // Account numbers
  ]
});

console.log('✓ Custom sensitive fields configured');
console.log('  These fields will now be redacted: customerId, bankAccount, ssn, creditCard, merchantId, accountNumber\n');

// ============================================================================
// Example 2: Custom Sanitizer Function with Masking
// ============================================================================

console.log('\n=== Example 2: Custom Sanitizer Function (Email Masking) ===\n');

configureSanitization({
  customSanitizer: (key, value, depth) => {
    // Mask email addresses instead of fully redacting them
    if (key === 'email' && typeof value === 'string') {
      const [local, domain] = value.split('@');
      if (local && domain) {
        return `${local.substring(0, 2)}***@${domain}`;
      }
    }

    // Return undefined to use default sanitization behavior
    return undefined;
  }
});

console.log('✓ Custom email masking configured');
console.log('  Example: john.doe@example.com → jo***@example.com\n');

// ============================================================================
// Example 3: Advanced Custom Sanitizer (Multiple Rules)
// ============================================================================

console.log('\n=== Example 3: Advanced Custom Sanitizer (Multiple Rules) ===\n');

configureSanitization({
  sensitiveFields: ['customerId', 'accountNumber'],
  customSanitizer: (key, value, depth) => {
    // 1. Mask emails
    if (key === 'email' && typeof value === 'string') {
      const [local, domain] = value.split('@');
      if (local && domain) {
        return `${local.substring(0, 2)}***@${domain}`;
      }
    }

    // 2. Partially mask phone numbers
    if ((key === 'phone' || key === 'phoneNumber') && typeof value === 'string') {
      if (value.length >= 10) {
        return `***-***-${value.slice(-4)}`;
      }
    }

    // 3. Mask credit card numbers (show last 4 digits only)
    if (key.toLowerCase().includes('card') && typeof value === 'string') {
      const digitsOnly = value.replace(/\D/g, '');
      if (digitsOnly.length === 16) {
        return `****-****-****-${digitsOnly.slice(-4)}`;
      }
    }

    // 4. Hash user IDs for analytics while maintaining uniqueness
    if (key === 'userId' && typeof value === 'string') {
      // Simple hash for demo (use proper hashing in production)
      const hash = value.split('').reduce((acc, char) => {
        return ((acc << 5) - acc) + char.charCodeAt(0);
      }, 0);
      return `user_${Math.abs(hash)}`;
    }

    return undefined; // Use default behavior for other fields
  },
  maxDepth: 10, // Increase depth for deeply nested objects
  redactionPlaceholder: '[PROTECTED]' // Custom redaction text
});

console.log('✓ Advanced sanitization rules configured');
console.log('  Rules:');
console.log('  - Email masking: john.doe@example.com → jo***@example.com');
console.log('  - Phone masking: 555-123-4567 → ***-***-4567');
console.log('  - Credit card: 1234-5678-9012-3456 → ****-****-****-3456');
console.log('  - User ID hashing: user123 → user_<hash>');
console.log('  - Custom redaction placeholder: [PROTECTED]\n');

// ============================================================================
// Example 4: Domain-Specific Sanitization (E-commerce)
// ============================================================================

console.log('\n=== Example 4: E-commerce Domain Configuration ===\n');

function configureEcommerceSanitization() {
  configureSanitization({
    sensitiveFields: [
      // Customer data
      'customerId',
      'customerEmail',
      'billingAddress',
      'shippingAddress',

      // Payment data
      'cardNumber',
      'cvv',
      'expiryDate',
      'paymentToken',

      // Order data
      'orderToken',
      'transactionId'
    ],
    customSanitizer: (key, value, depth) => {
      // Mask prices to prevent competitive intelligence leaks (optional)
      if (key === 'price' && typeof value === 'number') {
        // Return rounded value or range
        return `~${Math.round(value / 10) * 10}`;
      }

      return undefined;
    }
  });
}

configureEcommerceSanitization();
console.log('✓ E-commerce sanitization configured');
console.log('  Protected fields: customer data, payment info, order tokens');
console.log('  Price masking enabled for competitive protection\n');

// ============================================================================
// Example 5: Financial Services Configuration
// ============================================================================

console.log('\n=== Example 5: Financial Services Configuration ===\n');

function configureFinancialServicesSanitization() {
  configureSanitization({
    sensitiveFields: [
      // Account identifiers
      'accountNumber',
      'iban',
      'routingNumber',
      'swiftCode',

      // Personal identifiers
      'ssn',
      'taxId',
      'nationalId',

      // Transaction data
      'transactionAmount',
      'balance',
      'creditLimit'
    ],
    customSanitizer: (key, value, depth) => {
      // Redact all monetary amounts completely
      if ((key.includes('amount') || key.includes('balance') || key.includes('limit'))
          && typeof value === 'number') {
        return '[AMOUNT_REDACTED]';
      }

      return undefined;
    },
    redactionPlaceholder: '[PII_REDACTED]'
  });
}

configureFinancialServicesSanitization();
console.log('✓ Financial services sanitization configured');
console.log('  Protected: account numbers, SSN, transaction amounts');
console.log('  All monetary values completely redacted\n');

// ============================================================================
// Example 6: Healthcare/HIPAA Compliance Configuration
// ============================================================================

console.log('\n=== Example 6: Healthcare/HIPAA Configuration ===\n');

function configureHIPAASanitization() {
  configureSanitization({
    sensitiveFields: [
      // Patient identifiers
      'patientId',
      'mrn', // Medical Record Number
      'dateOfBirth',
      'dob',

      // Contact info
      'email',
      'phone',
      'address',

      // Medical data
      'diagnosis',
      'medication',
      'prescription',
      'labResults',

      // Insurance
      'insuranceId',
      'memberId'
    ],
    customSanitizer: (key, value, depth) => {
      // Age ranges instead of exact DOB
      if ((key === 'dateOfBirth' || key === 'dob') && typeof value === 'string') {
        const birthYear = new Date(value).getFullYear();
        const age = new Date().getFullYear() - birthYear;
        return `Age Range: ${Math.floor(age / 10) * 10}-${Math.floor(age / 10) * 10 + 9}`;
      }

      return undefined;
    },
    redactionPlaceholder: '[PHI_PROTECTED]'
  });
}

configureHIPAASanitization();
console.log('✓ HIPAA-compliant sanitization configured');
console.log('  Protected: patient IDs, medical records, PHI');
console.log('  DOB converted to age ranges for privacy\n');

// ============================================================================
// Example 7: Reset Configuration
// ============================================================================

console.log('\n=== Example 7: Reset to Default Configuration ===\n');

resetSanitizationConfig();
console.log('✓ Sanitization configuration reset to defaults');
console.log('  Only default sensitive fields will be redacted\n');

// ============================================================================
// Integration Example
// ============================================================================

console.log('\n=== Integration with JAF Agent ===\n');
console.log('// In your agent initialization:');
console.log(`
import { configureSanitization } from 'jaf/core/tracing';
import { OpenTelemetryTraceCollector } from 'jaf/core/tracing';

// Configure sanitization BEFORE creating trace collectors
configureSanitization({
  sensitiveFields: ['customerId', 'merchantId'],
  customSanitizer: (key, value) => {
    if (key === 'email') {
      const [local, domain] = value.split('@');
      return \`\${local.substring(0, 2)}***@\${domain}\`;
    }
    return undefined;
  }
});

// Now create your trace collector - it will use the configured sanitization
const traceCollector = new OpenTelemetryTraceCollector();

// Your agent setup continues...
`);

console.log('\n✓ Examples complete!\n');
