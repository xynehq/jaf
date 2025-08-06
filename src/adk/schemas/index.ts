/**
 * JAF ADK Layer - Schema Validation
 * 
 * Functional schema validation system
 */

import {
  SchemaValidator,
  ValidationResult,
  JsonSchema,
  TypeGuard,
  ValidationError,
  throwValidationError,
  createValidationError
} from '../types';

// Re-export createValidationError for external use
export { createValidationError } from '../types';

// ========== Schema Validator Creation ==========

export const createSchemaValidator = <T>(
  schema: JsonSchema,
  validator: TypeGuard<T>
): SchemaValidator<T> => ({
  schema,
  validate: (data: unknown): ValidationResult<T> => {
    try {
      // First run the type guard
      if (!validator(data)) {
        return {
          success: false,
          errors: ['Data does not match expected type']
        };
      }
      
      // Then run JSON schema validation
      const schemaValidation = validateAgainstJsonSchema(data, schema);
      if (!schemaValidation.success) {
        return { success: false, errors: schemaValidation.errors };
      }
      
      return {
        success: true,
        data: data as T
      };
    } catch (error) {
      return {
        success: false,
        errors: [`Validation error: ${error instanceof Error ? error.message : String(error)}`]
      };
    }
  }
});

// ========== JSON Schema Validation ==========

export const validateAgainstJsonSchema = (
  data: unknown,
  schema: JsonSchema
): ValidationResult<unknown> => {
  const errors: string[] = [];
  
  // Type validation
  if (!validateType(data, schema.type)) {
    errors.push(`Expected type ${schema.type}, got ${typeof data}`);
    return { success: false, errors };
  }
  
  // Specific validations based on type
  switch (schema.type) {
    case 'object': {
      const objectValidation = validateObject(data as Record<string, unknown>, schema);
      if (!objectValidation.success) {
        errors.push(...(objectValidation.errors || []));
      }
      break;
    }
      
    case 'array': {
      const arrayValidation = validateArray(data as unknown[], schema);
      if (!arrayValidation.success) {
        errors.push(...(arrayValidation.errors || []));
      }
      break;
    }
      
    case 'string': {
      const stringValidation = validateString(data as string, schema);
      if (!stringValidation.success) {
        errors.push(...(stringValidation.errors || []));
      }
      break;
    }
      
    case 'number': {
      const numberValidation = validateNumber(data as number, schema);
      if (!numberValidation.success) {
        errors.push(...(numberValidation.errors || []));
      }
      break;
    }
  }
  
  // Enum validation
  if (schema.enum && !schema.enum.includes(data)) {
    errors.push(`Value must be one of: ${schema.enum.join(', ')}`);
  }
  
  if (errors.length > 0) {
    return { success: false, errors };
  }
  
  return { success: true, data };
};

const validateType = (data: unknown, type: string): boolean => {
  switch (type) {
    case 'string':
      return typeof data === 'string';
    case 'number':
      return typeof data === 'number';
    case 'boolean':
      return typeof data === 'boolean';
    case 'object':
      return typeof data === 'object' && data !== null && !Array.isArray(data);
    case 'array':
      return Array.isArray(data);
    case 'null':
      return data === null;
    default:
      return true; // Unknown types pass
  }
};

const validateObject = (
  data: Record<string, unknown>,
  schema: JsonSchema
): ValidationResult<Record<string, unknown>> => {
  const errors: string[] = [];
  
  // Check required properties
  if (schema.required) {
    for (const requiredProp of schema.required) {
      if (!(requiredProp in data)) {
        errors.push(`Missing required property: ${requiredProp}`);
      }
    }
  }
  
  // Validate properties
  if (schema.properties) {
    for (const [propName, propSchema] of Object.entries(schema.properties)) {
      if (propName in data) {
        const propValidation = validateAgainstJsonSchema(data[propName], propSchema);
        if (!propValidation.success) {
          errors.push(`Property '${propName}': ${propValidation.errors?.join(', ')}`);
        }
      }
    }
  }
  
  if (errors.length > 0) {
    return { success: false, errors };
  }
  
  return { success: true, data };
};

