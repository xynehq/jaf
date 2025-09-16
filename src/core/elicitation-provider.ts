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
  private responseTimestamps = new Map<string, number>();
  private cleanupInterval: NodeJS.Timeout | null = null;

  // Default TTL for orphaned responses: 5 minutes
  private readonly RESPONSE_TTL_MS = 5 * 60 * 1000;

  async createElicitation(request: ElicitationRequest): Promise<ElicitationResponse> {
    // Start cleanup if not already running
    this.startPeriodicCleanup();

    // Check if we already have a response for this request
    const existingResponse = this.responses.get(request.id);
    if (existingResponse) {
      this.responses.delete(request.id);
      this.responseTimestamps.delete(request.id);
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
      // Store the response for later with timestamp for TTL
      this.responses.set(response.requestId, response);
      this.responseTimestamps.set(response.requestId, Date.now());
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
   * Clean up expired orphaned responses
   */
  private cleanupExpiredResponses(): void {
    const now = Date.now();
    const expiredIds: string[] = [];

    for (const [requestId, timestamp] of Array.from(this.responseTimestamps.entries())) {
      if (now - timestamp > this.RESPONSE_TTL_MS) {
        expiredIds.push(requestId);
      }
    }

    for (const requestId of expiredIds) {
      this.responses.delete(requestId);
      this.responseTimestamps.delete(requestId);
    }

    if (expiredIds.length > 0) {
      console.log(`[ElicitationProvider] Cleaned up ${expiredIds.length} expired orphaned responses`);
    }
  }

  /**
   * Start periodic cleanup of expired responses
   */
  private startPeriodicCleanup(): void {
    if (this.cleanupInterval) {
      return; // Already running
    }

    // Run cleanup every minute
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpiredResponses();

      // Stop cleanup if no responses to monitor
      if (this.responses.size === 0 && this.resolvers.size === 0) {
        this.stopPeriodicCleanup();
      }
    }, 60 * 1000);
  }

  /**
   * Stop periodic cleanup
   */
  private stopPeriodicCleanup(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  /**
   * Clear all pending requests (useful for cleanup)
   */
  clearAllRequests(): void {
    // Stop periodic cleanup
    this.stopPeriodicCleanup();

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
    this.responseTimestamps.clear();
  }
}

/**
 * Create a server elicitation provider instance
 */
export function createServerElicitationProvider(): ServerElicitationProvider {
  return new ServerElicitationProvider();
}