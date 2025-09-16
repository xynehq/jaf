# JAF MCP Elicitation Demo

This demo showcases the **MCP (Model Context Protocol) elicitation** feature in JAF, allowing agents to request structured information from users during tool execution using JSON schemas.

## 🎯 What is MCP Elicitation?

MCP elicitation enables agents to:
- **Interrupt conversations** to request structured user input
- **Generate forms** automatically from JSON schemas
- **Validate responses** against schema constraints
- **Continue execution** with collected data
- **Handle user choices** (accept, decline, cancel)

**Key Benefits:**
- ✅ Professional forms instead of chat back-and-forth
- ✅ Type-safe data collection with validation
- ✅ Industry-standard MCP compliance
- ✅ Seamless conversation flow

---

## 📁 Demo Files Overview

This demo contains **3 different files** for **3 different purposes**:

### 1. `elicitation-server.ts` - **The Server** 🏗️
**Purpose**: JAF server with 5 elicitation-enabled tools
**What it does**: Backend server that agents can call to trigger elicitation

**Contains 5 Demo Tools:**
- `getUserInfo` - Collects contact information (name, email, phone)
- `getPreferences` - Choice selection for user preferences
- `getFeedback` - Text input with length validation
- `confirmAction` - Yes/no confirmation dialogs
- `getQuantity` - Number input with min/max constraints

### 2. `interactive-client.ts` - **The Interactive Demo** 🖥️
**Purpose**: Interactive client for manual elicitation testing
**What it does**: Allows real users to interact with elicitation forms manually

**Features:**
- JAF-compliant recursive conversation pattern
- Real user input collection via command line
- Schema-based form generation and validation
- Proper interruption handling with `for (;;)` loops
- Support for all elicitation types (text, choice, number, confirmation)

### 3. `unit-tests.ts` - **Unit Tests** 🧪
**Purpose**: Tests core elicitation functionality
**What it does**: Validates schemas, validation, and provider behavior

**Tests:**
- Email format validation
- Choice enum validation
- Required field validation
- Provider request/response handling

---

## 🚀 Quick Start (Recommended)

### **Complete Integration Test**
Run all components in sequence:

```bash
cd examples/elicitation-demo

# 1. Test core functionality (30 seconds)
pnpm run test

# 2. Start server (keep running)
pnpm run dev &

# 3. Wait for server startup, then run interactive demo
sleep 3 && pnpm run demo

# 4. Clean up
pkill -f elicitation-server.ts
```

### **Interactive Demo**
For presentations or manual testing:

```bash
# Terminal 1: Start server
pnpm run dev

# Terminal 2: Run interactive client demo
pnpm run demo
```

---

## 🛠️ Available Scripts

| Command | Description |
|---------|-------------|
| `pnpm run dev` | Start the elicitation server |
| `pnpm run server` | Start the elicitation server (alias) |
| `pnpm run demo` | Run the interactive client demo |
| `pnpm run client` | Run the interactive client demo (alias) |
| `pnpm run test` | Run unit tests |

---

## 🧪 Testing Options

### **Option 1: Unit Tests Only**
Test core functionality without server:
```bash
pnpm run test
```
**Output:**
```
🧪 Testing elicitation validation...
✅ Contact info validation: PASS
✅ Invalid email validation: PASS
✅ Choice validation: PASS
🎉 All tests passed!
```

### **Option 2: Interactive Demo**
Server + interactive client where you manually respond to elicitation requests:
```bash
# Terminal 1
npx tsx basic-elicitation.ts

# Terminal 2
npx tsx client-example.ts
```

**Interactive Flow:**
1. **Start conversation** - Type commands like "Collect my contact information"
2. **Handle elicitation requests** - Choose to fill forms, decline, or cancel
3. **Fill forms manually** - Provide real input with validation
4. **See real responses** - Get actual assistant responses

**Sample Commands:**
- `Collect my contact information`
- `Get my programming preferences`
- `Ask for feedback on the interface`
- `Confirm account deletion`
- `Ask how many items I need`
- `quit` (to exit)

**Sample Interactive Session:**
```
🎯 Interactive Elicitation Demo
===============================
📡 Connected to: http://localhost:3000
💬 Conversation ID: demo-1234567890

💭 Your message: Collect my contact information

⏳ Processing...

🚨 ELICITATION REQUEST
======================
📝 We need your contact information: contact information collection

📋 Form Fields:
================

🔸 Full Name (REQUIRED)
   Description: Your full name
   Type: Text
   Min length: 1

🔸 Email Address (REQUIRED)
   Description: Your email address
   Type: Email address

🔸 Phone Number (optional)
   Description: Your phone number (optional)
   Type: Text

What would you like to do?
1. Fill out the form
2. Decline this request
3. Cancel the operation

Enter your choice (1-3): 1

📝 Please fill out the form:

Full Name: John Doe
Email Address: john@example.com
Phone Number (or press Enter to skip): +1-555-123-4567

✅ Form submitted!
Data: {
  "name": "John Doe",
  "email": "john@example.com",
  "phone": "+1-555-123-4567"
}
📤 Response status: SUCCESS

🔄 Continuing conversation with your responses...

🤖 Assistant Response:
======================
Successfully collected user information:
- Name: John Doe
- Email: john@example.com
- Phone: +1-555-123-4567

==================================================

💭 Your message: quit

👋 Goodbye!
```

