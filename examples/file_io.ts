/**
 * File I/O Tool Example
 * Demonstrates reading CSV files and writing JSON files
 */

import { fileIOTool, readCSVFile, writeJSONFile } from '../src/adk/tools/fileIOTool.js';
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
    });
    
    if (!readResult.success) {
      throw new Error(readResult.error);
    }
    
    const orders = readResult.data as any[];
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
    });
    
    if (!writeResult.success) {
      throw new Error(writeResult.error);
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
    });
    
    if (!verifyResult.success) {
      throw new Error(verifyResult.error);
    }
    
    const verifiedData = verifyResult.data as OrderSummary;
    console.log(`✓ Verified JSON file contains ${verifiedData.totalOrders} orders`);
    console.log(`✓ Revenue matches: $${verifiedData.totalRevenue}\n`);
    
    // 6. Demonstrate CSV writing
    console.log('6. Writing filtered data to new CSV...');
    const completedOrders = orders.filter(order => order.status === 'completed');
    
    const csvWriteResult = await fileIOTool.execute({
      action: 'write',
      filepath: path.join(process.cwd(), 'data', 'completed_orders.csv'),
      content: completedOrders,
      format: 'csv'
    });
    
    if (!csvWriteResult.success) {
      throw new Error(csvWriteResult.error);
    }
    
    console.log(`✓ Wrote ${completedOrders.length} completed orders to new CSV file\n`);
    
    console.log('=== File I/O Tool Demonstration Complete ===');
    
  } catch (error) {
    console.error('Error during file I/O demonstration:', error);
    process.exit(1);
  }
}

// Run the demonstration
if (import.meta.url === `file://${process.argv[1]}`) {
  demonstrateFileIO().catch(console.error);
}