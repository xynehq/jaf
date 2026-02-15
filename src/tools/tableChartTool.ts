/**
 * Table & Chart Generator Tool
 * 
 * Converts structured data (CSV/JSON) into tables and chart-ready specs
 * Supports output modes: table (markdown) and chart (JSON for Highcharts/Recharts)
 */

export interface TableChartOptions {
  outputMode: 'table' | 'chart';
  chartType?: 'line' | 'bar' | 'pie' | 'area' | 'scatter' | 'column';
  chartLibrary?: 'highcharts' | 'recharts';
  xAxis?: string;
  yAxis?: string | string[];
  groupBy?: string;
  aggregation?: 'sum' | 'avg' | 'count' | 'min' | 'max';
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  limit?: number;
}

interface DataRow {
  [key: string]: string | number | boolean | null;
}

function parseCSV(csvContent: string): DataRow[] {
  const lines = csvContent.trim().split('\n');
  if (lines.length === 0) return [];
  
  const headers = lines[0].split(',').map(h => h.trim());
  const data: DataRow[] = [];
  
  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',').map(v => v.trim());
    const row: DataRow = {};
    
    headers.forEach((header, index) => {
      const value = values[index] || '';
      
      // Check if it's a date-like string (YYYY-MM-DD format)
      if (/^\d{4}-\d{2}-\d{2}/.test(value)) {
        row[header] = value;
      }
      // Try to parse as number (but not if it looks like a date)
      else if (!isNaN(parseFloat(value)) && value !== '' && !/^\d{4}-/.test(value)) {
        row[header] = parseFloat(value);
      } else if (value.toLowerCase() === 'true') {
        row[header] = true;
      } else if (value.toLowerCase() === 'false') {
        row[header] = false;
      } else if (value === '') {
        row[header] = null;
      } else {
        row[header] = value;
      }
    });
    
    data.push(row);
  }
  
  return data;
}

