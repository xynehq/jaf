import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import {
  ElicitationRequest,
  ElicitationResponse,
  ElicitationRequestId,
  ElicitationSchema,
  ElicitationPropertySchema,
  ElicitationStringSchema,
  ElicitationChoiceSchema,
  ElicitationNumberSchema,
  ElicitationBooleanSchema,
  createElicitationRequestId,
} from './types.js';

/**
 * Helper function to create an elicitation request
 */
export function createElicitationRequest(
  message: string,
  requestedSchema: ElicitationSchema,
  metadata?: Record<string, any>
): ElicitationRequest {
  return {
    id: createElicitationRequestId(uuidv4()),
    message,
    requestedSchema,
    metadata,
  };
}

/**
 * Validates an elicitation response against the requested schema
 */
export function validateElicitationResponse(
  response: ElicitationResponse,
  request: ElicitationRequest
): { isValid: true; data: Record<string, any> } | { isValid: false; errors: string[] } {
  if (response.action !== 'accept' || !response.content) {
    return { isValid: true, data: {} };
  }

  const errors: string[] = [];
  const { properties, required = [] } = request.requestedSchema;

  // Check required fields
  for (const field of required) {
    if (!(field in response.content)) {
      errors.push(`Required field '${field}' is missing`);
    }
  }

  // Validate each property
  for (const [key, value] of Object.entries(response.content)) {
    const schema = properties[key];
    if (!schema) {
      continue; // Allow extra fields
    }

    const validation = validateProperty(key, value, schema);
    if (validation.isValid === false) {
      errors.push(...validation.errors);
    }
  }

  if (errors.length > 0) {
    return { isValid: false, errors };
  }

  return { isValid: true, data: response.content };
}

function validateProperty(
  fieldName: string,
  value: any,
  schema: ElicitationPropertySchema
): { isValid: true } | { isValid: false; errors: string[] } {
  const errors: string[] = [];

  switch (schema.type) {
    case 'string':
      if (typeof value !== 'string') {
        errors.push(`Field '${fieldName}' must be a string`);
        break;
      }

      // Check for enum first (choice type)
      if ('enum' in schema) {
        const choiceSchema = schema as ElicitationChoiceSchema;
        if (choiceSchema.enum && !choiceSchema.enum.includes(value)) {
          errors.push(`Field '${fieldName}' must be one of: ${choiceSchema.enum.join(', ')}`);
        }
      } else {
        // Regular string schema
        const stringSchema = schema as ElicitationStringSchema;

        if (stringSchema.minLength && value.length < stringSchema.minLength) {
          errors.push(`Field '${fieldName}' must be at least ${stringSchema.minLength} characters`);
        }

        if (stringSchema.maxLength && value.length > stringSchema.maxLength) {
          errors.push(`Field '${fieldName}' must be at most ${stringSchema.maxLength} characters`);
        }

        if (stringSchema.pattern) {
          try {
            const regex = new RegExp(stringSchema.pattern);
            if (!regex.test(value)) {
              errors.push(`Field '${fieldName}' does not match the required pattern`);
            }
          } catch {
            // Invalid regex pattern - skip validation
          }
        }

        if (stringSchema.format) {
          const formatValidation = validateFormat(value, stringSchema.format);
          if (!formatValidation.isValid) {
            errors.push(`Field '${fieldName}' has invalid ${stringSchema.format} format`);
          }
        }
      }
      break;

    case 'number':
    case 'integer': {
      if (typeof value !== 'number') {
        errors.push(`Field '${fieldName}' must be a number`);
        break;
      }

      const numberSchema = schema as ElicitationNumberSchema;

      if (numberSchema.type === 'integer' && !Number.isInteger(value)) {
        errors.push(`Field '${fieldName}' must be an integer`);
      }

      if (numberSchema.minimum !== undefined && value < numberSchema.minimum) {
        errors.push(`Field '${fieldName}' must be at least ${numberSchema.minimum}`);
      }

      if (numberSchema.maximum !== undefined && value > numberSchema.maximum) {
        errors.push(`Field '${fieldName}' must be at most ${numberSchema.maximum}`);
      }
      break;
    }

    case 'boolean':
      if (typeof value !== 'boolean') {
        errors.push(`Field '${fieldName}' must be a boolean`);
      }
      break;
  }

  return errors.length > 0 ? { isValid: false, errors } : { isValid: true };
}

function validateFormat(value: string, format: string): { isValid: boolean } {
  switch (format) {
    case 'email':
      return { isValid: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) };
    case 'uri':
      try {
        new URL(value);
        return { isValid: true };
      } catch {
        return { isValid: false };
      }
    case 'date':
      return { isValid: /^\d{4}-\d{2}-\d{2}$/.test(value) && !isNaN(Date.parse(value)) };
    case 'date-time':
      return { isValid: !isNaN(Date.parse(value)) };
    default:
      return { isValid: true };
  }
}

/**
 * Helper to create common elicitation schemas
 */
export const ElicitationSchemas = {
  /**
   * Simple text input
   */
  text(options: {
    title?: string;
    description?: string;
    required?: boolean;
    minLength?: number;
    maxLength?: number;
    default?: string;
  } = {}): ElicitationSchema {
    return {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          title: options.title || 'Text',
          description: options.description || 'Please enter text',
          minLength: options.minLength,
          maxLength: options.maxLength,
          default: options.default,
        },
      },
      required: options.required !== false ? ['text'] : [],
    };
  },

  /**
   * Contact information form
   */
  contactInfo(): ElicitationSchema {
    return {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          title: 'Full Name',
          description: 'Your full name',
          minLength: 1,
        },
        email: {
          type: 'string',
          title: 'Email Address',
          description: 'Your email address',
          format: 'email',
        },
        phone: {
          type: 'string',
          title: 'Phone Number',
          description: 'Your phone number (optional)',
        },
      },
      required: ['name', 'email'],
    };
  },

  /**
   * Yes/No confirmation
   */
  confirmation(message?: string): ElicitationSchema {
    return {
      type: 'object',
      properties: {
        confirmed: {
          type: 'boolean',
          title: 'Confirmation',
          description: message || 'Please confirm your choice',
          default: false,
        },
      },
      required: ['confirmed'],
    };
  },

  /**
   * Multiple choice selection
   */
  choice(options: {
    title?: string;
    description?: string;
    choices: readonly string[];
    choiceLabels?: readonly string[];
    required?: boolean;
  }): ElicitationSchema {
    return {
      type: 'object',
      properties: {
        choice: {
          type: 'string',
          title: options.title || 'Selection',
          description: options.description || 'Please make a selection',
          enum: options.choices,
          enumNames: options.choiceLabels,
        },
      },
      required: options.required !== false ? ['choice'] : [],
    };
  },
};