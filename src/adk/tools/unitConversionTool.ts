import { 
  Tool, 
  ToolParameter, 
  ToolContext, 
  ToolResult,
  ToolParameterType
} from '../types';
import { createFunctionTool } from './index';

export interface ConversionUnit {
  category: 'weight' | 'temperature' | 'length' | 'volume' | 'area' | 'currency';
  unit: string;
  toBase: (value: number) => number;
  fromBase: (value: number) => number;
}

export interface CurrencyRates {
  [currency: string]: number;
}

export interface ConversionRequest {
  value: number;
  fromUnit: string;
  toUnit: string;
}

export interface ConversionResult {
  originalValue: number;
  convertedValue: number;
  fromUnit: string;
  toUnit: string;
  formula?: string;
}

const CONVERSION_UNITS: ConversionUnit[] = [
  // Weight conversions (base: kg)
  { category: 'weight', unit: 'kg', toBase: (v) => v, fromBase: (v) => v },
  { category: 'weight', unit: 'g', toBase: (v) => v / 1000, fromBase: (v) => v * 1000 },
  { category: 'weight', unit: 'mg', toBase: (v) => v / 1000000, fromBase: (v) => v * 1000000 },
  { category: 'weight', unit: 'lb', toBase: (v) => v * 0.453592, fromBase: (v) => v / 0.453592 },
  { category: 'weight', unit: 'lbs', toBase: (v) => v * 0.453592, fromBase: (v) => v / 0.453592 },
  { category: 'weight', unit: 'oz', toBase: (v) => v * 0.0283495, fromBase: (v) => v / 0.0283495 },
  { category: 'weight', unit: 'ton', toBase: (v) => v * 1000, fromBase: (v) => v / 1000 },
  { category: 'weight', unit: 'tonne', toBase: (v) => v * 1000, fromBase: (v) => v / 1000 },
  
  // Temperature conversions (base: C)
  { category: 'temperature', unit: 'C', toBase: (v) => v, fromBase: (v) => v },
  { category: 'temperature', unit: 'F', toBase: (v) => (v - 32) * 5/9, fromBase: (v) => v * 9/5 + 32 },
  { category: 'temperature', unit: 'K', toBase: (v) => v - 273.15, fromBase: (v) => v + 273.15 },
  
  // Length conversions (base: m)
  { category: 'length', unit: 'm', toBase: (v) => v, fromBase: (v) => v },
  { category: 'length', unit: 'km', toBase: (v) => v * 1000, fromBase: (v) => v / 1000 },
  { category: 'length', unit: 'cm', toBase: (v) => v / 100, fromBase: (v) => v * 100 },
  { category: 'length', unit: 'mm', toBase: (v) => v / 1000, fromBase: (v) => v * 1000 },
  { category: 'length', unit: 'mi', toBase: (v) => v * 1609.34, fromBase: (v) => v / 1609.34 },
  { category: 'length', unit: 'mile', toBase: (v) => v * 1609.34, fromBase: (v) => v / 1609.34 },
  { category: 'length', unit: 'yd', toBase: (v) => v * 0.9144, fromBase: (v) => v / 0.9144 },
  { category: 'length', unit: 'ft', toBase: (v) => v * 0.3048, fromBase: (v) => v / 0.3048 },
  { category: 'length', unit: 'in', toBase: (v) => v * 0.0254, fromBase: (v) => v / 0.0254 },
  
  // Volume conversions (base: L)
  { category: 'volume', unit: 'L', toBase: (v) => v, fromBase: (v) => v },
  { category: 'volume', unit: 'l', toBase: (v) => v, fromBase: (v) => v },
  { category: 'volume', unit: 'mL', toBase: (v) => v / 1000, fromBase: (v) => v * 1000 },
  { category: 'volume', unit: 'ml', toBase: (v) => v / 1000, fromBase: (v) => v * 1000 },
  { category: 'volume', unit: 'gal', toBase: (v) => v * 3.78541, fromBase: (v) => v / 3.78541 },
  { category: 'volume', unit: 'qt', toBase: (v) => v * 0.946353, fromBase: (v) => v / 0.946353 },
  { category: 'volume', unit: 'pt', toBase: (v) => v * 0.473176, fromBase: (v) => v / 0.473176 },
  { category: 'volume', unit: 'cup', toBase: (v) => v * 0.236588, fromBase: (v) => v / 0.236588 },
  { category: 'volume', unit: 'fl oz', toBase: (v) => v * 0.0295735, fromBase: (v) => v / 0.0295735 },
  
  // Area conversions (base: m²)
  { category: 'area', unit: 'm2', toBase: (v) => v, fromBase: (v) => v },
  { category: 'area', unit: 'm²', toBase: (v) => v, fromBase: (v) => v },
  { category: 'area', unit: 'km2', toBase: (v) => v * 1000000, fromBase: (v) => v / 1000000 },
  { category: 'area', unit: 'km²', toBase: (v) => v * 1000000, fromBase: (v) => v / 1000000 },
  { category: 'area', unit: 'cm2', toBase: (v) => v / 10000, fromBase: (v) => v * 10000 },
  { category: 'area', unit: 'cm²', toBase: (v) => v / 10000, fromBase: (v) => v * 10000 },
  { category: 'area', unit: 'ft2', toBase: (v) => v * 0.092903, fromBase: (v) => v / 0.092903 },
  { category: 'area', unit: 'ft²', toBase: (v) => v * 0.092903, fromBase: (v) => v / 0.092903 },
  { category: 'area', unit: 'in2', toBase: (v) => v * 0.00064516, fromBase: (v) => v / 0.00064516 },
  { category: 'area', unit: 'in²', toBase: (v) => v * 0.00064516, fromBase: (v) => v / 0.00064516 },
  { category: 'area', unit: 'acre', toBase: (v) => v * 4046.86, fromBase: (v) => v / 4046.86 },
  { category: 'area', unit: 'hectare', toBase: (v) => v * 10000, fromBase: (v) => v / 10000 },
];

