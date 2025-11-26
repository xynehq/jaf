/**
 * JAF ADK Layer - Schema Validation Tests
 */

import {
  createSchemaValidator,
  validateAgainstJsonSchema,
  isString,
  isNumber,
  isBoolean,
  isObject,
  isArray,
  isNull,
  isUndefined,
  stringSchema,
  numberSchema,
  booleanSchema,
  objectSchema,
  arraySchema,
  createStringValidator,
  createNumberValidator,
  createBooleanValidator,
  createObjectValidator,
  createArrayValidator,
  isOptional,
  isNullable,
  isUnion,
  hasProperty,
  hasProperties,
  validateInput,
  validateOutput,
  assertValid,
  isValid,
  transformAndValidate,
  validateAndTransform,
  weatherQueryValidator,
  weatherResponseValidator,
  createValidationError,
  withSchemaValidation
} from '../schemas/index.js';

import { JsonSchema, ValidationResult } from '../types.js';

describe('Schema Validation', () => {
  describe('Schema Validator Creation', () => {
    test('createSchemaValidator should create validator', () => {
      const schema: JsonSchema = {
        type: 'string',
        description: 'A string value'
      };
      
      const validator = createSchemaValidator(schema, isString);
      
      expect(validator.schema).toEqual(schema);
      expect(typeof validator.validate).toBe('function');
    });

    test('createSchemaValidator should validate correct data', () => {
      const validator = createSchemaValidator(stringSchema(), isString);
      const result = validator.validate('hello');
      
      expect(result.success).toBe(true);
      expect(result.data).toBe('hello');
    });

    test('createSchemaValidator should reject incorrect data', () => {
      const validator = createSchemaValidator(stringSchema(), isString);
      const result = validator.validate(123);
      
      expect(result.success).toBe(false);
      expect(result.errors).toContain('Data does not match expected type');
    });
  });

  describe('JSON Schema Validation', () => {
    test('validateAgainstJsonSchema should validate string type', () => {
      const schema: JsonSchema = { type: 'string' };
      
      const validResult = validateAgainstJsonSchema('hello', schema);
      expect(validResult.success).toBe(true);
      
      const invalidResult = validateAgainstJsonSchema(123, schema);
      expect(invalidResult.success).toBe(false);
      expect(invalidResult.errors).toContain('Expected type string, got number');
    });

    test('validateAgainstJsonSchema should validate number type', () => {
      const schema: JsonSchema = { type: 'number' };
      
      const validResult = validateAgainstJsonSchema(42, schema);
      expect(validResult.success).toBe(true);
      
      const invalidResult = validateAgainstJsonSchema('42', schema);
      expect(invalidResult.success).toBe(false);
    });

    test('validateAgainstJsonSchema should validate boolean type', () => {
      const schema: JsonSchema = { type: 'boolean' };
      
      const validResult = validateAgainstJsonSchema(true, schema);
      expect(validResult.success).toBe(true);
      
      const invalidResult = validateAgainstJsonSchema('true', schema);
      expect(invalidResult.success).toBe(false);
    });

    test('validateAgainstJsonSchema should validate object type', () => {
      const schema: JsonSchema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
          age: { type: 'number' }
        },
        required: ['name']
      };
      
      const validResult = validateAgainstJsonSchema(
        { name: 'John', age: 30 },
        schema
      );
      expect(validResult.success).toBe(true);
      
      const missingRequiredResult = validateAgainstJsonSchema(
        { age: 30 },
        schema
      );
      expect(missingRequiredResult.success).toBe(false);
      expect(missingRequiredResult.errors).toContain('Missing required property: name');
      
      const wrongTypeResult = validateAgainstJsonSchema(
        { name: 'John', age: 'thirty' },
        schema
      );
      expect(wrongTypeResult.success).toBe(false);
      expect(wrongTypeResult.errors?.some(e => e.includes("Property 'age'"))).toBe(true);
    });

    test('validateAgainstJsonSchema should validate array type', () => {
      const schema: JsonSchema = {
        type: 'array',
        items: { type: 'string' }
      };
      
      const validResult = validateAgainstJsonSchema(['a', 'b', 'c'], schema);
      expect(validResult.success).toBe(true);
      
      const invalidItemResult = validateAgainstJsonSchema(['a', 123, 'c'], schema);
      expect(invalidItemResult.success).toBe(false);
      expect(invalidItemResult.errors?.some(e => e.includes('Item 1'))).toBe(true);
    });

    test('validateAgainstJsonSchema should validate enum values', () => {
      const schema: JsonSchema = {
        type: 'string',
        enum: ['red', 'green', 'blue']
      };
      
      const validResult = validateAgainstJsonSchema('red', schema);
      expect(validResult.success).toBe(true);
      
      const invalidResult = validateAgainstJsonSchema('yellow', schema);
      expect(invalidResult.success).toBe(false);
      expect(invalidResult.errors).toContain('Value must be one of: red, green, blue');
    });
  });

  describe('Type Guards', () => {
    test('isString should validate strings', () => {
      expect(isString('hello')).toBe(true);
      expect(isString(123)).toBe(false);
      expect(isString(null)).toBe(false);
      expect(isString(undefined)).toBe(false);
    });

    test('isNumber should validate numbers', () => {
      expect(isNumber(42)).toBe(true);
      expect(isNumber(3.14)).toBe(true);
      expect(isNumber('42')).toBe(false);
      expect(isNumber(null)).toBe(false);
    });

    test('isBoolean should validate booleans', () => {
      expect(isBoolean(true)).toBe(true);
      expect(isBoolean(false)).toBe(true);
      expect(isBoolean('true')).toBe(false);
      expect(isBoolean(1)).toBe(false);
    });

    test('isObject should validate objects', () => {
      expect(isObject({})).toBe(true);
      expect(isObject({ a: 1 })).toBe(true);
      expect(isObject([])).toBe(false);
      expect(isObject(null)).toBe(false);
      expect(isObject('object')).toBe(false);
    });

    test('isArray should validate arrays', () => {
      expect(isArray([])).toBe(true);
      expect(isArray([1, 2, 3])).toBe(true);
      expect(isArray({})).toBe(false);
      expect(isArray('array')).toBe(false);
    });

    test('isNull should validate null', () => {
      expect(isNull(null)).toBe(true);
      expect(isNull(undefined)).toBe(false);
      expect(isNull('')).toBe(false);
      expect(isNull(0)).toBe(false);
    });

    test('isUndefined should validate undefined', () => {
      expect(isUndefined(undefined)).toBe(true);
      expect(isUndefined(null)).toBe(false);
      expect(isUndefined('')).toBe(false);
      expect(isUndefined(0)).toBe(false);
    });
  });

  describe('Schema Builders', () => {
    test('stringSchema should create string schema', () => {
      const schema = stringSchema({
        description: 'A name',
        enum: ['john', 'jane'],
        default: 'john'
      });
      
      expect(schema.type).toBe('string');
      expect(schema.description).toBe('A name');
      expect(schema.enum).toEqual(['john', 'jane']);
      expect(schema.default).toBe('john');
    });

    test('numberSchema should create number schema', () => {
      const schema = numberSchema({
        description: 'An age',
        enum: [18, 21, 65],
        default: 18
      });
      
      expect(schema.type).toBe('number');
      expect(schema.description).toBe('An age');
      expect(schema.enum).toEqual([18, 21, 65]);
      expect(schema.default).toBe(18);
    });

    test('booleanSchema should create boolean schema', () => {
      const schema = booleanSchema({
        description: 'Is active',
        default: true
      });
      
      expect(schema.type).toBe('boolean');
      expect(schema.description).toBe('Is active');
      expect(schema.default).toBe(true);
    });

    test('objectSchema should create object schema', () => {
      const schema = objectSchema(
        {
          name: stringSchema(),
          age: numberSchema()
        },
        ['name'],
        { description: 'A person' }
      );
      
      expect(schema.type).toBe('object');
      expect(schema.properties).toBeDefined();
      expect(schema.required).toEqual(['name']);
      expect(schema.description).toBe('A person');
    });

    test('arraySchema should create array schema', () => {
      const schema = arraySchema(
        stringSchema(),
        { description: 'A list of names' }
      );
      
      expect(schema.type).toBe('array');
      expect(schema.items).toBeDefined();
      expect(schema.description).toBe('A list of names');
    });
  });

  describe('Common Validators', () => {
    test('createStringValidator should create string validator', () => {
      const validator = createStringValidator({
        enum: ['red', 'green', 'blue']
      });
      
      const validResult = validator.validate('red');
      expect(validResult.success).toBe(true);
      
      const invalidResult = validator.validate('yellow');
      expect(invalidResult.success).toBe(false);
    });

    test('createNumberValidator should create number validator', () => {
      const validator = createNumberValidator();
      
      const validResult = validator.validate(42);
      expect(validResult.success).toBe(true);
      
      const invalidResult = validator.validate('42');
      expect(invalidResult.success).toBe(false);
    });

    test('createBooleanValidator should create boolean validator', () => {
      const validator = createBooleanValidator();
      
      const validResult = validator.validate(true);
      expect(validResult.success).toBe(true);
      
      const invalidResult = validator.validate('true');
      expect(invalidResult.success).toBe(false);
    });

    test('createObjectValidator should create object validator', () => {
      interface Person {
        name: string;
        age: number;
        active?: boolean;
        [key: string]: unknown;
      }
      
      const validator = createObjectValidator<Person>(
        {
          name: stringSchema(),
          age: numberSchema(),
          active: booleanSchema()
        },
        ['name', 'age']
      );
      
      const validResult = validator.validate({
        name: 'John',
        age: 30,
        active: true
      });
      expect(validResult.success).toBe(true);
      
      const missingResult = validator.validate({ name: 'John' });
      expect(missingResult.success).toBe(false);
    });

    test('createArrayValidator should create array validator', () => {
      const validator = createArrayValidator(stringSchema());
      
      const validResult = validator.validate(['a', 'b', 'c']);
      expect(validResult.success).toBe(true);
      
      const invalidResult = validator.validate([1, 2, 3]);
      expect(invalidResult.success).toBe(false);
    });
  });

  describe('Composite Type Guards', () => {
    test('isOptional should make type guard optional', () => {
      const optionalString = isOptional(isString);
      
      expect(optionalString('hello')).toBe(true);
      expect(optionalString(undefined)).toBe(true);
      expect(optionalString(123)).toBe(false);
    });

    test('isNullable should make type guard nullable', () => {
      const nullableString = isNullable(isString);
      
      expect(nullableString('hello')).toBe(true);
      expect(nullableString(null)).toBe(true);
      expect(nullableString(123)).toBe(false);
    });

    test('isUnion should create union type guard', () => {
      const stringOrNumber = isUnion(isString, isNumber);
      
      expect(stringOrNumber('hello')).toBe(true);
      expect(stringOrNumber(42)).toBe(true);
      expect(stringOrNumber(true)).toBe(false);
    });

    test('hasProperty should check for property existence', () => {
      const hasName = hasProperty('name');
      
      expect(hasName({ name: 'John' })).toBe(true);
      expect(hasName({ age: 30 })).toBe(false);
      expect(hasName('not-object')).toBe(false);
    });

    test('hasProperties should check for multiple properties', () => {
      const hasNameAndAge = hasProperties('name', 'age');
      
      expect(hasNameAndAge({ name: 'John', age: 30 })).toBe(true);
      expect(hasNameAndAge({ name: 'John' })).toBe(false);
      expect(hasNameAndAge({ age: 30 })).toBe(false);
    });
  });

  describe('Validation Utilities', () => {
    const stringValidator = createStringValidator();

    test('validateInput should validate input', () => {
      const result = validateInput(stringValidator, 'hello');
      expect(result.success).toBe(true);
      expect(result.data).toBe('hello');
    });

    test('validateOutput should validate output', () => {
      const result = validateOutput(stringValidator, 'world');
      expect(result.success).toBe(true);
      expect(result.data).toBe('world');
    });

    test('assertValid should return valid data', () => {
      const result = assertValid(stringValidator, 'hello');
      expect(result).toBe('hello');
    });

    test('assertValid should throw for invalid data', () => {
      expect(() => assertValid(stringValidator, 123)).toThrow('Validation failed');
    });

    test('isValid should check validity', () => {
      expect(isValid(stringValidator, 'hello')).toBe(true);
      expect(isValid(stringValidator, 123)).toBe(false);
    });
  });

  describe('Schema Transformation', () => {
    const stringValidator = createStringValidator();
    const numberValidator = createNumberValidator();

    test('transformAndValidate should transform then validate', () => {
      const transformer = (num: number) => num.toString();
      
      const result = transformAndValidate(
        stringValidator,
        transformer,
        42
      );
      
      expect(result.success).toBe(true);
      expect(result.data).toBe('42');
    });

    test('transformAndValidate should handle transformation errors', () => {
      const transformer = () => {
        throw new Error('Transform error');
      };
      
      const result = transformAndValidate(
        stringValidator,
        transformer,
        42
      );
      
      expect(result.success).toBe(false);
      expect(result.errors).toContain('Transformation failed: Transform error');
    });

    test('validateAndTransform should validate then transform', () => {
      const transformer = (str: string) => parseInt(str, 10);
      
      const result = validateAndTransform(
        stringValidator,
        transformer,
        '42'
      );
      
      expect(result.success).toBe(true);
      expect(result.data).toBe(42);
    });

    test('validateAndTransform should fail on invalid input', () => {
      const transformer = (str: string) => parseInt(str, 10);
      
      const result = validateAndTransform(
        stringValidator,
        transformer,
        123
      );
      
      expect(result.success).toBe(false);
    });
  });

  describe('Example Schemas', () => {
    test('weatherQueryValidator should validate weather queries', () => {
      const validQuery = {
        location: 'Tokyo',
        units: 'celsius',
        includeHourly: true
      };
      
      const result = weatherQueryValidator.validate(validQuery);
      expect(result.success).toBe(true);
      expect(result.data).toEqual(validQuery);
    });

    test('weatherQueryValidator should require location', () => {
      const invalidQuery = {
        units: 'celsius'
      };
      
      const result = weatherQueryValidator.validate(invalidQuery);
      expect(result.success).toBe(false);
    });

    test('weatherQueryValidator should validate units enum', () => {
      const invalidQuery = {
        location: 'Tokyo',
        units: 'kelvin'
      };
      
      const result = weatherQueryValidator.validate(invalidQuery);
      expect(result.success).toBe(false);
    });

    test('weatherResponseValidator should validate weather responses', () => {
      const validResponse = {
        location: 'Tokyo',
        temperature: 25,
        condition: 'sunny',
        humidity: 60,
        forecast: [
          {
            time: '2024-01-01T12:00:00Z',
            temperature: 26,
            condition: 'partly cloudy'
          }
        ]
      };
      
      const result = weatherResponseValidator.validate(validResponse);
      expect(result.success).toBe(true);
      expect(result.data).toEqual(validResponse);
    });

    test('weatherResponseValidator should require core fields', () => {
      const invalidResponse = {
        location: 'Tokyo',
        temperature: 25
        // Missing condition and humidity
      };
      
      const result = weatherResponseValidator.validate(invalidResponse);
      expect(result.success).toBe(false);
    });
  });

  describe('Error Handling', () => {
    test('createValidationError should create ValidationError', () => {
      const error = createValidationError(
        'Validation failed',
        ['Field is required'],
        { field: 'test' }
      );
      
      expect(error.message).toBe('Validation failed');
      expect(error.errors).toEqual(['Field is required']);
      expect(error.context).toEqual({ field: 'test' });
      expect(error.code).toBe('VALIDATION_ERROR');
    });

    test('withSchemaValidation should validate inputs and outputs', () => {
      const stringValidator = createStringValidator();
      const numberValidator = createNumberValidator();
      
      const testFunction = (input: string): number => {
        return parseInt(input, 10);
      };
      
      const validatedFunction = withSchemaValidation(
        testFunction,
        [stringValidator],
        numberValidator
      );
      
      // Valid case
      const result = validatedFunction('42');
      expect(result).toBe(42);
      
      // Invalid input
      expect(() => validatedFunction(123 as any)).toThrow('Input validation failed');
      
      // Invalid output (mock a function that returns wrong type)
      const badFunction = () => 'not-a-number' as any;
      const validatedBadFunction = withSchemaValidation(
        badFunction,
        [],
        numberValidator
      );
      
      expect(() => validatedBadFunction()).toThrow('Output validation failed');
    });

    test('schema validation should handle complex nested errors', () => {
      const complexSchema = objectSchema({
        users: arraySchema(
          objectSchema({
            name: stringSchema(),
            age: numberSchema()
          }, ['name', 'age'])
        )
      }, ['users']);
      
      const validator = createSchemaValidator(complexSchema, isObject);
      
      const invalidData = {
        users: [
          { name: 'John', age: 30 },
          { name: 'Jane' }, // Missing age
          { age: 25 } // Missing name
        ]
      };
      
      const result = validator.validate(invalidData);
      expect(result.success).toBe(false);
      expect(result.errors?.length).toBeGreaterThan(0);
    });
  });

  describe('Edge Cases', () => {
    test('should handle empty schemas', () => {
      const emptySchema: JsonSchema = { type: 'object' };
      const result = validateAgainstJsonSchema({}, emptySchema);
      expect(result.success).toBe(true);
    });

    test('should handle deeply nested objects', () => {
      const deepSchema = objectSchema({
        level1: objectSchema({
          level2: objectSchema({
            level3: stringSchema()
          }, ['level3'])
        }, ['level2'])
      }, ['level1']);
      
      const validator = createSchemaValidator(deepSchema, isObject);
      
      const validData = {
        level1: {
          level2: {
            level3: 'deep value'
          }
        }
      };
      
      const result = validator.validate(validData);
      expect(result.success).toBe(true);
    });

    test('should handle arrays of complex objects', () => {
      const complexArraySchema = arraySchema(
        objectSchema({
          id: numberSchema(),
          tags: arraySchema(stringSchema())
        }, ['id'])
      );
      
      const validator = createSchemaValidator(complexArraySchema, isArray);
      
      const validData = [
        { id: 1, tags: ['tag1', 'tag2'] },
        { id: 2, tags: [] }
      ];
      
      const result = validator.validate(validData);
      expect(result.success).toBe(true);
    });

    test('should handle null and undefined appropriately', () => {
      // Test nullable type guard directly
      const nullableString = isNullable(isString);
      expect(nullableString('hello')).toBe(true);
      expect(nullableString(null)).toBe(true);
      expect(nullableString(undefined)).toBe(false);
      
      // Test optional type guard directly  
      const optionalString = isOptional(isString);
      expect(optionalString('hello')).toBe(true);
      expect(optionalString(undefined)).toBe(true);
      expect(optionalString(null)).toBe(false);
    });
  });
});