const validateArray = (
  data: unknown[],
  schema: JsonSchema
): ValidationResult<unknown[]> => {
  const errors: string[] = [];
  
  // Min items validation
  if (schema.minItems !== undefined && data.length < schema.minItems) {
    errors.push(`Array must have at least ${schema.minItems} items`);
  }
  
  // Max items validation
  if (schema.maxItems !== undefined && data.length > schema.maxItems) {
    errors.push(`Array must have at most ${schema.maxItems} items`);
  }
  
  // Unique items validation
  if (schema.uniqueItems) {
    const seen = new Set<string>();
    for (const item of data) {
      const key = JSON.stringify(item);
      if (seen.has(key)) {
        errors.push('Array must contain unique items');
        break;
      }
      seen.add(key);
    }
  }
  
  // Validate items
  if (schema.items) {
    for (let i = 0; i < data.length; i++) {
      const itemValidation = validateAgainstJsonSchema(data[i], schema.items);
      if (!itemValidation.success) {
        errors.push(`Item ${i}: ${itemValidation.errors?.join(', ')}`);
      }
    }
  }
  
  if (errors.length > 0) {
    return { success: false, errors };
  }
  
  return { success: true, data };
};

const validateString = (
  data: string,
  schema: JsonSchema
): ValidationResult<string> => {
  const errors: string[] = [];
  
  // Min length validation
  if (schema.minLength !== undefined && data.length < schema.minLength) {
    errors.push(`String length must be at least ${schema.minLength}`);
  }
  
  // Max length validation
  if (schema.maxLength !== undefined && data.length > schema.maxLength) {
    errors.push(`String length must be at most ${schema.maxLength}`);
  }
  
  // Pattern validation
  if (schema.pattern) {
    try {
      const regex = new RegExp(schema.pattern);
      if (!regex.test(data)) {
        errors.push(`String does not match pattern: ${schema.pattern}`);
      }
    } catch {
      errors.push(`Invalid regex pattern: ${schema.pattern}`);
    }
  }
  
  // Format validation (basic common formats)
  if (schema.format) {
    switch (schema.format) {
      case 'email':
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data)) {
          errors.push('Invalid email format');
        }
        break;
      case 'uri':
      case 'url':
        try {
          new URL(data);
        } catch {
          errors.push('Invalid URL format');
        }
        break;
      case 'date':
        if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) {
          errors.push('Invalid date format (expected YYYY-MM-DD)');
        }
        break;
      case 'date-time':
        if (isNaN(Date.parse(data))) {
          errors.push('Invalid date-time format');
        }
        break;
      case 'uuid':
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(data)) {
          errors.push('Invalid UUID format');
        }
        break;
    }
  }
  
  if (errors.length > 0) {
    return { success: false, errors };
  }
  
  return { success: true, data };
};

const validateNumber = (
  data: number,
  schema: JsonSchema
): ValidationResult<number> => {
  const errors: string[] = [];
  
  // Minimum validation
  if (schema.minimum !== undefined) {
    if (schema.exclusiveMinimum && data <= schema.minimum) {
      errors.push(`Number must be greater than ${schema.minimum}`);
    } else if (!schema.exclusiveMinimum && data < schema.minimum) {
      errors.push(`Number must be at least ${schema.minimum}`);
    }
  }
  
  // Maximum validation
  if (schema.maximum !== undefined) {
    if (schema.exclusiveMaximum && data >= schema.maximum) {
      errors.push(`Number must be less than ${schema.maximum}`);
    } else if (!schema.exclusiveMaximum && data > schema.maximum) {
      errors.push(`Number must be at most ${schema.maximum}`);
    }
  }
  
  // Multiple of validation
  if (schema.multipleOf !== undefined) {
    const remainder = data % schema.multipleOf;
    // Handle floating point precision issues
    if (Math.abs(remainder) > 0.0000001 && Math.abs(remainder - schema.multipleOf) > 0.0000001) {
      errors.push(`Number must be a multiple of ${schema.multipleOf}`);
    }
  }
  
  // Integer validation
  if (schema.type === 'integer' && !Number.isInteger(data)) {
    errors.push('Number must be an integer');
  }
  
  if (errors.length > 0) {
    return { success: false, errors };
  }
  
  return { success: true, data };
};

// ========== Common Type Guards ==========

export const isString: TypeGuard<string> = (value: unknown): value is string => {
  return typeof value === 'string';
};

export const isNumber: TypeGuard<number> = (value: unknown): value is number => {
  return typeof value === 'number';
};

