import {
  ElicitationRequest,
  ElicitationResponse,
  ElicitationSchema,
  JAFError,
} from './types.js';
import { createElicitationRequest, validateElicitationResponse } from './elicitation.js';

/**
 * Special error thrown when elicitation is needed
 * This will be caught by the engine and converted to an interruption
 */
export class ElicitationInterruptionError extends Error {
  constructor(
    public readonly request: ElicitationRequest,
    public readonly state: any,
    public readonly config: any
  ) {
    super('Elicitation required');
    this.name = 'ElicitationInterruptionError';
  }
}
// We'll store the current tool context globally during tool execution
let currentToolContext: any = null;

export function setElicitationContext(context: any): void {
  currentToolContext = context;
}

export function clearElicitationContext(): void {
  currentToolContext = null;
}

function getCurrentToolContext(): any {
  if (!currentToolContext) {
    throw new Error('elicit() can only be called from within a tool execution context');
  }
  return currentToolContext;
}

/**
 * Elicit structured information from the user during tool execution
 * This function can only be called from within a tool's execute function
 */
export async function elicit(
  message: string,
  requestedSchema: ElicitationSchema,
  metadata?: Record<string, any>
): Promise<Record<string, any>> {
  const context = getCurrentToolContext();
  const { config, state } = context;

  if (!config.elicitationProvider) {
    throw new Error('Elicitation provider is not configured');
  }

  const request = createElicitationRequest(message, requestedSchema, metadata);

  // Store the request for the provider
  config.elicitationProvider.createElicitation(request);

  // Emit elicitation request event
  config.onEvent?.({
    type: 'elicitation_request',
    data: {
      request,
      agentName: state.currentAgentName,
      traceId: state.traceId,
      runId: state.runId,
    },
  });

  // Throw interruption error - this will be caught by the engine and converted to an interruption
  throw new ElicitationInterruptionError(request, state, config);
}

/**
 * Convenience functions for common elicitation patterns
 */
export const Elicit = {
  /**
   * Request simple text input from user
   */
  async text(
    message: string,
    options: {
      title?: string;
      description?: string;
      minLength?: number;
      maxLength?: number;
      required?: boolean;
    } = {}
  ): Promise<string> {
    const schema: ElicitationSchema = {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          title: options.title || 'Text Input',
          description: options.description || message,
          minLength: options.minLength,
          maxLength: options.maxLength,
        },
      },
      required: options.required !== false ? ['text'] : [],
    };

    const result = await elicit(message, schema);
    return result.text || '';
  },

  /**
   * Request user confirmation (yes/no)
   */
  async confirm(message: string): Promise<boolean> {
    const schema: ElicitationSchema = {
      type: 'object',
      properties: {
        confirmed: {
          type: 'boolean',
          title: 'Confirmation',
          description: message,
          default: false,
        },
      },
      required: ['confirmed'],
    };

    const result = await elicit(message, schema);
    return Boolean(result.confirmed);
  },

  /**
   * Request user to choose from a list of options
   */
  async choice(
    message: string,
    choices: readonly string[],
    options: {
      title?: string;
      choiceLabels?: readonly string[];
    } = {}
  ): Promise<string> {
    const schema: ElicitationSchema = {
      type: 'object',
      properties: {
        choice: {
          type: 'string',
          title: options.title || 'Selection',
          description: message,
          enum: choices,
          enumNames: options.choiceLabels,
        },
      },
      required: ['choice'],
    };

    const result = await elicit(message, schema);
    return result.choice;
  },

  /**
   * Request contact information
   */
  async contactInfo(message: string = 'Please provide your contact information'): Promise<{
    name: string;
    email: string;
    phone?: string;
  }> {
    const schema: ElicitationSchema = {
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

    const result = await elicit(message, schema);
    return {
      name: result.name,
      email: result.email,
      phone: result.phone,
    };
  },

  /**
   * Request a number input
   */
  async number(
    message: string,
    options: {
      title?: string;
      description?: string;
      minimum?: number;
      maximum?: number;
      integer?: boolean;
    } = {}
  ): Promise<number> {
    const schema: ElicitationSchema = {
      type: 'object',
      properties: {
        number: {
          type: options.integer ? 'integer' : 'number',
          title: options.title || 'Number Input',
          description: options.description || message,
          minimum: options.minimum,
          maximum: options.maximum,
        },
      },
      required: ['number'],
    };

    const result = await elicit(message, schema);
    return result.number;
  },
};