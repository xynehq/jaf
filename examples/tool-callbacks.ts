/**
 * Example: Tool Callbacks (onBeforeExecution)
 *
 * This example demonstrates how to add callbacks directly on tools
 * to inject or modify parameters before execution.
 *
 * BENEFITS:
 * - Highly discoverable - callback is right next to the tool
 * - Tool-specific logic stays encapsulated with the tool
 * - Can maintain closure-based state per tool
 * - Type-safe access to exact parameter types
 */

import { createAgent } from '../src/adk/index.js';
import { z } from 'zod';

// ============================================================================
// Example 1: Basic Per-Tool Parameter Injection
// ============================================================================

console.log('\n=== Example 1: Basic Per-Tool Callback ===\n');

const searchTool = {
  schema: {
    name: 'search',
    description: 'Search for information',
    parameters: z.object({
      query: z.string(),
      page: z.number().optional(),
      apiKey: z.string().optional()
    })
  },
  execute: async (args: any) => {
    console.log('  🔍 Executing search with:', args);
    return `Found results for "${args.query}" (page ${args.page || 1})`;
  },

  // ✅ Callback defined directly on the tool!
  onBeforeExecution: async (params: any) => {
    console.log('  📍 searchTool.onBeforeExecution called');
    return {
      params: {
        ...params,
        apiKey: process.env.SEARCH_API_KEY || 'default-search-key',
        page: params.page || 1
      }
    };
  }
};

console.log('Tool definition:');
console.log(`
const searchTool = {
  schema: { name: 'search', ... },
  execute: async (args) => { ... },

  // ✅ Callback defined directly on the tool!
  onBeforeExecution: async (params) => {
    return {
      params: {
        ...params,
        apiKey: process.env.SEARCH_API_KEY,
        page: params.page || 1
      }
    };
  }
};
`);

// ============================================================================
// Example 2: Stateful Per-Tool Callback (Auto-increment)
// ============================================================================

console.log('\n=== Example 2: Stateful Callback with Closure ===\n');

// Use closure to maintain state for this specific tool
const paginatedSearchTool = {
  schema: {
    name: 'paginated_search',
    description: 'Search with automatic pagination',
    parameters: z.object({
      query: z.string(),
      page: z.number().optional()
    })
  },
  execute: async (args: any) => {
    console.log(`  📖 Executing page ${args.page} search for: "${args.query}"`);
    return `Results for "${args.query}" - Page ${args.page}`;
  },

  // ✅ Use IIFE to create closure-based state
  onBeforeExecution: (() => {
    let callCount = 0;
    return async (params: any) => {
      callCount++;
      console.log(`  📍 Call #${callCount} to paginated_search`);
      return {
        params: {
          ...params,
          page: callCount  // Auto-increment page number!
        }
      };
    };
  })()
};

console.log('Stateful tool with closure:');
console.log(`
const paginatedSearchTool = {
  schema: { ... },
  execute: async (args) => { ... },

  // ✅ Use IIFE to create closure-based state
  onBeforeExecution: (() => {
    let callCount = 0;
    return async (params) => {
      callCount++;
      return {
        params: {
          ...params,
          page: callCount  // Auto-increment!
        }
      };
    };
  })()
};
`);

// ============================================================================
// Example 3: Multiple Tools with Different Callbacks
// ============================================================================

console.log('\n=== Example 3: Multiple Tools with Different Behaviors ===\n');

const dbQueryTool = {
  schema: {
    name: 'query_database',
    description: 'Query the database',
    parameters: z.object({
      query: z.string(),
      tenantId: z.string().optional()
    })
  },
  execute: async (args: any, context: any) => {
    console.log('  💾 Executing DB query with:', args);
    return `Query executed for tenant: ${args.tenantId}`;
  },

  // Tool-specific callback: Inject tenant isolation
  onBeforeExecution: async (params: any, context: any) => {
    console.log('  📍 dbQueryTool.onBeforeExecution - enforcing tenant isolation');
    return {
      params: {
        ...params,
        tenantId: context.tenantId || 'default-tenant'
      }
    };
  }
};