export const isBoolean: TypeGuard<boolean> = (value: unknown): value is boolean => {
  return typeof value === 'boolean';
};

export const isObject: TypeGuard<Record<string, unknown>> = (
  value: unknown
): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
};

export const isArray: TypeGuard<unknown[]> = (value: unknown): value is unknown[] => {
  return Array.isArray(value);
};

export const isNull: TypeGuard<null> = (value: unknown): value is null => {
  return value === null;
};

export const isUndefined: TypeGuard<undefined> = (value: unknown): value is undefined => {
  return value === undefined;
};

// ========== Schema Builders ==========

export const stringSchema = (options?: {
  description?: string;
  enum?: string[];
  default?: string;
}): JsonSchema => ({
  type: 'string',
  description: options?.description,
  enum: options?.enum,
  default: options?.default
});

export const numberSchema = (options?: {
  description?: string;
  enum?: number[];
  default?: number;
}): JsonSchema => ({
  type: 'number',
  description: options?.description,
  enum: options?.enum,
  default: options?.default
});

export const booleanSchema = (options?: {
  description?: string;
  default?: boolean;
}): JsonSchema => ({
  type: 'boolean',
  description: options?.description,
  default: options?.default
});

export const objectSchema = (
  properties: Record<string, JsonSchema>,
  required?: string[],
  options?: {
    description?: string;
  }
): JsonSchema => ({
  type: 'object',
  properties,
  required,
  description: options?.description
});

export const arraySchema = (
  items: JsonSchema,
  options?: {
    description?: string;
  }
): JsonSchema => ({
  type: 'array',
  items,
  description: options?.description
});

// ========== Common Validators ==========

export const createStringValidator = (options?: {
  description?: string;
  enum?: string[];
  default?: string;
}): SchemaValidator<string> => {
  return createSchemaValidator(stringSchema(options), isString);
};

export const createNumberValidator = (options?: {
  description?: string;
  enum?: number[];
  default?: number;
}): SchemaValidator<number> => {
  return createSchemaValidator(numberSchema(options), isNumber);
};

export const createBooleanValidator = (options?: {
  description?: string;
  default?: boolean;
}): SchemaValidator<boolean> => {
  return createSchemaValidator(booleanSchema(options), isBoolean);
};

export const createObjectValidator = <T extends Record<string, unknown>>(
  properties: Record<string, JsonSchema>,
  required?: string[],
  typeGuard?: TypeGuard<T>
): SchemaValidator<T> => {
  const schema = objectSchema(properties, required);
  const guard = typeGuard || (isObject as TypeGuard<T>);
  return createSchemaValidator(schema, guard);
};

export const createArrayValidator = <T extends unknown[]>(
  items: JsonSchema,
  typeGuard?: TypeGuard<T>
): SchemaValidator<T> => {
  const schema = arraySchema(items);
  const guard = typeGuard || (isArray as TypeGuard<T>);
  return createSchemaValidator(schema, guard);
};

// ========== Composite Type Guards ==========

export const isOptional = <T>(guard: TypeGuard<T>): TypeGuard<T | undefined> => {
  return (value: unknown): value is T | undefined => {
    return value === undefined || guard(value);
  };
};

export const isNullable = <T>(guard: TypeGuard<T>): TypeGuard<T | null> => {
  return (value: unknown): value is T | null => {
    return value === null || guard(value);
  };
};

export const isUnion = <T>(...guards: TypeGuard<any>[]): TypeGuard<T> => {
  return (value: unknown): value is T => {
    return guards.some(guard => guard(value));
  };
};

export const hasProperty = <K extends string>(
  key: K
): TypeGuard<Record<K, unknown>> => {
  return (value: unknown): value is Record<K, unknown> => {
    return isObject(value) && key in value;
  };
};

export const hasProperties = <K extends string>(
  ...keys: K[]
): TypeGuard<Record<K, unknown>> => {
  return (value: unknown): value is Record<K, unknown> => {
    if (!isObject(value)) return false;
    return keys.every(key => key in value);
  };
};

// ========== Validation Utilities ==========

export const validateInput = <T>(
  validator: SchemaValidator<T>,
  data: unknown
): ValidationResult<T> => {
  return validator.validate(data);
};

export const validateOutput = <T>(
  validator: SchemaValidator<T>,
  data: unknown
): ValidationResult<T> => {
  return validator.validate(data);
};

