#!/usr/bin/env npx tsx

import { createUnitConversionTool, getSupportedUnits } from '../src/adk/tools/unitConversionTool';
import { ToolContext } from '../src/adk/types';

async function demonstrateUnitConversion() {
  console.log('=== Unit Conversion Tool Demo ===\n');
  
  // Create the tool
  const unitConversionTool = createUnitConversionTool();
  
  // Create a mock context
  const context: ToolContext = {
    agent: {
      id: 'demo-agent',
      name: 'Unit Conversion Demo Agent',
      role: 'demonstrator'
    },
    session: {
      id: 'demo-session',
      startTime: new Date()
    }
  };
  
  // Display supported units
  const supportedUnits = getSupportedUnits();
  console.log('📊 Supported Units:');
  console.log('  Static conversions:', supportedUnits.static.slice(0, 10).join(', '), '...');
  console.log('  Currencies:', supportedUnits.currencies.slice(0, 10).join(', '), '...\n');
  
  // Demo conversions
  const demos = [
    // Weight conversions
    { value: 10, fromUnit: 'kg', toUnit: 'lbs', description: 'Weight: Kilograms to Pounds' },
    { value: 150, fromUnit: 'lb', toUnit: 'kg', description: 'Weight: Pounds to Kilograms' },
    { value: 5000, fromUnit: 'g', toUnit: 'lb', description: 'Weight: Grams to Pounds' },
    
    // Temperature conversions
    { value: 25, fromUnit: 'C', toUnit: 'F', description: 'Temperature: Celsius to Fahrenheit' },
    { value: 98.6, fromUnit: 'F', toUnit: 'C', description: 'Temperature: Fahrenheit to Celsius' },
    { value: 0, fromUnit: 'C', toUnit: 'K', description: 'Temperature: Celsius to Kelvin' },
    
    // Length conversions
    { value: 5, fromUnit: 'km', toUnit: 'mi', description: 'Length: Kilometers to Miles' },
    { value: 6, fromUnit: 'ft', toUnit: 'm', description: 'Length: Feet to Meters' },
    { value: 100, fromUnit: 'yd', toUnit: 'm', description: 'Length: Yards to Meters' },
    
    // Volume conversions
    { value: 3.5, fromUnit: 'L', toUnit: 'gal', description: 'Volume: Liters to Gallons' },
    { value: 500, fromUnit: 'ml', toUnit: 'cup', description: 'Volume: Milliliters to Cups' },
    
    // Area conversions
    { value: 1000, fromUnit: 'm²', toUnit: 'ft²', description: 'Area: Square Meters to Square Feet' },
    { value: 2, fromUnit: 'acre', toUnit: 'hectare', description: 'Area: Acres to Hectares' },
    
    // Currency conversions (will use mock rates if no API key)
    { value: 1000, fromUnit: 'INR', toUnit: 'USD', description: 'Currency: Indian Rupees to US Dollars' },
    { value: 100, fromUnit: 'USD', toUnit: 'EUR', description: 'Currency: US Dollars to Euros' },
    { value: 500, fromUnit: 'GBP', toUnit: 'JPY', description: 'Currency: British Pounds to Japanese Yen' },
  ];
  
  console.log('🔄 Running Conversions:\n');
  
  for (const demo of demos) {
    try {
      console.log(`📏 ${demo.description}`);
      console.log(`   Input: ${demo.value} ${demo.fromUnit}`);
      
      const result = await unitConversionTool.execute(
        {
          value: demo.value,
          fromUnit: demo.fromUnit,
          toUnit: demo.toUnit
        },
        context
      );
      
      if (result.success && result.data) {
        const data = result.data as any;
        console.log(`   Output: ${data.convertedValue.toFixed(2)} ${data.toUnit}`);
        if (data.formula) {
          console.log(`   Method: ${data.formula}`);
        }
      } else {
        console.log(`   Error: ${result.error}`);
      }
      console.log();
    } catch (error) {
      console.error(`   Error: ${error instanceof Error ? error.message : 'Unknown error'}\n`);
    }
  }
  
  // Demo error handling
  console.log('❌ Error Handling Demo:\n');
  
  const errorCases = [
    { value: 100, fromUnit: 'kg', toUnit: 'C', description: 'Invalid: Different categories' },
    { value: 50, fromUnit: 'xyz', toUnit: 'kg', description: 'Invalid: Unknown unit' },
  ];
  
  for (const errorCase of errorCases) {
    try {
      console.log(`🚫 ${errorCase.description}`);
      console.log(`   Attempting: ${errorCase.value} ${errorCase.fromUnit} → ${errorCase.toUnit}`);
      
      const result = await unitConversionTool.execute(
        {
          value: errorCase.value,
          fromUnit: errorCase.fromUnit,
          toUnit: errorCase.toUnit
        },
        context
      );
      
      if (!result.success) {
        console.log(`   Expected error: ${result.error}`);
      }
      console.log();
    } catch (error) {
      console.error(`   Caught error: ${error instanceof Error ? error.message : 'Unknown error'}\n`);
    }
  }
  
  // Environment variable info
  console.log('💡 Tips:');
  console.log('   - Set CURRENCY_API_KEY environment variable for live exchange rates');
  console.log('   - Supported providers: exchangerate-api.com, currencyapi.com, etc.');
  console.log('   - Without API key, mock rates are used for demonstration\n');
  
  // Advanced usage example
  console.log('🚀 Advanced Usage Example:\n');
  console.log('```typescript');
  console.log('// Import the tool');
  console.log("import { createUnitConversionTool } from './unitConversionTool';");
  console.log('');
  console.log('// Create and use the tool');
  console.log('const converter = createUnitConversionTool();');
  console.log('const result = await converter.execute({');
  console.log('  value: 100,');
  console.log("  fromUnit: 'USD',");
  console.log("  toUnit: 'EUR'");
  console.log('}, context);');
  console.log('```\n');
}

// Run the demonstration
demonstrateUnitConversion().catch(console.error);