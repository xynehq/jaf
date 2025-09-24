/**
 * Type definitions for the JAF CI/CD Pipeline
 */

export interface PipelineContext {
  connectorName: string;
  pipelineType: 'migration' | 'art';
  replayId?: string;
  threadId?: string;
  repositoryPaths?: {
    ucsPath: string;
    eulerPath: string;
    outputDir: string;
  };
  jenkinsConfig: JenkinsConfig;
  slackConfig: SlackConfig;
  previousPrompts?: {
    euler?: string;
    ucs?: string;
  };
}

export interface JenkinsConfig {
  url: string;
  path: string;
  user: string;
  token: string;
}

export interface SlackConfig {
  botToken: string;
  channelId?: string;
}

export interface ConnectorConfig {
  connectorName: string;
  eulerBranch?: string;
  ucsBranch?: string;
  replayId?: string;
}

export interface MigrationResult {
  connectorName: string;
  ucsCommitId: string;
  eulerCommitId: string;
  branchName: string;
  buildStatus: 'pending' | 'success' | 'failed';
  jenkinsJobId?: string;
}

export interface ARTReport {
  connectorName: string;
  replayId: string;
  sessions: ARTSession[];
  summary: {
    totalSessions: number;
    failedSessions: number;
    successRate: number;
  };
}

export interface ARTSession {
  sessionId: string;
  status: 'passed' | 'failed';
  errors: ARTError[];
  apiCalls: APICall[];
}

export interface ARTError {
  type: 'request_mismatch' | 'response_mismatch' | 'timeout' | 'unknown';
  message: string;
  expectedValue?: any;
  actualValue?: any;
  apiTag?: string;
  url?: string;
}

export interface APICall {
  apiTag: string;
  url: string;
  method: string;
  requestPayload: any;
  expectedResponse: any;
  actualResponse?: any;
  status: 'matched' | 'mismatched' | 'missing';
}

export interface BuildResult {
  success: boolean;
  output: string;
  stderr: string;
  exitCode: number;
}

export interface JenkinsJobStatus {
  building: boolean;
  result: 'SUCCESS' | 'FAILURE' | 'ABORTED' | 'UNSTABLE' | null;
  buildNumber: number;
  url: string;
  artifacts?: JenkinsArtifact[];
}

export interface JenkinsArtifact {
  relativePath: string;
  displayPath: string;
  fileName: string;
}

export interface PipelineStatus {
  runId: string;
  connectorName: string;
  stage: 'codegen' | 'build' | 'art' | 'evaluation' | 'completed' | 'failed';
  progress: number; // 0-100
  startTime: Date;
  endTime?: Date;
  error?: string;
  results?: {
    migration?: MigrationResult;
    artReport?: ARTReport;
    enhancedPrompts?: {
      euler: string;
      ucs: string;
    };
  };
}

export interface GeneratePromptParams {
  connector: string;
  eulerPath: string;
  ucsPath: string;
  output: string;
  upiFlowsOnly?: boolean;
}

export interface XyneExecutionResult {
  success: boolean;
  output: string;
  error?: string;
  filesModified: string[];
}

export interface SlackMessage {
  channel: string;
  text: string;
  threadTs?: string;
}

export interface SlackResponse {
  ok: boolean;
  ts: string;
  threadId?: string;
  error?: string;
}