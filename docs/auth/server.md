# Server Endpoints and Events

JAF exposes endpoints and SSE streams to drive interactive authentication.

Endpoints
- `POST /chat`: standard chat API; if a tool requires auth, the outcome will be `interrupted` with a `tool_auth` interruption.
- `POST /auth/submit`: submit the full callback URL after the user authorizes.
  - Body:
    - `conversationId`: string
    - `sessionId`: string
    - `toolCallId`: string
    - `authResponseUri`: string (the full redirected URL including `code` and `state`)
    - `redirectUri` (optional): must match what you used when sending the user to the provider
  - Response: `{ success: true }` on success.

SSE Streams
- `GET /auth/stream`: emits auth-related events for UIs.
  - `auth_required`:
    - `conversationId`, `sessionId`, `toolCallId`, `toolName`
    - `schemeType`: `apiKey | http | oauth2 | openidconnect`
    - `authorizationUrl?`: A provider URL to open (append your `redirect_uri`)
    - `scopes?`: string[]
  - `auth_response_received`:
    - `conversationId`, `sessionId`, `toolCallId`

Interruption Payload
- When a tool pauses for auth, `/chat` responds with:

```json
{
  "success": true,
  "data": {
    "outcome": {
      "status": "interrupted",
      "interruptions": [
        {
          "type": "tool_auth",
          "toolCall": { "id": "...", "type": "function", "function": { "name": "...", "arguments": "..." } },
          "sessionId": "...",
          "auth": {
            "authKey": "auth:...",
            "schemeType": "oauth2",
            "authorizationUrl": "https://.../authorize?response_type=code...",
            "scopes": ["openid", "profile", "email"]
          }
        }
      ]
    }
  }
}
```

Client Flow Summary
1) Call `/chat`; detect `tool_auth` interruption.
2) Open `authorizationUrl` with your `redirect_uri` appended (must be pre-registered).
3) Capture the redirected callback URL.
4) POST `/auth/submit` with the callback URL.
5) Call `/chat` again to resume; the framework exchanges the code for tokens and retries the tool.

