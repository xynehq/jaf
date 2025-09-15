# Juspay Agent Framework (JAF) Tools System

## Table of Contents

1. [Overview](#overview)
2. [Tool Definition and Schema](#tool-definition-and-schema)
3. [Parameter Validation with Zod](#parameter-validation-with-zod)
4. [Tool Execution Lifecycle](#tool-execution-lifecycle)
5. [Error Handling Patterns](#error-handling-patterns)
6. [Tool Result Formatting](#tool-result-formatting)
7. [Security Considerations](#security-considerations)
8. [Best Practices for Tool Design](#best-practices-for-tool-design)
9. [Advanced Patterns](#advanced-patterns)
10. [HTTP Tool Builder (makeHttpTool)](#http-tool-builder-makehttptool)
11. [Tool Debugging and Observability](#tool-debugging-and-observability)
12. [Complete Examples](#complete-examples)

## Overview

The JAF tools system provides a robust, type-safe framework for creating AI agent tools that can execute arbitrary functions while maintaining security, observability, and error handling best practices. Tools in JAF are designed to be:

- **Type-safe**: Leveraging TypeScript and Zod for compile-time and runtime type safety
- **Secure**: Built-in validation, permission checking, and error handling
- **Observable**: Comprehensive tracing and logging capabilities
- **Composable**: Easy to combine with other tools and policies
- **Production-ready**: Standardized error handling and response formats

## Tool Definition and Schema

### Basic Tool Interface

Every tool in JAF implements the `Tool<A, Ctx>` interface:

```typescript
import { z } from 'zod';
import { Tool } from '@xynehq/jaf';

export type Tool<A, Ctx> = {
  readonly schema: {
    readonly name: string;
    readonly description: string;
    readonly parameters: z.ZodType<A>;
  };
  readonly execute: (args: A, context: Readonly<Ctx>) => Promise<string | ToolResult>;
};
```

### Simple Tool Example

```typescript
const greetingTool: Tool<{ name: string }, MyContext> = {
  schema: {
    name: "greet",
    description: "Generate a personalized greeting",
    parameters: z.object({
      name: z.string().describe("Name of the person to greet")
    }),
  },
  execute: async (args, context) => {
    return `Hello, ${args.name}! Nice to meet you.`;
  }
};
```

### Schema Best Practices

1. **Use descriptive names**: Tool names should be clear and follow a consistent naming convention
2. **Provide detailed descriptions**: Help the AI understand when and how to use the tool
3. **Use Zod's `describe()` method**: Provide parameter descriptions for better AI understanding
4. **Set sensible defaults**: Use Zod's `default()` for optional parameters

```typescript
const calculatorSchema = z.object({
  expression: z.string()
    .describe("Mathematical expression to evaluate (e.g., '2 + 2', '10 * 5')")
    .max(100, "Expression too long"),
  precision: z.number()
    .describe("Number of decimal places for the result")
    .min(0)
    .max(10)
    .default(2)
});
```

## Parameter Validation with Zod

JAF uses Zod for both compile-time type safety and runtime validation. The framework automatically validates tool arguments before execution.

### Advanced Validation Examples

```typescript
// Email validation
const emailSchema = z.object({
  to: z.string().email("Invalid email address"),
  subject: z.string().min(1, "Subject cannot be empty").max(200),
  body: z.string().max(10000, "Email body too long"),
  priority: z.enum(['low', 'normal', 'high']).default('normal')
});

// File path validation
const fileSchema = z.object({
  path: z.string()
    .regex(/^[a-zA-Z0-9_\-./]+$/, "Invalid characters in path")
    .refine(path => !path.includes('..'), "Path traversal not allowed"),
  mode: z.enum(['read', 'write', 'append']).default('read')
});

// Complex nested validation
const databaseQuerySchema = z.object({
  table: z.string().min(1),
  conditions: z.array(z.object({
    field: z.string(),
    operator: z.enum(['=', '!=', '>', '<', '>=', '<=', 'LIKE']),
    value: z.union([z.string(), z.number(), z.boolean()])
  })).optional(),
  limit: z.number().min(1).max(1000).default(100),
  offset: z.number().min(0).default(0)
});
```

### Custom Validation Functions

```typescript
const customValidationSchema = z.object({
  data: z.string().refine(
    (val) => {
      // Custom validation logic
      try {
        JSON.parse(val);
        return true;
      } catch {
        return false;
      }
    },
    { message: "Must be valid JSON" }
  )
});
```

## Tool Execution Lifecycle

The tool execution lifecycle in JAF follows these steps:

1. **Tool Discovery**: Agent finds tool by name in its tools array
2. **Parameter Validation**: Zod validates arguments against schema
3. **Permission Checking**: Optional permission validation
4. **Tool Execution**: The `execute` function is called
5. **Result Processing**: Response is converted to string format
6. **Tracing**: Execution events are logged for observability

### Execution Flow Diagram

```
[Agent] → [Tool Call] → [Validation] → [Permission Check] → [Execute] → [Result] → [Trace]
    ↓           ↓             ↓               ↓              ↓          ↓         ↓
[Find Tool] [Parse Args] [Zod Check]  [Context Check]  [Business Logic] [Format] [Log]
```

## Error Handling Patterns

JAF provides a comprehensive error handling system with standardized error types and helper functions.

### ToolResult System

Instead of throwing exceptions, tools should return `ToolResult` objects for better error handling:

```typescript
import { ToolResponse, ToolErrorCodes, ToolResult } from '@xynehq/jaf';

// Success response
return ToolResponse.success(data, metadata);

// Error response
return ToolResponse.error(
  ToolErrorCodes.VALIDATION_ERROR,
  "Invalid input provided",
  { details: "Additional error context" }
);

// Validation error
return ToolResponse.validationError(
  "Name cannot be empty",
  { providedName: args.name }
);

// Permission denied
return ToolResponse.permissionDenied(
  "Admin access required",
  ['admin']
);

// Not found
return ToolResponse.notFound(
  "User",
  args.userId
);
```

### withErrorHandling Wrapper

Use the `withErrorHandling` wrapper to automatically catch exceptions and convert them to standard error responses:

```typescript
import { withErrorHandling } from '@xynehq/jaf';

const safeTool: Tool<{ expression: string }, MyContext> = {
  schema: {
    name: "calculate",
    description: "Perform mathematical calculations",
    parameters: z.object({
      expression: z.string().describe("Math expression to evaluate")
    }),
  },
  execute: withErrorHandling('calculate', async (args, context) => {
    // This function is automatically wrapped with error handling
    const result = eval(args.expression); // Will be caught if it throws
    return ToolResponse.success(`${args.expression} = ${result}`);
  }),
};
```

### Manual Error Handling

For more control, handle errors manually:

```typescript
const manualErrorTool: Tool<{ data: string }, MyContext> = {
  schema: {
    name: "process_data",
    description: "Process data with manual error handling",
    parameters: z.object({
      data: z.string()
    }),
  },
  execute: async (args, context) => {
    try {
      // Validation
      if (!args.data || args.data.trim().length === 0) {
        return ToolResponse.validationError(
          "Data cannot be empty",
          { providedData: args.data }
        );
      }

      // Permission check
      if (!context.permissions.includes('data_processor')) {
        return ToolResponse.permissionDenied(
          "Data processing requires 'data_processor' permission",
          ['data_processor']
        );
      }

      // Business logic
      const result = await processData(args.data);
      
      return ToolResponse.success(result, {
        processingTime: Date.now() - startTime,
        dataSize: args.data.length
      });

    } catch (error) {
      if (error instanceof ValidationError) {
        return ToolResponse.validationError(error.message, error.details);
      }
      
      if (error instanceof PermissionError) {
        return ToolResponse.permissionDenied(error.message);
      }
      
      return ToolResponse.error(
        ToolErrorCodes.EXECUTION_FAILED,
        error instanceof Error ? error.message : 'Unknown error',
        { stack: error instanceof Error ? error.stack : undefined }
      );
    }
  }
};
```

## Tool Result Formatting

### ToolResult Structure

```typescript
interface ToolResult<T = any> {
  readonly status: 'success' | 'error' | 'validation_error' | 'permission_denied' | 'not_found';
  readonly data?: T;
  readonly error?: {
    readonly code: string;
    readonly message: string;
    readonly details?: any;
  };
  readonly metadata?: {
    readonly executionTimeMs?: number;
    readonly toolName?: string;
    readonly [key: string]: any;
  };
}
```

## HTTP Tool Builder (makeHttpTool)

JAF includes a generic HTTP tool factory that removes boilerplate and (optionally) handles authentication for you.

Key features:
- Define request shape with a small builder function.
- Optional `auth` to enable API Key/Bearer/OAuth2/OIDC injection and interactive flows.
- Works for both simple REST tools and authenticated API calls.

Basic (no auth):
```typescript
import { z } from 'zod';
import { makeHttpTool } from '@xynehq/jaf';

export const getStatus = makeHttpTool<{ url: string }, Ctx>({
  name: 'http_get_status',
  description: 'Fetch a URL and return its status/info',
  parameters: z.object({ url: z.string().url() }),
  request: (args) => ({ url: args.url, method: 'GET' }),
  onResponse: async (res) => JSON.stringify({
    ok: res.ok,
    status: res.status,
    headers: Object.fromEntries(res.headers.entries()),
    body: await res.text()
  })
});
```

Authenticated (OAuth2/OIDC/API key):
```typescript
import { z } from 'zod';
import { makeHttpTool } from '@xynehq/jaf';

export const getUserInfo = makeHttpTool<{ endpoint?: string }, Ctx>({
  name: 'get_user_info',
  description: 'Fetch the authenticated user info',
  parameters: z.object({ endpoint: z.string().url().optional() }),
  auth: {
    authScheme: {
      type: 'openidconnect',
      openIdConnectUrl: process.env.OIDC_DISCOVERY_URL!,
      scopes: ['openid', 'profile', 'email']
    },
    rawAuthCredential: {
      type: 'OPEN_ID_CONNECT',
      clientId: process.env.OIDC_CLIENT_ID!,
      clientSecret: process.env.OIDC_CLIENT_SECRET
    }
  },
  request: (args) => ({
    url: args.endpoint || process.env.PROTECTED_API_URL!,
    method: 'GET'
  }),
  onResponse: async (res) => JSON.stringify(await res.json())
});
```

Notes:
- When `auth` is provided, makeHttpTool will pause with a `tool_auth` interruption when credentials are needed, resume after `/auth/submit`, and inject the right headers/query for the scheme.
- See Authentication docs for server endpoints and flows: `auth/tool-auth.md`.

### Result Conversion

The framework automatically converts `ToolResult` objects to strings for LLM consumption:

```typescript
// ToolResult object
const result = ToolResponse.error(
  ToolErrorCodes.NOT_FOUND,
  "User not found",
  { userId: "123" }
);

// Converted to JSON string
{
  "error": "not_found",
  "code": "NOT_FOUND",
  "message": "User not found",
  "details": { "userId": "123" },
  "metadata": { "executionTimeMs": 45, "toolName": "find_user" }
}
```

## Security Considerations

### Input Validation

Always validate and sanitize inputs:

```typescript
const fileTool: Tool<{ path: string }, MyContext> = {
  schema: {
    name: "read_file",
    description: "Read a file from the filesystem",
    parameters: z.object({
      path: z.string()
        .regex(/^[a-zA-Z0-9_\-./]+$/, "Invalid characters in path")
        .refine(path => !path.includes('..'), "Path traversal not allowed")
        .refine(path => path.startsWith('/allowed/'), "Path must be in allowed directory")
    }),
  },
  execute: async (args, context) => {
    // Additional runtime validation
    const sanitizedPath = path.normalize(args.path);
    if (!sanitizedPath.startsWith('/allowed/')) {
      return ToolResponse.permissionDenied("Access denied to path outside allowed directory");
    }
    
    // Safe file reading logic
    return await readFileSecurely(sanitizedPath);
  }
};
```

### Permission-Based Access Control

Use the built-in permission system:

```typescript
import { requirePermissions } from '@xynehq/jaf';

const adminTool: Tool<{ action: string }, MyContext> = {
  schema: {
    name: "admin_action",
    description: "Perform administrative actions",
    parameters: z.object({
      action: z.enum(['delete_user', 'reset_password', 'view_logs'])
    }),
  },
  execute: async (args, context) => {
    // Check permissions
    const permissionCheck = requirePermissions(['admin'])(context);
    if (permissionCheck) {
      return permissionCheck; // Returns permission denied ToolResult
    }
    
    // Execute admin action
    return await performAdminAction(args.action);
  }
};
```

### Rate Limiting

Implement rate limiting for resource-intensive tools:

```typescript
import { createRateLimiter } from '@xynehq/jaf';

const rateLimiter = createRateLimiter(
  10, // max calls
  60000, // window in ms (1 minute)
  (input) => input.userId // key extractor
);

const expensiveTool: Tool<{ query: string }, MyContext> = {
  schema: {
    name: "expensive_operation",
    description: "Perform an expensive operation",
    parameters: z.object({
      query: z.string()
    }),
  },
  execute: async (args, context) => {
    // Check rate limit
    const rateLimitResult = await rateLimiter(context.userId);
    if (!rateLimitResult.isValid) {
      return ToolResponse.error(
        ToolErrorCodes.EXECUTION_FAILED,
        rateLimitResult.errorMessage
      );
    }
    
    // Perform expensive operation
    return await expensiveOperation(args.query);
  }
};
```

## Best Practices for Tool Design

### 1. Single Responsibility Principle

Each tool should have a single, well-defined responsibility:

```typescript
// Good: Single responsibility
const sendEmailTool = createEmailTool();
const validateEmailTool = createEmailValidationTool();

// Bad: Multiple responsibilities
const emailManagerTool = createEmailManagerTool(); // sends, validates, logs, etc.
```

### 2. Consistent Naming Conventions

Use consistent naming patterns:

```typescript
// Good: Consistent verb_noun pattern
const createUserTool = { name: "create_user", ... };
const deleteUserTool = { name: "delete_user", ... };
const updateUserTool = { name: "update_user", ... };

// Bad: Inconsistent naming
const createUserTool = { name: "create_user", ... };
const userDeletion = { name: "user_deletion", ... };
const modifyUser = { name: "modify_user", ... };
```

### 3. Comprehensive Documentation

Always provide detailed descriptions:

```typescript
const databaseQueryTool: Tool<QueryArgs, MyContext> = {
  schema: {
    name: "query_database",
    description: `Execute a SQL query against the application database. 
                 Supports SELECT statements only for security. 
                 Use this tool when you need to retrieve specific data 
                 that isn't available through other APIs.`,
    parameters: z.object({
      query: z.string()
        .describe("SQL SELECT statement (INSERT/UPDATE/DELETE not allowed)")
        .max(1000, "Query too long"),
      timeout: z.number()
        .describe("Query timeout in seconds")
        .min(1)
        .max(30)
        .default(10)
    }),
  },
  execute: async (args, context) => {
    // Implementation
  }
};
```

### 4. Graceful Error Handling

Always handle errors gracefully and provide helpful error messages:

```typescript
const apiCallTool: Tool<{ endpoint: string }, MyContext> = {
  schema: {
    name: "call_api",
    description: "Make an API call to an external service",
    parameters: z.object({
      endpoint: z.string().url("Must be a valid URL")
    }),
  },
  execute: async (args, context) => {
    try {
      const response = await fetch(args.endpoint, { timeout: 5000 });
      
      if (!response.ok) {
        return ToolResponse.error(
          ToolErrorCodes.EXTERNAL_SERVICE_ERROR,
          `API call failed with status ${response.status}`,
          { 
            status: response.status, 
            statusText: response.statusText,
            endpoint: args.endpoint
          }
        );
      }
      
      const data = await response.json();
      return ToolResponse.success(data, {
        responseTime: response.headers.get('x-response-time'),
        endpoint: args.endpoint
      });
      
    } catch (error) {
      if (error instanceof TypeError && error.message.includes('timeout')) {
        return ToolResponse.error(
          ToolErrorCodes.TIMEOUT,
          "API call timed out after 5 seconds",
          { endpoint: args.endpoint }
        );
      }
      
      return ToolResponse.error(
        ToolErrorCodes.EXTERNAL_SERVICE_ERROR,
        error instanceof Error ? error.message : 'Unknown error',
        { endpoint: args.endpoint }
      );
    }
  }
};
```

### 5. Resource Management

Always clean up resources properly:

```typescript
const fileProcessingTool: Tool<{ filePath: string }, MyContext> = {
  schema: {
    name: "process_file",
    description: "Process a large file",
    parameters: z.object({
      filePath: z.string()
    }),
  },
  execute: async (args, context) => {
    let fileHandle: any = null;
    let tempFile: string | null = null;
    
    try {
      fileHandle = await fs.open(args.filePath, 'r');
      tempFile = await createTempFile();
      
      // Process file
      const result = await processLargeFile(fileHandle, tempFile);
      
      return ToolResponse.success(result);
      
    } catch (error) {
      return ToolResponse.error(
        ToolErrorCodes.EXECUTION_FAILED,
        error instanceof Error ? error.message : 'Unknown error'
      );
    } finally {
      // Always clean up resources
      if (fileHandle) {
        await fileHandle.close().catch(console.error);
      }
      if (tempFile) {
        await fs.unlink(tempFile).catch(console.error);
      }
    }
  }
};
```

## Advanced Patterns

See also: [Agents as Tools](agents-as-tools.md) for composing agents by wrapping them as callable tools.

### 1. Tool Composition

Combine multiple tools for complex operations:

```typescript
const compositeEmailTool: Tool<{ recipient: string; message: string }, MyContext> = {
  schema: {
    name: "send_validated_email",
    description: "Validate and send an email",
    parameters: z.object({
      recipient: z.string().email(),
      message: z.string()
    }),
  },
  execute: async (args, context) => {
    // Validate email first
    const validationResult = await validateEmailTool.execute(
      { email: args.recipient }, 
      context
    );
    
    if (typeof validationResult !== 'string') {
      if (validationResult.status !== 'success') {
        return validationResult; // Return validation error
      }
    }
    
    // Send email
    return await sendEmailTool.execute(args, context);
  }
};
```

### 2. Agent Handoffs

Tools can trigger handoffs to specialized agents:

```typescript
import { handoffTool } from '@xynehq/jaf';

const complexAnalysisTool: Tool<{ data: any }, MyContext> = {
  schema: {
    name: "analyze_data",
    description: "Analyze complex data (may handoff to specialist)",
    parameters: z.object({
      data: z.any(),
      complexity: z.enum(['simple', 'complex']).default('simple')
    }),
  },
  execute: async (args, context) => {
    if (args.complexity === 'complex') {
      // Handoff to data analysis specialist
      return handoffTool.execute({
        agentName: "DataAnalysisSpecialist",
        reason: "Complex data analysis requires specialized expertise"
      }, context);
    }
    
    // Handle simple analysis locally
    return await performSimpleAnalysis(args.data);
  }
};
```

### 3. Async Operations with Progress Tracking

Handle long-running operations:

```typescript
const longRunningTool: Tool<{ jobId: string }, MyContext> = {
  schema: {
    name: "start_analysis",
    description: "Start a long-running analysis job",
    parameters: z.object({
      jobId: z.string()
    }),
  },
  execute: async (args, context) => {
    // Start async job
    const job = await startAsyncJob(args.jobId);
    
    // Return immediately with job status
    return ToolResponse.success({
      jobId: job.id,
      status: 'started',
      estimatedDuration: '5-10 minutes',
      checkStatusWith: 'check_job_status'
    }, {
      jobId: job.id,
      startTime: Date.now()
    });
  }
};

const jobStatusTool: Tool<{ jobId: string }, MyContext> = {
  schema: {
    name: "check_job_status",
    description: "Check the status of a running job",
    parameters: z.object({
      jobId: z.string()
    }),
  },
  execute: async (args, context) => {
    const job = await getJobStatus(args.jobId);
    
    if (!job) {
      return ToolResponse.notFound("Job", args.jobId);
    }
    
    return ToolResponse.success({
      jobId: job.id,
      status: job.status,
      progress: job.progress,
      ...(job.status === 'completed' && { result: job.result }),
      ...(job.status === 'failed' && { error: job.error })
    });
  }
};
```

### 4. Tool Chaining

Create tools that can chain operations:

```typescript
const workflowTool: Tool<{ steps: WorkflowStep[] }, MyContext> = {
  schema: {
    name: "execute_workflow",
    description: "Execute a series of operations in sequence",
    parameters: z.object({
      steps: z.array(z.object({
        tool: z.string(),
        args: z.record(z.any()),
        onError: z.enum(['stop', 'continue', 'retry']).default('stop')
      }))
    }),
  },
  execute: async (args, context) => {
    const results: any[] = [];
    
    for (const [index, step] of args.steps.entries()) {
      try {
        const tool = findTool(step.tool); // Find tool by name
        if (!tool) {
          return ToolResponse.error(
            ToolErrorCodes.NOT_FOUND,
            `Tool '${step.tool}' not found`,
            { step: index, toolName: step.tool }
          );
        }
        
        const result = await tool.execute(step.args, context);
        results.push({ step: index, result });
        
      } catch (error) {
        if (step.onError === 'stop') {
          return ToolResponse.error(
            ToolErrorCodes.EXECUTION_FAILED,
            `Workflow failed at step ${index}`,
            { step: index, error: error.message, completedSteps: results }
          );
        } else if (step.onError === 'continue') {
          results.push({ step: index, error: error.message });
        }
        // retry logic would go here
      }
    }
    
    return ToolResponse.success({
      completedSteps: results.length,
      totalSteps: args.steps.length,
      results
    });
  }
};
```

### 5. Memory Integration

Tools can integrate with the JAF memory system:

```typescript
const memoryAwareTool: Tool<{ query: string }, MyContext> = {
  schema: {
    name: "search_with_memory",
    description: "Search with conversation context awareness",
    parameters: z.object({
      query: z.string()
    }),
  },
  execute: async (args, context) => {
    // Access conversation memory
    const memoryProvider = getMemoryProvider(); // From context or DI
    const conversationResult = await memoryProvider.getConversation(context.conversationId);
    
    if (conversationResult.success && conversationResult.data) {
      // Use conversation history to enhance search
      const contextualQuery = enhanceQueryWithContext(
        args.query, 
        conversationResult.data.messages
      );
      
      const searchResult = await performContextualSearch(contextualQuery);
      
      return ToolResponse.success(searchResult, {
        originalQuery: args.query,
        enhancedQuery: contextualQuery,
        usedConversationContext: true
      });
    }
    
    // Fallback to basic search
    const basicResult = await performBasicSearch(args.query);
    return ToolResponse.success(basicResult, {
      usedConversationContext: false
    });
  }
};
```

## Tool Debugging and Observability

### 1. Tracing Integration

JAF automatically traces tool execution. You can access trace data:

```typescript
import { ConsoleTraceCollector, createCompositeTraceCollector, FileTraceCollector } from '@xynehq/jaf';

// Set up comprehensive tracing
const traceCollector = createCompositeTraceCollector(
  new ConsoleTraceCollector(),
  new FileTraceCollector('./traces.jsonl')
);

// Use in agent configuration
const config = {
  // ... other config
  onEvent: traceCollector.collect.bind(traceCollector)
};
```

### 2. Custom Logging in Tools

Add detailed logging within tools:

```typescript
const debuggableTool: Tool<{ input: string }, MyContext> = {
  schema: {
    name: "debuggable_operation",
    description: "An operation with comprehensive logging",
    parameters: z.object({
      input: z.string()
    }),
  },
  execute: async (args, context) => {
    const startTime = Date.now();
    const operationId = generateId();
    
    console.log(`[TOOL:${operationId}] Starting operation with input:`, args.input);
    console.log(`[TOOL:${operationId}] Context:`, { 
      userId: context.userId, 
      permissions: context.permissions 
    });
    
    try {
      // Step 1: Validation
      console.log(`[TOOL:${operationId}] Step 1: Validating input`);
      const validationResult = validateInput(args.input);
      console.log(`[TOOL:${operationId}] Validation result:`, validationResult);
      
      if (!validationResult.isValid) {
        console.log(`[TOOL:${operationId}] Validation failed:`, validationResult.error);
        return ToolResponse.validationError(validationResult.error);
      }
      
      // Step 2: Processing
      console.log(`[TOOL:${operationId}] Step 2: Processing data`);
      const processed = await processData(args.input);
      console.log(`[TOOL:${operationId}] Processing completed, size:`, processed.length);
      
      // Step 3: Result generation
      console.log(`[TOOL:${operationId}] Step 3: Generating result`);
      const result = generateResult(processed);
      
      const executionTime = Date.now() - startTime;
      console.log(`[TOOL:${operationId}] Operation completed in ${executionTime}ms`);
      
      return ToolResponse.success(result, {
        operationId,
        executionTimeMs: executionTime,
        inputSize: args.input.length,
        outputSize: result.length
      });
      
    } catch (error) {
      const executionTime = Date.now() - startTime;
      console.error(`[TOOL:${operationId}] Operation failed after ${executionTime}ms:`, error);
      
      return ToolResponse.error(
        ToolErrorCodes.EXECUTION_FAILED,
        error instanceof Error ? error.message : 'Unknown error',
        { 
          operationId, 
          executionTimeMs: executionTime,
          stack: error instanceof Error ? error.stack : undefined
        }
      );
    }
  }
};
```

### 3. Performance Monitoring

Monitor tool performance:

```typescript
const performanceMonitoringTool: Tool<{ operation: string }, MyContext> = {
  schema: {
    name: "monitored_operation",
    description: "Operation with performance monitoring",
    parameters: z.object({
      operation: z.string()
    }),
  },
  execute: withErrorHandling('monitored_operation', async (args, context) => {
    const metrics = {
      startTime: Date.now(),
      memoryBefore: process.memoryUsage(),
      cpuBefore: process.cpuUsage()
    };
    
    try {
      const result = await performOperation(args.operation);
      
      const endTime = Date.now();
      const memoryAfter = process.memoryUsage();
      const cpuAfter = process.cpuUsage(metrics.cpuBefore);
      
      const performanceMetrics = {
        executionTimeMs: endTime - metrics.startTime,
        memoryDelta: {
          rss: memoryAfter.rss - metrics.memoryBefore.rss,
          heapUsed: memoryAfter.heapUsed - metrics.memoryBefore.heapUsed,
        },
        cpuUsage: {
          user: cpuAfter.user,
          system: cpuAfter.system
        }
      };
      
      // Log performance metrics
      console.log('[PERFORMANCE]', {
        tool: 'monitored_operation',
        operation: args.operation,
        metrics: performanceMetrics
      });
      
      return ToolResponse.success(result, performanceMetrics);
      
    } catch (error) {
      throw error; // Let withErrorHandling handle it
    }
  })
};
```

### 4. Health Checks

Implement health check capabilities:

```typescript
const healthCheckTool: Tool<{}, MyContext> = {
  schema: {
    name: "system_health_check",
    description: "Check the health of system components",
    parameters: z.object({})
  },
  execute: async (args, context) => {
    const healthChecks = [];
    
    // Database health
    try {
      await checkDatabaseConnection();
      healthChecks.push({ component: 'database', status: 'healthy' });
    } catch (error) {
      healthChecks.push({ 
        component: 'database', 
        status: 'unhealthy', 
        error: error.message 
      });
    }
    
    // External API health
    try {
      await checkExternalAPI();
      healthChecks.push({ component: 'external_api', status: 'healthy' });
    } catch (error) {
      healthChecks.push({ 
        component: 'external_api', 
        status: 'unhealthy', 
        error: error.message 
      });
    }
    
    // Memory usage
    const memoryUsage = process.memoryUsage();
    const memoryThreshold = 1024 * 1024 * 1024; // 1GB
    healthChecks.push({
      component: 'memory',
      status: memoryUsage.heapUsed < memoryThreshold ? 'healthy' : 'warning',
      usage: memoryUsage
    });
    
    const overallHealth = healthChecks.every(check => check.status === 'healthy');
    
    return ToolResponse.success({
      overall: overallHealth ? 'healthy' : 'degraded',
      checks: healthChecks,
      timestamp: new Date().toISOString()
    });
  }
};
```

## Complete Examples

### 1. Production-Ready File Management Tool

```typescript
import { z } from 'zod';
import { Tool, ToolResponse, ToolErrorCodes, withErrorHandling, requirePermissions } from '@xynehq/jaf';
import * as fs from 'fs/promises';
import * as path from 'path';

interface FileContext {
  userId: string;
  permissions: string[];
  allowedPaths: string[];
}

const fileOperationSchema = z.object({
  path: z.string()
    .min(1, "Path cannot be empty")
    .max(500, "Path too long")
    .regex(/^[a-zA-Z0-9_\-./]+$/, "Invalid characters in path")
    .refine(p => !p.includes('..'), "Path traversal not allowed"),
  operation: z.enum(['read', 'write', 'delete', 'list']),
  content: z.string().optional(),
  encoding: z.enum(['utf8', 'base64']).default('utf8')
});

export const fileManagerTool: Tool<z.infer<typeof fileOperationSchema>, FileContext> = {
  schema: {
    name: "manage_file",
    description: `Secure file management operations with permission checking.
                 Supports read, write, delete, and list operations.
                 All paths are validated and restricted to allowed directories.`,
    parameters: fileOperationSchema
  },
  execute: withErrorHandling('manage_file', async (args, context) => {
    // Permission check
    const permissionCheck = requirePermissions(['file_access'])(context);
    if (permissionCheck) return permissionCheck;
    
    // Path validation
    const normalizedPath = path.normalize(args.path);
    const isAllowed = context.allowedPaths.some(allowed => 
      normalizedPath.startsWith(path.normalize(allowed))
    );
    
    if (!isAllowed) {
      return ToolResponse.permissionDenied(
        `Access denied to path: ${args.path}`,
        ['file_access']
      );
    }
    
    try {
      switch (args.operation) {
        case 'read':
          const content = await fs.readFile(normalizedPath, args.encoding);
          return ToolResponse.success({
            operation: 'read',
            path: args.path,
            content,
            size: content.length,
            encoding: args.encoding
          }, {
            filePath: normalizedPath,
            operation: args.operation
          });
          
        case 'write':
          if (!args.content) {
            return ToolResponse.validationError(
              "Content is required for write operation",
              { operation: args.operation }
            );
          }
          
          // Check write permissions
          const writePermissionCheck = requirePermissions(['file_write'])(context);
          if (writePermissionCheck) return writePermissionCheck;
          
          await fs.writeFile(normalizedPath, args.content, args.encoding);
          return ToolResponse.success({
            operation: 'write',
            path: args.path,
            bytesWritten: Buffer.byteLength(args.content, args.encoding)
          });
          
        case 'delete':
          // Check delete permissions
          const deletePermissionCheck = requirePermissions(['file_delete'])(context);
          if (deletePermissionCheck) return deletePermissionCheck;
          
          const stats = await fs.stat(normalizedPath);
          await fs.unlink(normalizedPath);
          return ToolResponse.success({
            operation: 'delete',
            path: args.path,
            deletedSize: stats.size
          });
          
        case 'list':
          const entries = await fs.readdir(normalizedPath, { withFileTypes: true });
          const fileList = entries.map(entry => ({
            name: entry.name,
            type: entry.isDirectory() ? 'directory' : 'file',
            path: path.join(args.path, entry.name)
          }));
          
          return ToolResponse.success({
            operation: 'list',
            path: args.path,
            entries: fileList,
            count: fileList.length
          });
          
        default:
          return ToolResponse.validationError(
            `Unsupported operation: ${args.operation}`,
            { supportedOperations: ['read', 'write', 'delete', 'list'] }
          );
      }
    } catch (error) {
      if (error.code === 'ENOENT') {
        return ToolResponse.notFound('File or directory', args.path);
      }
      
      if (error.code === 'EACCES') {
        return ToolResponse.permissionDenied(
          'Insufficient file system permissions',
          ['file_access']
        );
      }
      
      throw error; // Let withErrorHandling catch it
    }
  })
};
```

### 2. Advanced API Integration Tool

```typescript
import { z } from 'zod';
import { Tool, ToolResponse, ToolErrorCodes, withErrorHandling } from '@xynehq/jaf';

interface APIContext {
  userId: string;
  permissions: string[];
  apiKeys: Record<string, string>;
}

const apiRequestSchema = z.object({
  service: z.enum(['github', 'slack', 'openai']),
  endpoint: z.string().url(),
  method: z.enum(['GET', 'POST', 'PUT', 'DELETE']).default('GET'),
  headers: z.record(z.string()).optional(),
  body: z.any().optional(),
  timeout: z.number().min(1000).max(30000).default(5000)
});

export const apiIntegrationTool: Tool<z.infer<typeof apiRequestSchema>, APIContext> = {
  schema: {
    name: "api_request",
    description: `Make authenticated API requests to integrated services.
                 Supports GitHub, Slack, and OpenAI APIs with automatic
                 authentication and rate limiting.`,
    parameters: apiRequestSchema
  },
  execute: withErrorHandling('api_request', async (args, context) => {
    // Permission check
    const requiredPermission = `api_${args.service}`;
    if (!context.permissions.includes(requiredPermission)) {
      return ToolResponse.permissionDenied(
        `API access requires '${requiredPermission}' permission`,
        [requiredPermission]
      );
    }
    
    // Get API key
    const apiKey = context.apiKeys[args.service];
    if (!apiKey) {
      return ToolResponse.error(
        ToolErrorCodes.INSUFFICIENT_PERMISSIONS,
        `API key not configured for ${args.service}`,
        { service: args.service }
      );
    }
    
    // Prepare request
    const requestConfig = {
      method: args.method,
      headers: {
        'User-Agent': 'JAF-Agent/1.0',
        ...getServiceHeaders(args.service, apiKey),
        ...(args.headers || {})
      },
      timeout: args.timeout
    };
    
    if (args.body && ['POST', 'PUT'].includes(args.method)) {
      requestConfig.headers['Content-Type'] = 'application/json';
      requestConfig.body = JSON.stringify(args.body);
    }
    
    const startTime = Date.now();
    
    try {
      const response = await fetch(args.endpoint, requestConfig);
      const responseTime = Date.now() - startTime;
      
      // Handle rate limiting
      if (response.status === 429) {
        const retryAfter = response.headers.get('retry-after');
        return ToolResponse.error(
          ToolErrorCodes.EXTERNAL_SERVICE_ERROR,
          `Rate limited by ${args.service}`,
          { 
            retryAfter: retryAfter ? parseInt(retryAfter) : 60,
            service: args.service 
          }
        );
      }
      
      // Handle API errors
      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error');
        return ToolResponse.error(
          ToolErrorCodes.EXTERNAL_SERVICE_ERROR,
          `${args.service} API error: ${response.status} ${response.statusText}`,
          {
            status: response.status,
            statusText: response.statusText,
            error: errorText,
            service: args.service
          }
        );
      }
      
      // Parse response
      const contentType = response.headers.get('content-type') || '';
      let responseData;
      
      if (contentType.includes('application/json')) {
        responseData = await response.json();
      } else {
        responseData = await response.text();
      }
      
      return ToolResponse.success({
        service: args.service,
        endpoint: args.endpoint,
        method: args.method,
        status: response.status,
        data: responseData
      }, {
        responseTimeMs: responseTime,
        contentType,
        responseSize: JSON.stringify(responseData).length
      });
      
    } catch (error) {
      if (error.name === 'AbortError') {
        return ToolResponse.error(
          ToolErrorCodes.TIMEOUT,
          `Request to ${args.service} timed out after ${args.timeout}ms`,
          { service: args.service, timeout: args.timeout }
        );
      }
      
      throw error; // Let withErrorHandling catch it
    }
  })
};

function getServiceHeaders(service: string, apiKey: string): Record<string, string> {
  switch (service) {
    case 'github':
      return { 'Authorization': `token ${apiKey}` };
    case 'slack':
      return { 'Authorization': `Bearer ${apiKey}` };
    case 'openai':
      return { 'Authorization': `Bearer ${apiKey}` };
    default:
      return {};
  }
}
```

This comprehensive documentation covers all aspects of the JAF tools system, from basic concepts to advanced patterns and production-ready examples. The tools system is designed to be secure, observable, and maintainable while providing the flexibility needed for complex AI agent interactions.
