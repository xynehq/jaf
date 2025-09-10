/**
 * Session Memory Tool Example
 * 
 * Demonstrates how to use the session memory tool to store and recall
 * user preferences and context across multiple interactions.
 */

import { z } from 'zod';
import { Tool } from '../src/core/types';
import { 
  storeMemoryTool, 
  recallMemoryTool, 
  listMemoryKeysTool,
  deleteMemoryTool,
  clearMemoryTool,
  SessionMemoryContext
} from '../src/tools/sessionMemoryTool';

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
const currencyConverterTool: Tool<
  { amount: number; fromCurrency?: string; toCurrency?: string },
  SessionMemoryContext
> = {
  schema: {
    name: 'convertCurrency',
    description: 'Convert amount between currencies using stored preference',
    parameters: z.object({
      amount: z.number().describe('Amount to convert'),
      fromCurrency: z.string().optional().default('USD').describe('Source currency code (e.g., USD)'),
      toCurrency: z.string().optional().describe('Target currency code (will use stored preference if not provided)')
    }) as z.ZodType<{ amount: number; fromCurrency?: string; toCurrency?: string }>
  },
  needsApproval: false,
  execute: async ({ amount, fromCurrency = 'USD', toCurrency }, context) => {
    // If no target currency specified, try to recall from memory
    if (!toCurrency) {
      const memoryResult = await recallMemoryTool.execute(
        { key: 'preferred_currency', defaultValue: 'USD' },
        context
      );
      
      const data = JSON.parse(memoryResult as string);
      toCurrency = data.value || 'USD';
      console.log(`📝 Using stored currency preference: ${toCurrency}`);
    }
    
    // Perform conversion
    const fromRate = CONVERSION_RATES[fromCurrency] || 1;
    const toRate = CONVERSION_RATES[toCurrency] || 1;
    const convertedAmount = (amount / fromRate) * toRate;
    
    return JSON.stringify({
      success: true,
      amount,
      fromCurrency,
      toCurrency,
      convertedAmount: parseFloat(convertedAmount.toFixed(2)),
      rate: parseFloat((toRate / fromRate).toFixed(4)),
      message: `${amount} ${fromCurrency} = ${convertedAmount.toFixed(2)} ${toCurrency}`
    });
  }
};

// Shopping cart tool that uses memory
const shoppingCartTool: Tool<
  { action: string; item?: any },
  SessionMemoryContext
> = {
  schema: {
    name: 'manageCart',
    description: 'Manage shopping cart items in memory',
    parameters: z.object({
      action: z.string().describe('Action to perform: add, remove, list, total'),
      item: z.any().optional().describe('Item details for add/remove actions')
    }) as z.ZodType<{ action: string; item?: any }>
  },
  needsApproval: false,
  execute: async ({ action, item }, context) => {
    // Recall cart from memory
    const cartResult = await recallMemoryTool.execute(
      { key: 'shopping_cart', defaultValue: [] },
      context
    );
    
    let cart = JSON.parse(cartResult as string).value || [];
    
    switch (action) {
      case 'add':
        if (!item) {
          return JSON.stringify({ success: false, error: 'Item required for add action' });
        }
        cart.push({ ...item, id: Date.now() });
        
        // Store updated cart
        await storeMemoryTool.execute(
          { key: 'shopping_cart', value: cart, overwrite: true },
          context
        );
        
        return JSON.stringify({
          success: true,
          action: 'added',
          item,
          cartSize: cart.length,
          message: `Added ${item.name} to cart`
        });
        
      case 'remove':
        if (!item || !item.id) {
          return JSON.stringify({ success: false, error: 'Item ID required for remove action' });
        }
        cart = cart.filter((i: any) => i.id !== item.id);
        
        // Store updated cart
        await storeMemoryTool.execute(
          { key: 'shopping_cart', value: cart, overwrite: true },
          context
        );
        
        return JSON.stringify({
          success: true,
          action: 'removed',
          itemId: item.id,
          cartSize: cart.length,
          message: `Removed item from cart`
        });
        
      case 'list':
        return JSON.stringify({
          success: true,
          action: 'list',
          items: cart,
          cartSize: cart.length,
          message: cart.length > 0 
            ? `Cart contains ${cart.length} items`
            : 'Cart is empty'
        });
        
      case 'total':
        // Calculate total in preferred currency
        const currencyResult = await recallMemoryTool.execute(
          { key: 'preferred_currency', defaultValue: 'USD' },
          context
        );
        const currency = JSON.parse(currencyResult as string).value || 'USD';
        
        const total = cart.reduce((sum: number, item: any) => {
          // Convert item price to preferred currency if needed
          if (item.currency && item.currency !== currency) {
            const fromRate = CONVERSION_RATES[item.currency] || 1;
            const toRate = CONVERSION_RATES[currency] || 1;
            return sum + (item.price / fromRate) * toRate;
          }
          return sum + (item.price || 0);
        }, 0);
        
        return JSON.stringify({
          success: true,
          action: 'total',
          total: parseFloat(total.toFixed(2)),
          currency,
          itemCount: cart.length,
          message: `Total: ${total.toFixed(2)} ${currency}`
        });
        
      default:
        return JSON.stringify({ success: false, error: `Unknown action: ${action}` });
    }
  }
};

