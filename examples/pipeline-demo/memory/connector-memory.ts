/**
 * Connector Memory Provider
 * 
 * Manages memory and state persistence for the pipeline
 */

import type { MemoryProvider } from '../../../src/memory/types';
import type { PipelineStatus, ConnectorConfig, MigrationResult, ARTReport } from '../types';

export class ConnectorMemoryProvider implements MemoryProvider {
  private conversations = new Map<string, any>();
  private pipelineStatus = new Map<string, PipelineStatus>();
  private connectorConfigs = new Map<string, ConnectorConfig>();
  private migrationResults = new Map<string, MigrationResult>();
  private artReports = new Map<string, ARTReport>();

  async getConversation(conversationId: string): Promise<any | null> {
    return this.conversations.get(conversationId) || null;
  }

  async saveConversation(conversationId: string, conversation: any): Promise<void> {
    this.conversations.set(conversationId, conversation);
  }

  async deleteConversation(conversationId: string): Promise<void> {
    this.conversations.delete(conversationId);
  }

  async listConversations(limit?: number, offset?: number): Promise<any[]> {
    const conversations = Array.from(this.conversations.values());
    const start = offset || 0;
    const end = limit ? start + limit : conversations.length;
    return conversations.slice(start, end);
  }

  // Pipeline-specific methods
  async getPipelineStatus(runId: string): Promise<PipelineStatus | null> {
    return this.pipelineStatus.get(runId) || null;
  }

  async savePipelineStatus(runId: string, status: PipelineStatus): Promise<void> {
    this.pipelineStatus.set(runId, {
      ...status,
      startTime: status.startTime || new Date(),
      endTime: status.stage === 'completed' || status.stage === 'failed' ? new Date() : status.endTime
    });
  }

  async updatePipelineProgress(runId: string, stage: PipelineStatus['stage'], progress: number): Promise<void> {
    const existingStatus = this.pipelineStatus.get(runId);
    if (existingStatus) {
      existingStatus.stage = stage;
      existingStatus.progress = progress;
      if (stage === 'completed' || stage === 'failed') {
        existingStatus.endTime = new Date();
      }
      this.pipelineStatus.set(runId, existingStatus);
    }
  }

  async getConnectorConfig(connectorName: string): Promise<ConnectorConfig | null> {
    return this.connectorConfigs.get(connectorName) || null;
  }

  async saveConnectorConfig(connectorName: string, config: ConnectorConfig): Promise<void> {
    this.connectorConfigs.set(connectorName, config);
  }

  async getMigrationResult(runId: string): Promise<MigrationResult | null> {
    return this.migrationResults.get(runId) || null;
  }

  async saveMigrationResult(runId: string, result: MigrationResult): Promise<void> {
    this.migrationResults.set(runId, result);
  }

  async getARTReport(connectorName: string, replayId: string): Promise<ARTReport | null> {
    const key = `${connectorName}-${replayId}`;
    return this.artReports.get(key) || null;
  }

  async saveARTReport(connectorName: string, replayId: string, report: ARTReport): Promise<void> {
    const key = `${connectorName}-${replayId}`;
    this.artReports.set(key, report);
  }

  async getAllPipelineStatuses(): Promise<PipelineStatus[]> {
    return Array.from(this.pipelineStatus.values());
  }

  async getActivePipelines(): Promise<PipelineStatus[]> {
    return Array.from(this.pipelineStatus.values()).filter(
      status => status.stage !== 'completed' && status.stage !== 'failed'
    );
  }

  async cleanup(): Promise<void> {
    // Clean up old completed pipelines (older than 24 hours)
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    for (const [runId, status] of this.pipelineStatus.entries()) {
      if (status.endTime && status.endTime < oneDayAgo) {
        this.pipelineStatus.delete(runId);
        this.migrationResults.delete(runId);
      }
    }
  }
}