const CURRENCY_CODES = [
  'USD', 'EUR', 'GBP', 'JPY', 'AUD', 'CAD', 'CHF', 'CNY', 'INR', 'MXN',
  'BRL', 'ZAR', 'SGD', 'HKD', 'NZD', 'SEK', 'NOK', 'DKK', 'PLN', 'RUB',
  'TRY', 'KRW', 'MYR', 'IDR', 'THB', 'PHP', 'VND', 'CZK', 'HUF', 'ILS'
];

async function fetchCurrencyRates(baseCurrency: string = 'USD'): Promise<CurrencyRates> {
  const apiKey = process.env.CURRENCY_API_KEY;
  
  if (!apiKey) {
    console.warn('CURRENCY_API_KEY not set, using mock rates for demonstration');
    return getMockCurrencyRates();
  }

  try {
    const apiUrl = process.env.CURRENCY_API_URL || 'https://api.exchangerate-api.com/v4/latest';
    const response = await fetch(`${apiUrl}/${baseCurrency}?apikey=${apiKey}`);
    
    if (!response.ok) {
      throw new Error(`Currency API error: ${response.status}`);
    }
    
    const data = await response.json();
    return data.rates || getMockCurrencyRates();
  } catch (error) {
    console.error('Failed to fetch currency rates:', error);
    return getMockCurrencyRates();
  }
}

function getMockCurrencyRates(): CurrencyRates {
  return {
    USD: 1.0,
    EUR: 0.85,
    GBP: 0.73,
    JPY: 110.5,
    AUD: 1.35,
    CAD: 1.25,
    CHF: 0.92,
    CNY: 6.45,
    INR: 83.50,
    MXN: 18.20,
    BRL: 5.25,
    ZAR: 15.80,
    SGD: 1.35,
    HKD: 7.85,
    NZD: 1.45,
  };
}

function findConversionUnit(unit: string): ConversionUnit | null {
  return CONVERSION_UNITS.find(u => 
    u.unit.toLowerCase() === unit.toLowerCase()
  ) || null;
}

function isCurrency(unit: string): boolean {
  return CURRENCY_CODES.includes(unit.toUpperCase());
}