### **Option 3: Manual API Testing**
Use the provided test script:
```bash
# Start server first
npx tsx basic-elicitation.ts

# In another terminal
./test-workflow.sh
```

---

## 🛠️ Environment Setup

### **Prerequisites**
1. **LiteLLM Server**: Running on port 4000 (or configured endpoint)
2. **Environment Variables**: Copy `.env.example` to `.env` and configure:

```bash
# .env
LITELLM_URL=http://localhost:4000
LITELLM_API_KEY=YOUR_API_KEY
LITELLM_MODEL=gpt-3.5-turbo

HOST=127.0.0.1
PORT=3000
```

### **Using npm Scripts**
```bash
# Start server with pnpm
pnpm run dev

# Or with npm
npm run dev
```

---

## 📡 API Reference

### **Server Endpoints**
When `basic-elicitation.ts` is running:

**Chat Endpoints:**
- `POST /chat` - Send messages to agents
- `GET /agents` - List available agents

**Elicitation Endpoints:**
- `GET /elicitation/pending` - View pending requests
- `POST /elicitation/respond` - Submit user responses

**Utility Endpoints:**
- `GET /health` - Server health check
- `GET /memory/health` - Memory provider status

### **Manual Testing Example**

**1. Trigger Elicitation:**
```bash
curl -X POST http://localhost:3000/chat \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [{"role": "user", "content": "Collect my contact information"}],
    "agentName": "Elicitation Demo Agent",
    "conversationId": "test-conv"
  }'
```

**2. Check Response for Interruption:**
```json
{
  "data": {
    "outcome": {
      "status": "interrupted",
      "interruptions": [{
        "type": "elicitation",
        "request": {
          "id": "req_123",
          "message": "Please provide your contact information",
          "requestedSchema": { /* schema details */ }
        }
      }]
    }
  }
}
```

**3. Submit User Response:**
```bash
curl -X POST http://localhost:3000/elicitation/respond \
  -H "Content-Type: application/json" \
  -d '{
    "requestId": "req_123",
    "action": "accept",
    "content": {
      "name": "John Doe",
      "email": "john@example.com",
      "phone": "+1234567890"
    }
  }'
```

**4. Continue Conversation:**
```bash
curl -X POST http://localhost:3000/chat \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [],
    "agentName": "Elicitation Demo Agent",
    "conversationId": "test-conv",
    "elicitationResponses": [{
      "type": "elicitation_response",
      "requestId": "req_123",
      "action": "accept",
      "content": {
        "name": "John Doe",
        "email": "john@example.com",
        "phone": "+1234567890"
      }
    }]
  }'
```

---

## 💻 Implementation Guide

### **Creating Elicitation Tools**

```typescript
import { Elicit, ElicitationInterruptionError } from '@xynehq/jaf';

const myTool: Tool = {
  schema: {
    name: 'collectUserData',
    description: 'Collect user information',
    parameters: z.object({
      reason: z.string().optional()
    })
  },
  execute: async ({ reason }) => {
    try {
      // Use convenience functions
      const contact = await Elicit.contactInfo("We need your details");
      const quantity = await Elicit.number("How many items?", { min: 1, max: 100 });
      const confirmed = await Elicit.confirm("Proceed with order?");

      return `Order for ${contact.name}: ${quantity} items, confirmed: ${confirmed}`;

    } catch (error) {
      // CRITICAL: Let elicitation interruptions propagate
      if (error instanceof ElicitationInterruptionError) {
        throw error;
      }
      return `Error: ${error.message}`;
    }
  }
};
```

### **Available Convenience Functions**

```typescript
// Simple text input with validation
const feedback = await Elicit.text("Your feedback:", {
  minLength: 10,
  maxLength: 500
});

// Yes/no confirmation
const confirmed = await Elicit.confirm("Delete account?");

// Multiple choice selection
const level = await Elicit.choice("Experience level:",
  ['beginner', 'intermediate', 'advanced']
);

// Contact information form
const contact = await Elicit.contactInfo("Registration required");

// Number input with constraints
const quantity = await Elicit.number("Quantity:", {
  minimum: 1,
  maximum: 100,
  integer: true
});

// Custom schema
const result = await elicit("Custom prompt:", {
  type: 'object',
  properties: {
    customField: {
      type: 'string',
      title: 'Custom Field',
      pattern: '^[A-Z]+$'
    }
  },
  required: ['customField']
});
```

### **Schema Types Supported**

**String Input:**
```json
{
  "type": "string",
  "title": "Display Name",
  "description": "Help text",
  "minLength": 3,
  "maxLength": 50,
  "pattern": "^[A-Za-z\\s]+$",
  "format": "email"
}
```

**Number Input:**
```json
{
  "type": "number",
  "title": "Quantity",
  "minimum": 1,
  "maximum": 100,
  "integer": true,
  "default": 10
}
```

