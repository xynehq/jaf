"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.makeLiteLLMProvider = void 0;
const openai_1 = __importDefault(require("openai"));
const makeLiteLLMProvider = (baseURL, apiKey = "anything") => {
    const client = new openai_1.default({
        baseURL,
        apiKey,
        dangerouslyAllowBrowser: true
    });
    return {
        async getCompletion(state, agent, config) {
            const model = config.modelOverride ?? agent.modelConfig?.name ?? "gpt-4o";
            const systemMessage = {
                role: "system",
                content: agent.instructions(state)
            };
            const messages = [
                systemMessage,
                ...state.messages.map(convertMessage)
            ];
            const tools = agent.tools?.map(t => ({
                type: "function",
                function: {
                    name: t.schema.name,
                    description: t.schema.description,
                    parameters: zodSchemaToJsonSchema(t.schema.parameters),
                },
            }));
            const lastMessage = state.messages[state.messages.length - 1];
            const isAfterToolCall = lastMessage?.role === 'tool';
            const requestParams = {
                model,
                messages,
                temperature: agent.modelConfig?.temperature,
                max_tokens: agent.modelConfig?.maxTokens,
                tools: tools && tools.length > 0 ? tools : undefined,
                tool_choice: (tools && tools.length > 0) ? (isAfterToolCall ? "auto" : undefined) : undefined,
                response_format: agent.outputCodec ? { type: "json_object" } : undefined,
            };
            const resp = await client.chat.completions.create(requestParams);
            return resp.choices[0];
        },
    };
};
exports.makeLiteLLMProvider = makeLiteLLMProvider;
function convertMessage(msg) {
    switch (msg.role) {
        case 'user':
            return {
                role: 'user',
                content: msg.content
            };
        case 'assistant':
            return {
                role: 'assistant',
                content: msg.content,
                tool_calls: msg.tool_calls
            };
        case 'tool':
            return {
                role: 'tool',
                content: msg.content,
                tool_call_id: msg.tool_call_id
            };
        default:
            throw new Error(`Unknown message role: ${msg.role}`);
    }
}
function zodSchemaToJsonSchema(zodSchema) {
    if (zodSchema._def?.typeName === 'ZodObject') {
        const properties = {};
        const required = [];
        for (const [key, value] of Object.entries(zodSchema._def.shape())) {
            properties[key] = zodSchemaToJsonSchema(value);
            if (!value.isOptional()) {
                required.push(key);
            }
        }
        return {
            type: 'object',
            properties,
            required: required.length > 0 ? required : undefined,
            additionalProperties: false
        };
    }
    if (zodSchema._def?.typeName === 'ZodString') {
        const schema = { type: 'string' };
        if (zodSchema._def.description) {
            schema.description = zodSchema._def.description;
        }
        return schema;
    }
    if (zodSchema._def?.typeName === 'ZodNumber') {
        return { type: 'number' };
    }
    if (zodSchema._def?.typeName === 'ZodBoolean') {
        return { type: 'boolean' };
    }
    if (zodSchema._def?.typeName === 'ZodArray') {
        return {
            type: 'array',
            items: zodSchemaToJsonSchema(zodSchema._def.type)
        };
    }
    if (zodSchema._def?.typeName === 'ZodOptional') {
        return zodSchemaToJsonSchema(zodSchema._def.innerType);
    }
    if (zodSchema._def?.typeName === 'ZodEnum') {
        return {
            type: 'string',
            enum: zodSchema._def.values
        };
    }
    return { type: 'string', description: 'Unsupported schema type' };
}