export const assertValid = <T>(
  validator: SchemaValidator<T>,
  data: unknown
): T => {
  const result = validator.validate(data);
  
  if (!result.success) {
    throwValidationError(
      `Validation failed: ${result.errors?.join(', ')}`,
      result.errors || [],
      { data }
    );
  }
  
  return result.data!;
};

export const isValid = <T>(
  validator: SchemaValidator<T>,
  data: unknown
): data is T => {
  const result = validator.validate(data);
  return result.success;
};

// ========== Schema Transformation ==========

export const transformAndValidate = <T, U>(
  validator: SchemaValidator<U>,
  transformer: (input: T) => U,
  data: T
): ValidationResult<U> => {
  try {
    const transformed = transformer(data);
    return validator.validate(transformed);
  } catch (error) {
    return {
      success: false,
      errors: [`Transformation failed: ${error instanceof Error ? error.message : String(error)}`]
    };
  }
};

export const validateAndTransform = <T, U>(
  inputValidator: SchemaValidator<T>,
  transformer: (input: T) => U,
  data: unknown
): ValidationResult<U> => {
  const inputResult = inputValidator.validate(data);
  
  if (!inputResult.success) {
    return { success: false, errors: inputResult.errors };
  }
  
  try {
    const transformed = transformer(inputResult.data!);
    return { success: true, data: transformed };
  } catch (error) {
    return {
      success: false,
      errors: [`Transformation failed: ${error instanceof Error ? error.message : String(error)}`]
    };
  }
};

// ========== Example Schemas ==========

// Weather Query Schema
export interface WeatherQuery {
  location: string;
  units?: 'celsius' | 'fahrenheit';
  includeHourly?: boolean;
  [key: string]: unknown;
}

export const weatherQueryValidator = createObjectValidator<WeatherQuery>(
  {
    location: stringSchema({ description: 'City or location name' }),
    units: stringSchema({ 
      description: 'Temperature units',
      enum: ['celsius', 'fahrenheit'],
      default: 'celsius'
    }),
    includeHourly: booleanSchema({ 
      description: 'Include hourly forecast',
      default: false 
    })
  },
  ['location'],
  (value): value is WeatherQuery => {
    return isObject(value) && 
           hasProperty('location')(value) && 
           isString(value.location);
  }
);

// Weather Response Schema
export interface WeatherResponse {
  location: string;
  temperature: number;
  condition: string;
  humidity: number;
  forecast?: Array<{
    time: string;
    temperature: number;
    condition: string;
  }>;
  [key: string]: unknown;
}

export const weatherResponseValidator = createObjectValidator<WeatherResponse>(
  {
    location: stringSchema({ description: 'Location name' }),
    temperature: numberSchema({ description: 'Current temperature' }),
    condition: stringSchema({ description: 'Weather condition' }),
    humidity: numberSchema({ description: 'Humidity percentage' }),
    forecast: arraySchema(
      objectSchema({
        time: stringSchema({ description: 'Forecast time' }),
        temperature: numberSchema({ description: 'Forecast temperature' }),
        condition: stringSchema({ description: 'Forecast condition' })
      }, ['time', 'temperature', 'condition'])
    )
  },
  ['location', 'temperature', 'condition', 'humidity']
);

// ========== Schema Error Handling ==========

// Note: createValidationError is now imported from types.ts as a factory function

export const withSchemaValidation = <T extends unknown[], R>(
  fn: (...args: T) => R,
  inputValidators?: SchemaValidator<unknown>[],
  outputValidator?: SchemaValidator<R>
) => {
  return (...args: T): R => {
    // Validate inputs
    if (inputValidators) {
      for (let i = 0; i < inputValidators.length && i < args.length; i++) {
        const validation = inputValidators[i].validate(args[i]);
        if (!validation.success) {
          throwValidationError(
            `Input validation failed for argument ${i}`,
            validation.errors || [],
            { argument: i, value: args[i] }
          );
        }
      }
    }
    
    // Execute function
    const result = fn(...args);
    
    // Validate output
    if (outputValidator) {
      const validation = outputValidator.validate(result);
      if (!validation.success) {
        throwValidationError(
          'Output validation failed',
          validation.errors || [],
          { result }
        );
      }
    }
    
    return result;
  };
};