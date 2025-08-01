import { FAFError } from './types.js';

export class FAFErrorHandler {
  static format(error: FAFError): string {
    switch (error._tag) {
      case 'MaxTurnsExceeded':
        return `Maximum turns exceeded: ${error.turns} turns completed`;
      
      case 'ModelBehaviorError':
        return `Model behavior error: ${error.detail}`;
      
      case 'DecodeError': {
        const issues = error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ');
        return `Decode error: ${issues}`;
      }
      
      case 'InputGuardrailTripwire':
        return `Input guardrail triggered: ${error.reason}`;
      
      case 'OutputGuardrailTripwire':
        return `Output guardrail triggered: ${error.reason}`;
      
      case 'ToolCallError':
        return `Tool call error in ${error.tool}: ${error.detail}`;
      
      case 'HandoffError':
        return `Handoff error: ${error.detail}`;
      
      case 'AgentNotFound':
        return `Agent not found: ${error.agentName}`;
      
      default:
        return `Unknown error: ${JSON.stringify(error)}`;
    }
  }

  static isRetryable(error: FAFError): boolean {
    switch (error._tag) {
      case 'ModelBehaviorError':
      case 'ToolCallError':
        return true;
      
      case 'MaxTurnsExceeded':
      case 'DecodeError':
      case 'InputGuardrailTripwire':
      case 'OutputGuardrailTripwire':
      case 'HandoffError':
      case 'AgentNotFound':
        return false;
      
      default:
        return false;
    }
  }

  static getSeverity(error: FAFError): 'low' | 'medium' | 'high' | 'critical' {
    switch (error._tag) {
      case 'ModelBehaviorError':
      case 'ToolCallError':
        return 'medium';
      
      case 'DecodeError':
        return 'high';
      
      case 'MaxTurnsExceeded':
        return 'low';
      
      case 'InputGuardrailTripwire':
      case 'OutputGuardrailTripwire':
        return 'high';
      
      case 'HandoffError':
      case 'AgentNotFound':
        return 'critical';
      
      default:
        return 'medium';
    }
  }
}

export function createFAFError(tag: FAFError['_tag'], details: any): FAFError {
  switch (tag) {
    case 'MaxTurnsExceeded':
      return { _tag: tag, turns: details.turns };
    case 'ModelBehaviorError':
      return { _tag: tag, detail: details.detail || details };
    case 'DecodeError':
      return { _tag: tag, errors: details.errors || [] };
    case 'InputGuardrailTripwire':
      return { _tag: tag, reason: details.reason || details };
    case 'OutputGuardrailTripwire':
      return { _tag: tag, reason: details.reason || details };
    case 'ToolCallError':
      return { _tag: tag, tool: details.tool, detail: details.detail };
    case 'HandoffError':
      return { _tag: tag, detail: details.detail || details };
    case 'AgentNotFound':
      return { _tag: tag, agentName: details.agentName || details };
    default:
      throw new Error(`Unknown error tag: ${tag}`);
  }
}