async function convertCurrency(value: number, from: string, to: string): Promise<number> {
  const fromCurrency = from.toUpperCase();
  const toCurrency = to.toUpperCase();
  
  const rates = await fetchCurrencyRates('USD');
  
  if (!rates[fromCurrency] || !rates[toCurrency]) {
    throw new Error(`Currency not supported: ${!rates[fromCurrency] ? fromCurrency : toCurrency}`);
  }
  
  // Convert through USD as base
  const usdValue = value / rates[fromCurrency];
  return usdValue * rates[toCurrency];
}

function convertStatic(value: number, fromUnit: ConversionUnit, toUnit: ConversionUnit): number {
  if (fromUnit.category !== toUnit.category) {
    throw new Error(`Cannot convert between different categories: ${fromUnit.category} to ${toUnit.category}`);
  }
  
  const baseValue = fromUnit.toBase(value);
  return toUnit.fromBase(baseValue);
}

export async function performConversion(request: ConversionRequest): Promise<ConversionResult> {
  const { value, fromUnit, toUnit } = request;
  
  // Check if it's currency conversion
  if (isCurrency(fromUnit) && isCurrency(toUnit)) {
    const convertedValue = await convertCurrency(value, fromUnit, toUnit);
    return {
      originalValue: value,
      convertedValue,
      fromUnit: fromUnit.toUpperCase(),
      toUnit: toUnit.toUpperCase(),
      formula: `Using live exchange rates`
    };
  }
  
  // Check if it's static unit conversion
  const from = findConversionUnit(fromUnit);
  const to = findConversionUnit(toUnit);
  
  if (!from) {
    throw new Error(`Unknown unit: ${fromUnit}`);
  }
  
  if (!to) {
    throw new Error(`Unknown unit: ${toUnit}`);
  }
  
  const convertedValue = convertStatic(value, from, to);
  
  return {
    originalValue: value,
    convertedValue,
    fromUnit,
    toUnit,
    formula: `${fromUnit} → ${from.category} base → ${toUnit}`
  };
}

export function createUnitConversionTool(): Tool {
  return createFunctionTool({
    name: 'unitConversion',
    description: 'Convert between various units of measurement including weight, temperature, length, volume, area, and currencies',
    execute: async (params: Record<string, unknown>, context: ToolContext): Promise<ConversionResult> => {
      const { value, fromUnit, toUnit } = params as ConversionRequest;
      
      if (typeof value !== 'number' || isNaN(value)) {
        throw new Error('Value must be a valid number');
      }
      
      if (!fromUnit || !toUnit) {
        throw new Error('Both fromUnit and toUnit are required');
      }
      
      return await performConversion({ value, fromUnit, toUnit });
    },
    parameters: [
      {
        name: 'value',
        type: ToolParameterType.NUMBER,
        description: 'The numeric value to convert',
        required: true
      },
      {
        name: 'fromUnit',
        type: ToolParameterType.STRING,
        description: 'The unit to convert from (e.g., kg, lb, C, F, USD, EUR)',
        required: true
      },
      {
        name: 'toUnit',
        type: ToolParameterType.STRING,
        description: 'The unit to convert to',
        required: true
      }
    ],
    metadata: {
      source: 'function' as any,
      version: '1.0.0',
      tags: ['conversion', 'units', 'currency', 'measurement'],
      capabilities: {
        weight: ['kg', 'g', 'mg', 'lb', 'oz', 'ton'],
        temperature: ['C', 'F', 'K'],
        length: ['m', 'km', 'cm', 'mm', 'mi', 'yd', 'ft', 'in'],
        volume: ['L', 'mL', 'gal', 'qt', 'pt', 'cup', 'fl oz'],
        area: ['m²', 'km²', 'cm²', 'ft²', 'in²', 'acre', 'hectare'],
        currency: CURRENCY_CODES
      }
    }
  });
}

export function getSupportedUnits(): { static: string[], currencies: string[] } {
  return {
    static: CONVERSION_UNITS.map(u => u.unit),
    currencies: CURRENCY_CODES
  };
}