async function runExample() {
  console.log('🧠 Session Memory Tool Example\n');
  console.log('=' .repeat(50));
  
  // Simulate a session context
  const context: SessionMemoryContext = {
    sessionId: 'demo-session-001',
    userId: 'user123'
  };
  
  console.log('\n📝 Step 1: Store user preferences');
  console.log('-'.repeat(50));
  
  // Store currency preference
  let result = await storeMemoryTool.execute(
    { key: 'preferred_currency', value: 'INR' },
    context
  );
  console.log('Stored currency preference:', JSON.parse(result as string).message);
  
  // Store user name
  result = await storeMemoryTool.execute(
    { key: 'user_name', value: 'Alice' },
    context
  );
  console.log('Stored user name:', JSON.parse(result as string).message);
  
  // Store location
  result = await storeMemoryTool.execute(
    { key: 'user_location', value: { city: 'Mumbai', country: 'India' } },
    context
  );
  console.log('Stored user location:', JSON.parse(result as string).message);
  
  console.log('\n📝 Step 2: List stored keys');
  console.log('-'.repeat(50));
  
  result = await listMemoryKeysTool.execute({}, context);
  const listData = JSON.parse(result as string);
  console.log('Keys in memory:', listData.keys);
  
  console.log('\n📝 Step 3: Use preferences in currency conversion');
  console.log('-'.repeat(50));
  
  // Convert without specifying target currency (will use stored preference)
  result = await currencyConverterTool.execute(
    { amount: 100, fromCurrency: 'USD' },
    context
  );
  console.log('Conversion result:', JSON.parse(result as string).message);
  
  // Convert with explicit target currency
  result = await currencyConverterTool.execute(
    { amount: 50, fromCurrency: 'EUR', toCurrency: 'JPY' },
    context
  );
  console.log('Conversion result:', JSON.parse(result as string).message);
  
  console.log('\n📝 Step 4: Shopping cart with memory');
  console.log('-'.repeat(50));
  
  // Add items to cart
  await shoppingCartTool.execute(
    { 
      action: 'add', 
      item: { name: 'Laptop', price: 999, currency: 'USD' }
    },
    context
  );
  console.log('Added laptop to cart');
  
  await shoppingCartTool.execute(
    { 
      action: 'add', 
      item: { name: 'Mouse', price: 25, currency: 'USD' }
    },
    context
  );
  console.log('Added mouse to cart');
  
  // List cart items
  result = await shoppingCartTool.execute(
    { action: 'list' },
    context
  );
  const cartData = JSON.parse(result as string);
  console.log('Cart items:', cartData.items);
  
  // Get total in preferred currency
  result = await shoppingCartTool.execute(
    { action: 'total' },
    context
  );
  console.log('Cart total:', JSON.parse(result as string).message);
  
  console.log('\n📝 Step 5: Recall specific values');
  console.log('-'.repeat(50));
  
  // Recall user name
  result = await recallMemoryTool.execute(
    { key: 'user_name' },
    context
  );
  console.log('Recalled name:', JSON.parse(result as string).value);
  
  // Recall location
  result = await recallMemoryTool.execute(
    { key: 'user_location' },
    context
  );
  console.log('Recalled location:', JSON.parse(result as string).value);
  
  // Try to recall non-existent key with default
  result = await recallMemoryTool.execute(
    { key: 'theme', defaultValue: 'light' },
    context
  );
  console.log('Recalled theme (with default):', JSON.parse(result as string).value);
  
  console.log('\n📝 Step 6: Delete a key');
  console.log('-'.repeat(50));
  
  result = await deleteMemoryTool.execute(
    { key: 'user_location' },
    context
  );
  console.log('Delete result:', JSON.parse(result as string).message);
  
  // List keys after deletion
  result = await listMemoryKeysTool.execute({}, context);
  console.log('Keys after deletion:', JSON.parse(result as string).keys);
  
  console.log('\n📝 Step 7: Clear all memory (with confirmation)');
  console.log('-'.repeat(50));
  
  // First attempt without confirmation
  result = await clearMemoryTool.execute(
    { confirm: false },
    context
  );
  console.log('Clear without confirmation:', JSON.parse(result as string).message);
  
  // Clear with confirmation
  result = await clearMemoryTool.execute(
    { confirm: true },
    context
  );
  console.log('Clear with confirmation:', JSON.parse(result as string).message);
  
  // List keys after clearing
  result = await listMemoryKeysTool.execute({}, context);
  console.log('Keys after clearing:', JSON.parse(result as string).keys);
  
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