function parseJSON(jsonContent: string): DataRow[] {
  try {
    const parsed = JSON.parse(jsonContent);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch (error) {
    throw new Error(`Invalid JSON: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

function generateMarkdownTable(data: DataRow[]): string {
  if (data.length === 0) return '| No Data |\n|----------|';
  
  const headers = Object.keys(data[0]);
  const headerRow = `| ${headers.join(' | ')} |`;
  const separatorRow = `|${headers.map(() => '---').join('|')}|`;
  
  const rows = data.map(row => {
    const values = headers.map(header => {
      const value = row[header];
      if (value === null || value === undefined) return '';
      return String(value);
    });
    return `| ${values.join(' | ')} |`;
  });
  
  return [headerRow, separatorRow, ...rows].join('\n');
}

function generateHighchartsSpec(data: DataRow[], options: TableChartOptions): any {
  const chartType = options.chartType || 'line';
  const xAxis = options.xAxis || Object.keys(data[0])[0];
  const yAxis = options.yAxis || [Object.keys(data[0])[1]];
  const yAxisArray = Array.isArray(yAxis) ? yAxis : [yAxis];
  
  // Prepare series data
  const series = yAxisArray.map(yKey => {
    const seriesData = data.map(row => {
      const xValue = row[xAxis];
      const yValue = row[yKey];
      
      // Handle different chart types
      if (chartType === 'pie' && data.length > 0) {
        return {
          name: String(xValue),
          y: Number(yValue) || 0
        };
      }
      
      return [xValue, Number(yValue) || 0];
    });
    
    return {
      name: yKey,
      type: chartType,
      data: seriesData
    };
  });
  
  // Generate Highcharts configuration
  const config = {
    chart: {
      type: chartType
    },
    title: {
      text: 'Data Visualization'
    },
    xAxis: chartType === 'pie' ? undefined : {
      title: {
        text: xAxis
      },
      categories: chartType !== 'scatter' ? data.map(row => String(row[xAxis])) : undefined
    },
    yAxis: chartType === 'pie' ? undefined : {
      title: {
        text: yAxisArray.join(', ')
      }
    },
    series: chartType === 'pie' ? series[0].data : series,
    plotOptions: chartType === 'pie' ? {
      pie: {
        allowPointSelect: true,
        cursor: 'pointer',
        dataLabels: {
          enabled: true,
          format: '<b>{point.name}</b>: {point.percentage:.1f} %'
        }
      }
    } : undefined,
    tooltip: {
      shared: chartType !== 'pie',
      crosshairs: chartType === 'line' || chartType === 'area'
    }
  };
  
  return config;
}

function generateRechartsSpec(data: DataRow[], options: TableChartOptions): any {
  const chartType = options.chartType || 'line';
  const xAxis = options.xAxis || Object.keys(data[0])[0];
  const yAxis = options.yAxis || [Object.keys(data[0])[1]];
  const yAxisArray = Array.isArray(yAxis) ? yAxis : [yAxis];
  
  // For Recharts, data format is different
  if (chartType === 'pie') {
    // Pie chart needs different data structure
    const pieData = data.map(row => ({
      name: String(row[xAxis]),
      value: Number(row[yAxisArray[0]]) || 0
    }));
    
    return {
      type: 'PieChart',
      width: 400,
      height: 400,
      data: pieData,
      components: [
        {
          type: 'Pie',
          dataKey: 'value',
          cx: '50%',
          cy: '50%',
          outerRadius: 80,
          fill: '#8884d8',
          label: true
        },
        {
          type: 'Tooltip'
        }
      ]
    };
  }
  
  // Line, Bar, Area charts use similar structure
  const chartComponents: any[] = [];
  
  // Map chart types to Recharts component names
  const componentTypeMap: { [key: string]: string } = {
    line: 'Line',
    bar: 'Bar',
    area: 'Area',
    scatter: 'Scatter',
    column: 'Bar'
  };
  
  const componentType = componentTypeMap[chartType] || 'Line';
  
  // Add chart components for each y-axis
  yAxisArray.forEach((yKey, index) => {
    chartComponents.push({
      type: componentType,
      dataKey: yKey,
      stroke: `hsl(${index * 60}, 70%, 50%)`,
      fill: `hsl(${index * 60}, 70%, 50%)`,
      ...(chartType === 'area' ? { fillOpacity: 0.6 } : {})
    });
  });
  
  return {
    type: chartType === 'scatter' ? 'ScatterChart' : 
          chartType === 'bar' || chartType === 'column' ? 'BarChart' :
          chartType === 'area' ? 'AreaChart' : 'LineChart',
    width: 730,
    height: 250,
    data: data,
    margin: { top: 5, right: 30, left: 20, bottom: 5 },
    components: [
      {
        type: 'CartesianGrid',
        strokeDasharray: '3 3'
      },
      {
        type: 'XAxis',
        dataKey: xAxis
      },
      {
        type: 'YAxis'
      },
      {
        type: 'Tooltip'
      },
      {
        type: 'Legend'
      },
      ...chartComponents
    ]
  };
}

function aggregateData(data: DataRow[], options: TableChartOptions): DataRow[] {
  if (!options.groupBy || !options.aggregation) return data;
  
  const grouped = new Map<string, DataRow[]>();
  
  // Group data
  data.forEach(row => {
    const key = String(row[options.groupBy!]);
    if (!grouped.has(key)) {
      grouped.set(key, []);
    }
    grouped.get(key)!.push(row);
  });
  
  // Aggregate
  const result: DataRow[] = [];
  grouped.forEach((rows, key) => {
    const aggregated: DataRow = { [options.groupBy!]: key };
    
    // Get numeric columns
    const numericColumns = Object.keys(rows[0]).filter(col => 
      col !== options.groupBy && typeof rows[0][col] === 'number'
    );
    
    numericColumns.forEach(col => {
      const values = rows.map(r => Number(r[col]) || 0);
      
      switch (options.aggregation) {
        case 'sum':
          aggregated[col] = values.reduce((a, b) => a + b, 0);
          break;
        case 'avg':
          aggregated[col] = values.reduce((a, b) => a + b, 0) / values.length;
          break;
        case 'count':
          aggregated[col] = values.length;
          break;
        case 'min':
          aggregated[col] = Math.min(...values);
          break;
        case 'max':
          aggregated[col] = Math.max(...values);
          break;
      }
    });
    
    result.push(aggregated);
  });
  
  return result;
}

function sortData(data: DataRow[], options: TableChartOptions): DataRow[] {
  if (!options.sortBy) return data;
  
  const sorted = [...data];
  const order = options.sortOrder || 'asc';
  
  sorted.sort((a, b) => {
    const aVal = a[options.sortBy!];
    const bVal = b[options.sortBy!];
    
    if (aVal === null || aVal === undefined) return 1;
    if (bVal === null || bVal === undefined) return -1;
    
    let comparison = 0;
    if (typeof aVal === 'number' && typeof bVal === 'number') {
      comparison = aVal - bVal;
    } else {
      comparison = String(aVal).localeCompare(String(bVal));
    }
    
    return order === 'asc' ? comparison : -comparison;
  });
  
  return sorted;
}

export function tableChartTool(
  data: string,
  format: 'csv' | 'json',
  options: TableChartOptions
): any {
  // Parse input data
  let parsedData: DataRow[];
  if (format === 'csv') {
    parsedData = parseCSV(data);
  } else {
    parsedData = parseJSON(data);
  }
  
  // Apply aggregation if specified
  if (options.groupBy && options.aggregation) {
    parsedData = aggregateData(parsedData, options);
  }
  
  // Apply sorting if specified
  if (options.sortBy) {
    parsedData = sortData(parsedData, options);
  }
  
  // Apply limit if specified
  if (options.limit && options.limit > 0) {
    parsedData = parsedData.slice(0, options.limit);
  }
  
  // Generate output based on mode
  if (options.outputMode === 'table') {
    return {
      type: 'markdown',
      content: generateMarkdownTable(parsedData),
      rowCount: parsedData.length,
      columns: parsedData.length > 0 ? Object.keys(parsedData[0]) : []
    };
  } else {
    // Generate chart specification
    const chartLibrary = options.chartLibrary || 'highcharts';
    const spec = chartLibrary === 'highcharts' 
      ? generateHighchartsSpec(parsedData, options)
      : generateRechartsSpec(parsedData, options);
    
    return {
      type: 'chart',
      library: chartLibrary,
      spec: spec,
      dataPoints: parsedData.length
    };
  }
}