/**
 * Session Memory Tool Example
 * 
 * Demonstrates how to use the session memory tool to store and recall
 * user preferences and context across multiple interactions.
 */

import { 
  storeMemoryTool, 
  recallMemoryTool, 
  listMemoryKeysTool,
  deleteMemoryTool,
  clearMemoryTool 
} from '../src/adk/tools/sessionMemoryTool';
import { Model } from '../src/adk/models';

// Currency conversion rates (simplified for demo)
const CONVERSION_RATES: Record<string, number> = {
  USD: 1.0,
  EUR: 0.92,
  GBP: 0.79,
  INR: 83.12,
  JPY: 149.50,
  AUD: 1.52,
  CAD: 1.36
};

// Custom tool for currency conversion that uses memory
const currencyConverterTool = {
  name: 'convertCurrency',
  description: 'Convert amount between currencies using stored preference',
  parameters: [
    {
      name: 'amount',
      type: 'number' as const,
      description: 'Amount to convert',
      required: true
    },
    {
      name: 'fromCurrency',
      type: 'string' as const,
      description: 'Source currency code (e.g., USD)',
      required: false,
      default: 'USD'
    },
    {
      name: 'toCurrency',
      type: 'string' as const,
      description: 'Target currency code (will use stored preference if not provided)',
      required: false
    }
  ],
  execute: async (params: any, context: any) => {
    const { amount, fromCurrency = 'USD' } = params;
    let { toCurrency } = params;
    
    // If no target currency specified, try to recall from memory
    if (!toCurrency) {
      // Use the recall tool to get preferred currency
      const recallTool = recallMemoryTool();
      const memoryResult = await recallTool.execute(
        { key: 'preferred_currency', defaultValue: 'USD' },
        context
      );
      
      if (memoryResult.success && memoryResult.data) {
        const data = memoryResult.data as any;
        toCurrency = data.value || 'USD';
        console.log(`📝 Using stored currency preference: ${toCurrency}`);
      } else {
        toCurrency = 'USD';
        console.log('📝 No currency preference found, using USD');
      }
    }
    
    // Perform conversion
    const fromRate = CONVERSION_RATES[fromCurrency] || 1;
    const toRate = CONVERSION_RATES[toCurrency] || 1;
    const convertedAmount = (amount / fromRate) * toRate;
    
    return {
      success: true,
      data: {
        amount,
        fromCurrency,
        toCurrency,
        convertedAmount: parseFloat(convertedAmount.toFixed(2)),
        rate: parseFloat((toRate / fromRate).toFixed(4)),
        message: `${amount} ${fromCurrency} = ${convertedAmount.toFixed(2)} ${toCurrency}`
      }
    };
  }
};

