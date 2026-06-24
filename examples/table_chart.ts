/**
 * Table & Chart Generator Tool - Integration Example
 * 
 * Demonstrates how to:
 * 1. Convert CSV sales data into a markdown table
 * 2. Generate chart spec JSON for frontend rendering
 * 3. Apply aggregations and transformations
 */

import * as fs from 'fs';
import * as path from 'path';
import { tableChartTool } from '../src/tools/tableChartTool';

async function runExample() {
  console.log('🎯 Table & Chart Generator Tool Demo\n');
  console.log('=' .repeat(50));
  
  // Read the orders.csv file
  const csvPath = path.join(__dirname, 'orders.csv');
  const csvData = fs.readFileSync(csvPath, 'utf-8');
  
  // Example 1: Convert CSV to Markdown Table (top 10 orders)
  console.log('\n📊 Example 1: CSV to Markdown Table (Top 10 Orders by Amount)');
  console.log('-'.repeat(50));
  
  const tableResult = tableChartTool(csvData, 'csv', {
    outputMode: 'table',
    sortBy: 'total_amount',
    sortOrder: 'desc',
    limit: 10
  });
  
  console.log('Generated Table:\n');
  console.log(tableResult.content);
  console.log(`\n✅ Total rows: ${tableResult.rowCount}`);
  
  // Example 2: Generate Bar Chart Spec for Sales by Category
  console.log('\n📈 Example 2: Bar Chart - Sales by Category (Highcharts)');
  console.log('-'.repeat(50));
  
  const barChartResult = tableChartTool(csvData, 'csv', {
    outputMode: 'chart',
    chartType: 'bar',
    chartLibrary: 'highcharts',
    xAxis: 'category',
    yAxis: 'total_amount',
    groupBy: 'category',
    aggregation: 'sum'
  });
  
  console.log('Generated Highcharts Config:');
  console.log(JSON.stringify(barChartResult.spec, null, 2));
  console.log(`\n✅ Data points: ${barChartResult.dataPoints}`);
  
  // Example 3: Generate Line Chart for Sales Over Time
  console.log('\n📉 Example 3: Line Chart - Daily Sales Trend (Recharts)');
  console.log('-'.repeat(50));
  
  const lineChartResult = tableChartTool(csvData, 'csv', {
    outputMode: 'chart',
    chartType: 'line',
    chartLibrary: 'recharts',
    xAxis: 'date',
    yAxis: 'total_amount',
    groupBy: 'date',
    aggregation: 'sum',
    sortBy: 'date',
    sortOrder: 'asc'
  });
  
  console.log('Generated Recharts Config:');
  console.log(JSON.stringify(lineChartResult.spec, null, 2));
  console.log(`\n✅ Chart type: ${lineChartResult.spec.type}`);
  
  // Example 4: Generate Pie Chart for Sales by Region
  console.log('\n🥧 Example 4: Pie Chart - Sales Distribution by Region');
  console.log('-'.repeat(50));
  
  const pieChartResult = tableChartTool(csvData, 'csv', {
    outputMode: 'chart',
    chartType: 'pie',
    chartLibrary: 'highcharts',
    xAxis: 'region',
    yAxis: 'total_amount',
    groupBy: 'region',
    aggregation: 'sum'
  });
  
  console.log('Generated Pie Chart Config:');
  console.log(JSON.stringify(pieChartResult.spec, null, 2));
  
  // Example 5: JSON Input - Product Performance Table
  console.log('\n📋 Example 5: JSON to Table - Product Performance');
  console.log('-'.repeat(50));
  
  const jsonData = JSON.stringify([
    { product: 'Laptop Pro', sold: 5, revenue: 6499.95, avgPrice: 1299.99 },
    { product: 'Office Chair', sold: 8, revenue: 1999.92, avgPrice: 249.99 },
    { product: 'Monitor 27"', sold: 6, revenue: 2399.94, avgPrice: 399.99 },
    { product: 'Standing Desk', sold: 3, revenue: 1799.97, avgPrice: 599.99 }
  ]);
  
  const jsonTableResult = tableChartTool(jsonData, 'json', {
    outputMode: 'table',
    sortBy: 'revenue',
    sortOrder: 'desc'
  });
  
  console.log('Product Performance Table:\n');
  console.log(jsonTableResult.content);
  
  // Example 6: Multi-series Line Chart
  console.log('\n📊 Example 6: Multi-series Chart - Quantity vs Revenue');
  console.log('-'.repeat(50));
  
  const multiSeriesResult = tableChartTool(csvData, 'csv', {
    outputMode: 'chart',
    chartType: 'line',
    chartLibrary: 'highcharts',
    xAxis: 'date',
    yAxis: ['quantity', 'total_amount'],
    groupBy: 'date',
    aggregation: 'sum',
    sortBy: 'date',
    sortOrder: 'asc'
  });
  
  console.log('Multi-series Chart Config Generated');
  console.log(`Series count: ${multiSeriesResult.spec.series?.length || 0}`);
  if (multiSeriesResult.spec.series) {
    multiSeriesResult.spec.series.forEach((s: any) => {
      console.log(`  - ${s.name}: ${s.data?.length || 0} data points`);
    });
  }
  
  console.log('\n' + '='.repeat(50));
  console.log('✨ Demo completed successfully!');
  console.log('\n💡 Integration Tips:');
  console.log('1. Use "table" mode for quick data exploration and reports');
  console.log('2. Use "chart" mode to generate configs for your frontend charts');
  console.log('3. Apply aggregations to summarize large datasets');
  console.log('4. Combine with other tools for complete analytics pipelines');
}

// Run the example
runExample().catch(error => {
  console.error('❌ Error running example:', error);
  process.exit(1);
});