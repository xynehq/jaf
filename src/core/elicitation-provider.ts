import {
  ElicitationProvider,
  ElicitationRequest,
  ElicitationResponse,
  createElicitationRequestId,
} from './types.js';

/**
 * Simple in-memory elicitation provider that stores pending requests
 * and allows them to be responded to via the server API
 */
export class ServerElicitationProvider implements ElicitationProvider {
  private pendingRequests = new Map<string, ElicitationRequest>();
  private resolvers = new Map<string, (response: ElicitationResponse) => void>();
  private responses = new Map<string, ElicitationResponse>();

  async createElicitation(request: ElicitationRequest): Promise<ElicitationResponse> {
    // Check if we already have a response for this request
    const existingResponse = this.responses.get(request.id);
    if (existingResponse) {
      this.responses.delete(request.id);
      return existingResponse;
    }

    // Store the request as pending
    this.pendingRequests.set(request.id, request);

    // Return a promise that will be resolved when response is provided
    return new Promise<ElicitationResponse>((resolve) => {
      this.resolvers.set(request.id, resolve);
    });
  }

  /**
   * Provide a response to a pending elicitation request
   */
  respondToElicitation(response: ElicitationResponse): boolean {
    const resolver = this.resolvers.get(response.requestId);
    if (!resolver) {
      // Store the response for later
      this.responses.set(response.requestId, response);
      return false;
    }

    // Clean up and resolve
    this.resolvers.delete(response.requestId);
    this.pendingRequests.delete(response.requestId);
    resolver(response);
    return true;
  }

  /**
   * Get all pending elicitation requests
   */
  getPendingRequests(): ElicitationRequest[] {
    return Array.from(this.pendingRequests.values());
  }

  /**
   * Get a specific pending request by ID
   */
  getPendingRequest(requestId: string): ElicitationRequest | undefined {
    return this.pendingRequests.get(requestId);
  }

  /**
   * Cancel a pending request
   */
  cancelRequest(requestId: string): boolean {
    const resolver = this.resolvers.get(requestId);
    if (!resolver) {
      return false;
    }

    this.resolvers.delete(requestId);
    this.pendingRequests.delete(requestId);

    // Resolve with cancel action
    resolver({
      requestId: createElicitationRequestId(requestId),
      action: 'cancel',
    });

    return true;
  }

  /**
   * Clear all pending requests (useful for cleanup)
   */
  clearAllRequests(): void {
    // Cancel all pending requests
    for (const [requestId, resolver] of Array.from(this.resolvers.entries())) {
      resolver({
        requestId: createElicitationRequestId(requestId),
        action: 'cancel',
      });
    }

    this.pendingRequests.clear();
    this.resolvers.clear();
    this.responses.clear();
  }
}

/**
 * Create a server elicitation provider instance
 */
export function createServerElicitationProvider(): ServerElicitationProvider {
  return new ServerElicitationProvider();
}