// Shopping cart tool that uses memory
const shoppingCartTool = {
  name: 'manageCart',
  description: 'Manage shopping cart items in memory',
  parameters: [
    {
      name: 'action',
      type: 'string' as const,
      description: 'Action to perform: add, remove, list, total',
      required: true
    },
    {
      name: 'item',
      type: 'object' as const,
      description: 'Item details for add/remove actions',
      required: false
    }
  ],
  execute: async (params: any, context: any) => {
    const { action, item } = params;
    
    // Recall cart from memory
    const recallTool = recallMemoryTool();
    const cartResult = await recallTool.execute(
      { key: 'shopping_cart', defaultValue: [] },
      context
    );
    
    let cart = (cartResult.data as any)?.value || [];
    
    switch (action) {
      case 'add':
        if (!item) {
          return { success: false, error: 'Item required for add action' };
        }
        cart.push({ ...item, id: Date.now() });
        
        // Store updated cart
        const storeTool = storeMemoryTool();
        await storeTool.execute(
          { key: 'shopping_cart', value: cart, overwrite: true },
          context
        );
        
        return {
          success: true,
          data: {
            action: 'added',
            item,
            cartSize: cart.length,
            message: `Added ${item.name} to cart`
          }
        };
        
      case 'remove':
        if (!item || !item.id) {
          return { success: false, error: 'Item ID required for remove action' };
        }
        cart = cart.filter((i: any) => i.id !== item.id);
        
        // Store updated cart
        const storeToolRemove = storeMemoryTool();
        await storeToolRemove.execute(
          { key: 'shopping_cart', value: cart, overwrite: true },
          context
        );
        
        return {
          success: true,
          data: {
            action: 'removed',
            itemId: item.id,
            cartSize: cart.length,
            message: `Removed item from cart`
          }
        };
        
      case 'list':
        return {
          success: true,
          data: {
            action: 'list',
            items: cart,
            cartSize: cart.length,
            message: cart.length > 0 
              ? `Cart contains ${cart.length} items`
              : 'Cart is empty'
          }
        };
        
      case 'total':
        // Calculate total in preferred currency
        const currencyResult = await recallTool.execute(
          { key: 'preferred_currency', defaultValue: 'USD' },
          context
        );
        const currency = (currencyResult.data as any)?.value || 'USD';
        
        const total = cart.reduce((sum: number, item: any) => {
          // Convert item price to preferred currency if needed
          if (item.currency && item.currency !== currency) {
            const fromRate = CONVERSION_RATES[item.currency] || 1;
            const toRate = CONVERSION_RATES[currency] || 1;
            return sum + (item.price / fromRate) * toRate;
          }
          return sum + (item.price || 0);
        }, 0);
        
        return {
          success: true,
          data: {
            action: 'total',
            total: parseFloat(total.toFixed(2)),
            currency,
            itemCount: cart.length,
            message: `Total: ${total.toFixed(2)} ${currency}`
          }
        };
        
      default:
        return { success: false, error: `Unknown action: ${action}` };
    }
  }
};