**Boolean Input:**
```json
{
  "type": "boolean",
  "title": "Confirmation",
  "description": "Check to confirm",
  "default": false
}
```

**Choice Selection:**
```json
{
  "type": "string",
  "enum": ["option1", "option2", "option3"],
  "enumNames": ["Option 1", "Option 2", "Option 3"]
}
```

---

## 🔧 Integration with Existing JAF Apps

### **1. Add Elicitation Provider**
```typescript
import { ServerElicitationProvider } from '@xynehq/jaf';

const elicitationProvider = new ServerElicitationProvider();

const server = await runServer(
  [myAgent],
  {
    modelProvider,
    elicitationProvider  // Add this
  },
  {
    port,
    host,
    defaultMemoryProvider,
    elicitationProvider, // And this
  }
);
```

### **2. Update Your Tools**
```typescript
// Before: basic tool
const myTool = {
  execute: async (args) => {
    return "Static response";
  }
};

// After: elicitation-enabled tool
const myTool = {
  execute: async (args) => {
    try {
      const userInput = await Elicit.text("What do you need?");
      return `You requested: ${userInput}`;
    } catch (error) {
      if (error instanceof ElicitationInterruptionError) throw error;
      return `Error: ${error.message}`;
    }
  }
};
```

### **3. Handle in Your Client**
```typescript
// Check for elicitation interruptions
const response = await fetch('/chat', { /* ... */ });
const data = await response.json();

if (data.outcome.status === 'interrupted') {
  const elicitationRequests = data.outcome.interruptions
    .filter(i => i.type === 'elicitation');

  for (const request of elicitationRequests) {
    // Show form based on request.requestedSchema
    const userInput = await showElicitationForm(request);

    // Submit response
    await fetch('/elicitation/respond', {
      method: 'POST',
      body: JSON.stringify({
        requestId: request.id,
        action: 'accept',
        content: userInput
      })
    });
  }

  // Continue conversation
  await fetch('/chat', {
    method: 'POST',
    body: JSON.stringify({
      messages: [],
      agentName,
      conversationId,
      elicitationResponses: [/* responses */]
    })
  });
}
```

---

## 🛡️ Best Practices

### **Security**
- ✅ **Never request sensitive data** (passwords, SSNs, etc.) via elicitation
- ✅ **Validate all user input** against schemas
- ✅ **Implement rate limiting** on elicitation requests
- ✅ **Clear indication** of which agent is requesting information
- ✅ **Always allow users to decline** any request

### **User Experience**
- ✅ **Provide clear context** for why information is needed
- ✅ **Use appropriate input types** (email format for emails, etc.)
- ✅ **Set reasonable validation constraints** (length limits, etc.)
- ✅ **Handle cancellation gracefully** with helpful messages
- ✅ **Progress indicators** for multi-step elicitation

### **Error Handling**
```typescript
try {
  const result = await Elicit.contactInfo("Registration required");
  return processRegistration(result);
} catch (error) {
  if (error instanceof ElicitationInterruptionError) {
    throw error; // Let framework handle interruption
  }

  if (error.message.includes('declined')) {
    return "Registration cancelled. You can try again later.";
  }

  if (error.message.includes('validation')) {
    return "Invalid information provided. Please check your input.";
  }

  return `Registration failed: ${error.message}`;
}
```

---

## 🆚 Comparison with Other Frameworks

### **vs OpenAI Agents SDK**
- ✅ **JAF**: Full data collection with rich forms
- ❌ **OpenAI**: Only binary approval/rejection

### **vs CrewAI**
- ✅ **JAF**: Natural async function calls
- ❌ **CrewAI**: Webhook setup + task configuration

### **vs Custom Solutions**
- ✅ **JAF**: Industry-standard MCP compliance
- ❌ **Custom**: Proprietary, non-interoperable

---

## 🚀 Next Steps

After running this demo:

1. **Understand the workflow** by running `client-example.ts`
2. **Test with your own schemas** by modifying the tools
3. **Integrate into your application** using the implementation guide
4. **Build client UI components** for elicitation forms
5. **Deploy to production** with appropriate security measures

---

## 🐛 Troubleshooting

**Common Issues:**

**"elicit() can only be called from within a tool execution context"**
- ✅ Ensure `elicitationProvider` is configured in server
- ✅ Check that tools don't catch `ElicitationInterruptionError`

**"Elicitation provider is not configured"**
- ✅ Add `elicitationProvider` to both run config and server options

**Server hangs on elicitation requests**
- ✅ Ensure you're not awaiting elicitation in older implementation
- ✅ Check that interruption errors are being thrown, not caught

**Client not receiving interruptions**
- ✅ Check response for `status: "interrupted"`
- ✅ Verify `interruptions` array contains elicitation requests

---

## 📚 Additional Resources

- **JAF Documentation**: Core framework concepts
- **MCP Specification**: Industry standard protocol
- **Schema Validation**: JSON Schema reference
- **TypeScript Integration**: Type-safe implementation patterns

**Questions?** Check the implementation in the source files or run the demos to see working examples!