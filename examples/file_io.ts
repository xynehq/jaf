/**
 * File I/O Tool Example
 * Demonstrates reading CSV files and writing JSON files using the core File I/O tool
 */

import { fileIOTool, readCSVFile, writeJSONFile } from '../src/utils/fileIOTool.js';
import * as path from 'path';

interface OrderSummary {
  totalOrders: number;
  totalRevenue: number;
  averageOrderValue: number;
  statusBreakdown: Record<string, number>;
  topProducts: Array<{ product: string; totalQuantity: number }>;
  orderDetails: any[];
}

async function demonstrateFileIO() {
  console.log('=== File I/O Tool Demonstration ===\n');
  
  try {
    // 1. Read CSV file using the tool directly
    console.log('1. Reading CSV file using fileIOTool...');
    const csvPath = path.join(process.cwd(), 'data', 'orders.csv');
    
    const readResult = await fileIOTool.execute({
      action: 'read',
      filepath: csvPath,
      format: 'csv'
    }, {} as any); // Context would be provided by the agent framework
    
    // Check if result is a ToolResult
    let orders: any[];
    if (typeof readResult === 'string') {
      throw new Error('Unexpected string result');
    } else if (readResult.status === 'success') {
      orders = readResult.data.data as any[];
    } else {
      throw new Error(readResult.message || 'Failed to read CSV');
    }
    console.log(`✓ Successfully read ${orders.length} orders from CSV\n`);
    
    // Display first few orders
    console.log('First 3 orders:');
    orders.slice(0, 3).forEach(order => {
      console.log(`  Order #${order.order_id}: ${order.customer_name} - ${order.product} (${order.status})`);
    });
    console.log();
    
    // 2. Process the data
    console.log('2. Processing order data...');
    
    // Calculate summary statistics
    const totalRevenue = orders.reduce((sum, order) => {
      return sum + (parseFloat(order.price) * parseInt(order.quantity));
    }, 0);
    
    const statusBreakdown: Record<string, number> = {};
    orders.forEach(order => {
      statusBreakdown[order.status] = (statusBreakdown[order.status] || 0) + 1;
    });
    
    // Find top products by quantity
    const productQuantities: Record<string, number> = {};
    orders.forEach(order => {
      const qty = parseInt(order.quantity);
      productQuantities[order.product] = (productQuantities[order.product] || 0) + qty;
    });
    
    const topProducts = Object.entries(productQuantities)
      .map(([product, totalQuantity]) => ({ product, totalQuantity }))
      .sort((a, b) => b.totalQuantity - a.totalQuantity)
      .slice(0, 5);
    
    const summary: OrderSummary = {
      totalOrders: orders.length,
      totalRevenue: Math.round(totalRevenue * 100) / 100,
      averageOrderValue: Math.round((totalRevenue / orders.length) * 100) / 100,
      statusBreakdown,
      topProducts,
      orderDetails: orders
    };
    
    console.log('✓ Data processing complete\n');
    console.log('Summary:');
    console.log(`  Total Orders: ${summary.totalOrders}`);
    console.log(`  Total Revenue: $${summary.totalRevenue}`);
    console.log(`  Average Order Value: $${summary.averageOrderValue}`);
    console.log(`  Status Breakdown:`, summary.statusBreakdown);
    console.log();
    
    // 3. Write JSON file using the tool
    console.log('3. Writing summary to JSON file...');
    const jsonPath = path.join(process.cwd(), 'data', 'order_summary.json');
    
    const writeResult = await fileIOTool.execute({
      action: 'write',
      filepath: jsonPath,
      content: summary,
      format: 'json'
    }, {} as any);
    
    if (typeof writeResult !== 'string' && writeResult.status !== 'success') {
      throw new Error(writeResult.message || 'Failed to write JSON');
    }
    
    console.log(`✓ Successfully wrote summary to ${jsonPath}\n`);
    
    // 4. Demonstrate convenience functions
    console.log('4. Using convenience functions...');
    
    // Read CSV using convenience function
    const ordersAlt = await readCSVFile(csvPath);
    console.log(`✓ readCSVFile: Read ${ordersAlt.length} orders`);
    
    // Write JSON using convenience function
    const reportPath = path.join(process.cwd(), 'data', 'report.json');
    await writeJSONFile(reportPath, {
      generatedAt: new Date().toISOString(),
      summary: {
        orders: summary.totalOrders,
        revenue: summary.totalRevenue
      }
    });
    console.log(`✓ writeJSONFile: Created report at ${reportPath}\n`);
    
    // 5. Read the written JSON file to verify
    console.log('5. Verifying written JSON file...');
    const verifyResult = await fileIOTool.execute({
      action: 'read',
      filepath: jsonPath,
      format: 'json'
    }, {} as any);
    
    if (typeof verifyResult !== 'string' && verifyResult.status === 'success') {
      const verifiedData = verifyResult.data.data as OrderSummary;
      console.log(`✓ Verified JSON file contains ${verifiedData.totalOrders} orders`);
      console.log(`✓ Revenue matches: $${verifiedData.totalRevenue}\n`);
    }
    
    // 6. Demonstrate CSV writing
    console.log('6. Writing filtered data to new CSV...');
    const completedOrders = orders.filter(order => order.status === 'completed');
    
    const csvWriteResult = await fileIOTool.execute({
      action: 'write',
      filepath: path.join(process.cwd(), 'data', 'completed_orders.csv'),
      content: completedOrders,
      format: 'csv'
    }, {} as any);
    
    if (typeof csvWriteResult !== 'string' && csvWriteResult.status !== 'success') {
      throw new Error(csvWriteResult.message || 'Failed to write CSV');
    }
    
    console.log(`✓ Wrote ${completedOrders.length} completed orders to new CSV file\n`);
    
    console.log('=== File I/O Tool Demonstration Complete ===');
    console.log('\nThe fileIOTool provides:');
    console.log('  • Core Tool<A, Ctx> interface compatible with JAF framework');
    console.log('  • Read/write support for text, JSON, and CSV files');
    console.log('  • Automatic format detection based on file extension');
    console.log('  • CSV parsing with configurable delimiter and headers');
    console.log('  • Type-safe parameters using Zod schemas');
    console.log('  • Proper error handling with ToolResult types');
    console.log('  • Convenience functions for common operations');
    
  } catch (error) {
    console.error('Error during file I/O demonstration:', error);
    process.exit(1);
  }
}

// Run the demonstration
if (import.meta.url === `file://${process.argv[1]}`) {
  demonstrateFileIO().catch(console.error);
}