async function runExample() {
  console.log('🧠 Session Memory Tool Example\n');
  console.log('=' .repeat(50));
  
  // Create a mock agent config (no need for full agent creation for this demo)
  const agentConfig = {
    name: 'MemoryAgent',
    model: Model.CLAUDE_3_5_HAIKU_20241022,
    instruction: `You are a helpful assistant with memory capabilities.
    You can remember user preferences and use them in future interactions.
    You help with currency conversion and shopping using stored preferences.`,
    description: 'Agent that demonstrates session memory capabilities',
    tools: [
      storeMemoryTool(),
      recallMemoryTool(),
      listMemoryKeysTool(),
      deleteMemoryTool(),
      clearMemoryTool(),
      currencyConverterTool,
      shoppingCartTool
    ]
  };
  
  // Simulate a session
  const mockContext = {
    agent: agentConfig as any,
    session: {
      id: 'demo-session-001',
      appName: 'memory-demo',
      userId: 'user123',
      messages: [],
      artifacts: {},
      metadata: {
        created: new Date()
      }
    },
    message: {
      role: 'user' as const,
      parts: []
    },
    actions: {}
  };
  
  console.log('\n📝 Step 1: Store user preferences');
  console.log('-'.repeat(50));
  
  // Store currency preference
  const storeToolInstance = storeMemoryTool();
  const storeResult1 = await storeToolInstance.execute(
    { key: 'preferred_currency', value: 'INR' },
    mockContext
  );
  console.log('Stored currency preference:', (storeResult1.data as any).message);
  
  // Store user name
  const storeResult2 = await storeToolInstance.execute(
    { key: 'user_name', value: 'Alice' },
    mockContext
  );
  console.log('Stored user name:', (storeResult2.data as any).message);
  
  // Store location
  const storeResult3 = await storeToolInstance.execute(
    { key: 'user_location', value: { city: 'Mumbai', country: 'India' } },
    mockContext
  );
  console.log('Stored user location:', (storeResult3.data as any).message);
  
  console.log('\n📝 Step 2: List stored keys');
  console.log('-'.repeat(50));
  
  const listToolInstance = listMemoryKeysTool();
  const listResult = await listToolInstance.execute({}, mockContext);
  console.log('Keys in memory:', (listResult.data as any).keys);
  
  console.log('\n📝 Step 3: Use preferences in currency conversion');
  console.log('-'.repeat(50));
  
  // Convert without specifying target currency (will use stored preference)
  const conversionResult1 = await currencyConverterTool.execute(
    { amount: 100, fromCurrency: 'USD' },
    mockContext
  );
  console.log('Conversion result:', (conversionResult1.data as any).message);
  
  // Convert with explicit target currency
  const conversionResult2 = await currencyConverterTool.execute(
    { amount: 50, fromCurrency: 'EUR', toCurrency: 'JPY' },
    mockContext
  );
  console.log('Conversion result:', (conversionResult2.data as any).message);
  
  console.log('\n📝 Step 4: Shopping cart with memory');
  console.log('-'.repeat(50));
  
  // Add items to cart
  await shoppingCartTool.execute(
    { 
      action: 'add', 
      item: { name: 'Laptop', price: 999, currency: 'USD' }
    },
    mockContext
  );
  console.log('Added laptop to cart');
  
  await shoppingCartTool.execute(
    { 
      action: 'add', 
      item: { name: 'Mouse', price: 25, currency: 'USD' }
    },
    mockContext
  );
  console.log('Added mouse to cart');
  
  // List cart items
  const cartListResult = await shoppingCartTool.execute(
    { action: 'list' },
    mockContext
  );
  console.log('Cart items:', (cartListResult.data as any).items);
  
  // Get total in preferred currency
  const cartTotalResult = await shoppingCartTool.execute(
    { action: 'total' },
    mockContext
  );
  console.log('Cart total:', (cartTotalResult.data as any).message);
  
  console.log('\n📝 Step 5: Recall specific values');
  console.log('-'.repeat(50));
  
  const recallToolInstance = recallMemoryTool();
  
  // Recall user name
  const nameResult = await recallToolInstance.execute(
    { key: 'user_name' },
    mockContext
  );
  console.log('Recalled name:', (nameResult.data as any).value);
  
  // Recall location
  const locationResult = await recallToolInstance.execute(
    { key: 'user_location' },
    mockContext
  );
  console.log('Recalled location:', (locationResult.data as any).value);
  
  // Try to recall non-existent key with default
  const missingResult = await recallToolInstance.execute(
    { key: 'theme', defaultValue: 'light' },
    mockContext
  );
  console.log('Recalled theme (with default):', (missingResult.data as any).value);
  
  console.log('\n📝 Step 6: Delete a key');
  console.log('-'.repeat(50));
  
  const deleteToolInstance = deleteMemoryTool();
  const deleteResult = await deleteToolInstance.execute(
    { key: 'user_location' },
    mockContext
  );
  console.log('Delete result:', (deleteResult.data as any).message);
  
  // List keys after deletion
  const listResult2 = await listToolInstance.execute({}, mockContext);
  console.log('Keys after deletion:', (listResult2.data as any).keys);
  
  console.log('\n📝 Step 7: Clear all memory (with confirmation)');
  console.log('-'.repeat(50));
  
  const clearToolInstance = clearMemoryTool();
  
  // First attempt without confirmation
  const clearResult1 = await clearToolInstance.execute(
    { confirm: false },
    mockContext
  );
  console.log('Clear without confirmation:', (clearResult1.data as any).message);
  
  // Clear with confirmation
  const clearResult2 = await clearToolInstance.execute(
    { confirm: true },
    mockContext
  );
  console.log('Clear with confirmation:', (clearResult2.data as any).message);
  
  // List keys after clearing
  const listResult3 = await listToolInstance.execute({}, mockContext);
  console.log('Keys after clearing:', (listResult3.data as any).keys);
  
  console.log('\n' + '='.repeat(50));
  console.log('✅ Session Memory Tool Example Complete!');
  console.log('\nKey Features Demonstrated:');
  console.log('- Store and recall key-value pairs');
  console.log('- Use stored preferences in tool execution');
  console.log('- Complex data structures (objects, arrays)');
  console.log('- Multi-step workflows with persistent state');
  console.log('- Session isolation for different users');
}

// Run the example
if (require.main === module) {
  runExample().catch(console.error);
}

export { runExample };