const sendEmailTool = {
  schema: {
    name: 'send_email',
    description: 'Send an email',
    parameters: z.object({
      to: z.string(),
      subject: z.string(),
      from: z.string().optional()
    })
  },
  execute: async (args: any) => {
    console.log('  📧 Sending email from:', args.from);
    return `Email sent to ${args.to}`;
  },

  // Tool-specific callback: Inject default sender
  onBeforeExecution: async (params: any) => {
    console.log('  📍 sendEmailTool.onBeforeExecution - setting default sender');
    return {
      params: {
        ...params,
        from: params.from || 'noreply@example.com'
      }
    };
  }
};

console.log('Each tool has its own logic:');
console.log(`
// Database queries get tenant isolation
const dbQueryTool = {
  onBeforeExecution: async (params, context) => ({
    params: { ...params, tenantId: context.tenantId }
  })
};

// Emails get default sender
const sendEmailTool = {
  onBeforeExecution: async (params) => ({
    params: { ...params, from: 'noreply@example.com' }
  })
};
`);

// ============================================================================
// Example 4: Working Demo
// ============================================================================

console.log('\n=== Example 4: Working Demo ===\n');

const agent = createAgent({
  name: 'demo-agent',
  instructions: () => 'You help with searches and emails.',
  tools: [searchTool, paginatedSearchTool, dbQueryTool, sendEmailTool]
});

async function demonstratePerToolCallbacks() {
  console.log('\nDemonstrating per-tool callbacks:\n');

  // Simulate 3 calls to the paginated search tool
  console.log('--- Testing paginated_search (auto-increment) ---\n');
  for (let i = 1; i <= 3; i++) {
    const result = await paginatedSearchTool.onBeforeExecution!({
      query: 'artificial intelligence'
    }, {});

    await paginatedSearchTool.execute(result.params);
    console.log('');
  }

  // Test search tool with API key injection
  console.log('--- Testing search (API key injection) ---\n');
  const searchResult = await searchTool.onBeforeExecution!({
    query: 'test query'
  }, {});
  await searchTool.execute(searchResult.params);
  console.log('');

  // Test DB query with tenant context
  console.log('--- Testing query_database (tenant isolation) ---\n');
  const dbResult = await dbQueryTool.onBeforeExecution!(
    { query: 'SELECT * FROM users' },
    { tenantId: 'acme-corp' }
  );
  await dbQueryTool.execute(dbResult.params, { tenantId: 'acme-corp' });
  console.log('');

  // Test email with default sender
  console.log('--- Testing send_email (default sender) ---\n');
  const emailResult = await sendEmailTool.onBeforeExecution!({
    to: 'user@example.com',
    subject: 'Hello'
  }, {});
  await sendEmailTool.execute(emailResult.params);
}

demonstratePerToolCallbacks();

console.log(`

✓ Examples complete!

KEY BENEFITS OF PER-TOOL CALLBACKS:
-----------------------------------

1. DISCOVERABILITY
   - Callback is right next to the tool definition
   - Easy to see what modifications happen
   - No need to search through central config

2. ENCAPSULATION
   - Tool-specific logic stays with the tool
   - No need to check tool names in callback
   - Each tool is self-contained

3. STATE MANAGEMENT
   - Can use closures (IIFE pattern) for per-tool state
   - State is isolated to each tool
   - Clean and readable

4. TYPE SAFETY
   - Tool callback has access to exact parameter types
   - No need for generic callbacks

USAGE IN REAL AGENTS:
---------------------

const agent = createAgent({
  name: 'my-agent',
  tools: [
    searchTool,          // Injects API key
    paginatedSearchTool, // Auto-increments page
    dbQueryTool,         // Enforces tenant isolation
    sendEmailTool        // Sets default sender
  ]
});

const result = await run(initialState, {
  agentRegistry,
  modelProvider
});

Each tool handles its own parameter injection automatically!
`);
