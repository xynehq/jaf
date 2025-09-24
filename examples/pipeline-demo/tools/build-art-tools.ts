/**
 * Build & ART Pipeline Tools
 * 
 * These tools handle Jenkins integration, build monitoring, and artifact management
 */

import { z } from 'zod';
import type { Tool } from '../../../src/core/types';
import type { PipelineContext } from '../types';

// Dynamic imports for Node.js modules
const axios = require('axios');
const fs = require('fs');
const path = require('path');

export const triggerJenkinsJobTool: Tool<{
  ucsCommitId: string;
  ucsBranch: string;
  eulerCommitId: string;
  eulerBranch: string;
  connectorName: string;
  threadId?: string;
}, PipelineContext> = {
  schema: {
    name: 'trigger_jenkins_job',
    description: 'Trigger Jenkins job with the provided parameters',
    parameters: z.object({
      ucsCommitId: z.string().describe('UCS commit ID'),
      ucsBranch: z.string().describe('UCS branch name'),
      eulerCommitId: z.string().describe('Euler commit ID'),
      eulerBranch: z.string().describe('Euler branch name'),
      connectorName: z.string().describe('Connector name'),
      threadId: z.string().optional().describe('Slack thread ID for notifications')
    })
  },
  execute: async (args, context) => {
    const { ucsCommitId, ucsBranch, eulerCommitId, eulerBranch, connectorName, threadId } = args;
    const { jenkinsConfig } = context;
    
    console.log('=== Triggering Jenkins Job ===');
    console.log('Parameters:');
    console.log(`  UCS_COMMIT_ID: ${ucsCommitId}`);
    console.log(`  UCS_BRANCH: ${ucsBranch}`);
    console.log(`  EULER_COMMIT_ID: ${eulerCommitId}`);
    console.log(`  EULER_BRANCH: ${eulerBranch}`);
    console.log(`  CONNECTOR_NAME: ${connectorName}`);
    console.log(`  THREAD_ID: ${threadId}`);
    
    if (!ucsCommitId || !eulerCommitId || !connectorName) {
      throw new Error('Missing required parameters: UCS_COMMIT_ID, EULER_COMMIT_ID, CONNECTOR_NAME');
    }
    
    const params = new URLSearchParams({
      UCS_COMMIT_ID: ucsCommitId,
      UCS_BRANCH: ucsBranch,
      EULER_COMMIT_ID: eulerCommitId,
      EULER_BRANCH: eulerBranch,
      CONNECTOR_NAME: connectorName,
      THREAD_ID: threadId || ''
    });
    
    try {
      const response = await axios.post(
        `${jenkinsConfig.url}${jenkinsConfig.path}`,
        params,
        {
          auth: {
            username: jenkinsConfig.user,
            password: jenkinsConfig.token
          },
          timeout: 30000
        }
      );
      
      console.log(`HTTP Status Code: ${response.status}`);
      
      if (response.status === 200 || response.status === 201) {
        console.log('✅ Jenkins job triggered successfully!');
        if (response.data) {
          console.log('Response:', response.data);
        }
        
        // Send Slack notification on success
        if (threadId && context.slackConfig?.botToken) {
          const slackMessage = `🚀 Jenkins job triggered successfully for connector: ${connectorName}\n` +
                             `• UCS Branch: ${ucsBranch} (${ucsCommitId})\n` +
                             `• Euler Branch: ${eulerBranch} (${eulerCommitId})`;
          await sendSlackMessage(slackMessage, threadId, context);
        }
        
        return {
          success: true,
          status: response.status,
          data: response.data
        };
      } else {
        throw new Error(`Jenkins API returned status ${response.status}: ${response.data}`);
      }
      
    } catch (error: any) {
      console.log('❌ Failed to trigger Jenkins job');
      
      // Send Slack notification on failure
      if (threadId && context.slackConfig?.botToken) {
        const slackMessage = `❌ Failed to trigger Jenkins job for connector: ${connectorName}\n` +
                           `Error: ${error.message}`;
        await sendSlackMessage(slackMessage, threadId, context);
      }
      
      throw new Error(`Failed to trigger Jenkins job: ${error.message}`);
    }
  }
};

export const monitorBuildStatusTool: Tool<{
  jobPath: string;
  timeoutMinutes?: number;
}, PipelineContext> = {
  schema: {
    name: 'monitor_build_status',
    description: 'Monitor Jenkins build status until completion',
    parameters: z.object({
      jobPath: z.string().describe('Jenkins job path'),
      timeoutMinutes: z.number().optional().default(60).describe('Timeout in minutes')
    })
  },
  execute: async (args, context) => {
    const { jobPath, timeoutMinutes = 60 } = args;
    const { jenkinsConfig } = context;
    
    // Wait for job to start and get build number
    console.log('Waiting for job to start...');
    await new Promise(resolve => setTimeout(resolve, 10000)); // 10 second delay
    
    try {
      // Get the latest build number
      const jobApiUrl = `${jenkinsConfig.url}/${jobPath}/api/json`;
      const jobResponse = await axios.get(jobApiUrl, {
        auth: {
          username: jenkinsConfig.user,
          password: jenkinsConfig.token
        }
      });
      
      const buildNumber = jobResponse.data.lastBuild?.number;
      
      if (!buildNumber) {
        throw new Error('Failed to get build number');
      }
      
      console.log(`✓ Build started with number: ${buildNumber}`);
      console.log(`Build URL: ${jenkinsConfig.url}/${jobPath}/${buildNumber}`);
      
      // Monitor build progress
      console.log('Monitoring build progress...');
      const startTime = Date.now();
      const timeoutMs = timeoutMinutes * 60 * 1000;
      
      while (true) {
        if (Date.now() - startTime > timeoutMs) {
          throw new Error(`Build monitoring timed out after ${timeoutMinutes} minutes`);
        }
        
        const buildApiUrl = `${jenkinsConfig.url}/${jobPath}/${buildNumber}/api/json`;
        const buildResponse = await axios.get(buildApiUrl, {
          auth: {
            username: jenkinsConfig.user,
            password: jenkinsConfig.token
          }
        });
        
        const buildInfo = buildResponse.data;
        const building = buildInfo.building;
        const result = buildInfo.result;
        
        if (!building) {
          console.log(`✓ Build completed with result: ${result}`);
          return JSON.stringify({
            building: false,
            result,
            buildNumber,
            url: `${jenkinsConfig.url}/${jobPath}/${buildNumber}`,
            artifacts: buildInfo.artifacts || []
          });
        }
        
        console.log('Build in progress...');
        await new Promise(resolve => setTimeout(resolve, 10000)); // 10 second polling
      }
      
    } catch (error: any) {
      throw new Error(`Failed to monitor build status: ${error.message}`);
    }
  }
};

export const downloadArtifactsTool: Tool<{
  jobPath: string;
  buildNumber: number;
  outputDir: string;
}, PipelineContext> = {
  schema: {
    name: 'download_artifacts',
    description: 'Download Jenkins build artifacts',
    parameters: z.object({
      jobPath: z.string().describe('Jenkins job path'),
      buildNumber: z.number().describe('Build number'),
      outputDir: z.string().describe('Output directory for artifacts')
    })
  },
  execute: async (args, context) => {
    const { jobPath, buildNumber, outputDir } = args;
    const { jenkinsConfig } = context;
    
    console.log(`Downloading artifacts to: ${outputDir}`);
    
    try {
      // Create output directory
      const fs = await import('fs');
      if (!fs.existsSync(outputDir)) {
        await fs.promises.mkdir(outputDir, { recursive: true });
      }
      
      // Get list of artifacts
      const buildApiUrl = `${jenkinsConfig.url}/${jobPath}/${buildNumber}/api/json`;
      const buildResponse = await axios.get(buildApiUrl, {
        auth: {
          username: jenkinsConfig.user,
          password: jenkinsConfig.token
        }
      });
      
      const artifacts = buildResponse.data.artifacts || [];
      
      if (artifacts.length === 0) {
        console.log('No artifacts found');
        return {
          success: true,
          artifacts: [],
          message: 'No artifacts to download'
        };
      }
      
      const downloadedArtifacts: string[] = [];
      
      // Download each artifact
      for (const artifact of artifacts) {
        const artifactPath = artifact.relativePath;
        const artifactUrl = `${jenkinsConfig.url}/${jobPath}/${buildNumber}/artifact/${artifactPath}`;
        
        // Create directory structure
        const localPath = path.join(outputDir, artifactPath);
        const localDir = path.dirname(localPath);
        await fs.promises.mkdir(localDir, { recursive: true });
        
        console.log(`Downloading: ${artifactPath}`);
        
        // Download artifact
        const response = await axios.get(artifactUrl, {
          auth: {
            username: jenkinsConfig.user,
            password: jenkinsConfig.token
          },
          responseType: 'stream'
        });
        
        const writer = fs.createWriteStream(localPath);
        response.data.pipe(writer);
        
        await new Promise((resolve, reject) => {
          writer.on('finish', resolve);
          writer.on('error', reject);
        });
        
        console.log(`✓ Downloaded: ${artifactPath}`);
        downloadedArtifacts.push(localPath);
      }
      
      return JSON.stringify({
        success: true,
        artifacts: downloadedArtifacts,
        message: `Downloaded ${downloadedArtifacts.length} artifacts to ${outputDir}`
      });
      
    } catch (error: any) {
      throw new Error(`Failed to download artifacts: ${error.message}`);
    }
  }
};

export const sendSlackNotificationTool: Tool<{
  message: string;
  threadId?: string;
  channel?: string;
}, PipelineContext> = {
  schema: {
    name: 'send_slack_notification',
    description: 'Send a notification to Slack',
    parameters: z.object({
      message: z.string().describe('Message to send'),
      threadId: z.string().optional().describe('Thread ID for threaded messages'),
      channel: z.string().optional().describe('Channel ID (optional)')
    })
  },
  execute: async (args, context) => {
    const { message, threadId, channel } = args;
    return await sendSlackMessage(message, threadId, context, channel);
  }
};

export const fetchARTReportTool: Tool<{
  replayId: string;
  connectorName: string;
  outputDir?: string;
}, PipelineContext> = {
  schema: {
    name: 'fetch_art_report',
    description: 'Fetch ART report by triggering Jenkins job and downloading artifacts',
    parameters: z.object({
      replayId: z.string().describe('Replay ID for the ART report'),
      connectorName: z.string().describe('Connector name'),
      outputDir: z.string().optional().describe('Output directory for artifacts')
    })
  },
  execute: async (args, context) => {
    const { replayId, connectorName, outputDir = './artifacts' } = args;
    const { jenkinsConfig } = context;
    
    // Jenkins ART job configuration
    const artJobPath = 'job/SDK%20Pipelines/job/sdk-api-mocking/job/test-jenkins-art';
    
    console.log('=== Fetching ART Report ===');
    console.log(`  Replay ID: ${replayId}`);
    console.log(`  Connector Name: ${connectorName}`);
    console.log(`  Job URL: ${jenkinsConfig.url}/${artJobPath}`);
    
    try {
      // Step 1: Trigger Jenkins ART job
      console.log('Triggering Jenkins ART job...');
      const triggerParams = new URLSearchParams({
        REPLAY_ID: replayId,
        CONNECTOR_NAME: connectorName
      });
      
      const triggerResponse = await axios.post(
        `${jenkinsConfig.url}/${artJobPath}/buildWithParameters`,
        triggerParams,
        {
          auth: {
            username: jenkinsConfig.user,
            password: jenkinsConfig.token
          },
          timeout: 30000
        }
      );
      
      if (triggerResponse.status !== 201) {
        throw new Error(`Failed to trigger Jenkins job (HTTP ${triggerResponse.status})`);
      }
      
      console.log('✓ Jenkins ART job triggered successfully');
      
      // Step 2: Wait for job to start and get build number
      console.log('Waiting for job to start...');
      await new Promise(resolve => setTimeout(resolve, 10000));
      
      const jobApiUrl = `${jenkinsConfig.url}/${artJobPath}/api/json`;
      const jobResponse = await axios.get(jobApiUrl, {
        auth: {
          username: jenkinsConfig.user,
          password: jenkinsConfig.token
        }
      });
      
      const buildNumber = jobResponse.data.lastBuild?.number;
      if (!buildNumber) {
        throw new Error('Failed to get build number');
      }
      
      console.log(`✓ Build started with number: ${buildNumber}`);
      console.log(`Build URL: ${jenkinsConfig.url}/${artJobPath}/${buildNumber}`);
      
      // Step 3: Monitor build progress
      console.log('Monitoring build progress...');
      const startTime = Date.now();
      const timeoutMs = 20 * 60 * 1000; // 20 minutes timeout
      
      while (true) {
        if (Date.now() - startTime > timeoutMs) {
          throw new Error('Build monitoring timed out after 20 minutes');
        }
        
        const buildApiUrl = `${jenkinsConfig.url}/${artJobPath}/${buildNumber}/api/json`;
        const buildResponse = await axios.get(buildApiUrl, {
          auth: {
            username: jenkinsConfig.user,
            password: jenkinsConfig.token
          }
        });
        
        const buildInfo = buildResponse.data;
        const building = buildInfo.building;
        const result = buildInfo.result;
        
        if (!building) {
          console.log(`✓ Build completed with result: ${result}`);
          
          if (result !== 'SUCCESS') {
            console.log(`✗ Build failed with result: ${result}`);
            console.log(`Check build logs: ${jenkinsConfig.url}/${artJobPath}/${buildNumber}/console`);
            throw new Error(`Build failed with result: ${result}`);
          }
          break;
        }
        
        console.log('Build in progress...');
        await new Promise(resolve => setTimeout(resolve, 10000));
      }
      
      // Step 4: Create artifacts directory
      const artifactsDir = `${outputDir}_${replayId}_${connectorName}`;
      const fs = await import('fs');
      await fs.promises.mkdir(artifactsDir, { recursive: true });
      
      console.log(`Downloading artifacts to: ${artifactsDir}`);
      
      // Step 5: Get and download artifacts
      const buildApiUrl = `${jenkinsConfig.url}/${artJobPath}/${buildNumber}/api/json`;
      const buildResponse = await axios.get(buildApiUrl, {
        auth: {
          username: jenkinsConfig.user,
          password: jenkinsConfig.token
        }
      });
      
      const artifacts = buildResponse.data.artifacts || [];
      
      if (artifacts.length === 0) {
        console.log('No artifacts found');
        console.log('ℹ️  This is normal if:');
        console.log('   - The replay ID has not been processed yet');
        console.log('   - The ART job did not generate reports for this connector');
        console.log('   - The replay ID was for a different test type');
        return {
          success: true,
          message: 'ART job completed successfully but no artifacts were generated. This may be expected for this replay ID.',
          artifactsDir,
          downloadedArtifacts: [],
          artReportPath: null,
          buildNumber,
          buildUrl: `${jenkinsConfig.url}/${artJobPath}/${buildNumber}`
        };
      }
      
      const downloadedArtifacts: string[] = [];
      
      for (const artifact of artifacts) {
        const artifactPath = artifact.relativePath;
        const artifactUrl = `${jenkinsConfig.url}/${artJobPath}/${buildNumber}/artifact/${artifactPath}`;
        
        // Create directory structure
        const path = await import('path');
        const localPath = path.join(artifactsDir, artifactPath);
        const localDir = path.dirname(localPath);
        await fs.promises.mkdir(localDir, { recursive: true });
        
        console.log(`Downloading: ${artifactPath}`);
        
        // Download artifact
        const response = await axios.get(artifactUrl, {
          auth: {
            username: jenkinsConfig.user,
            password: jenkinsConfig.token
          },
          responseType: 'stream'
        });
        
        const writer = fs.createWriteStream(localPath);
        response.data.pipe(writer);
        
        await new Promise((resolve, reject) => {
          writer.on('finish', resolve);
          writer.on('error', reject);
        });
        
        console.log(`✓ Downloaded: ${artifactPath}`);
        downloadedArtifacts.push(localPath);
      }
      
      console.log('');
      console.log('🎉 ART report fetch completed successfully!');
      console.log(`📁 Artifacts downloaded to: ${artifactsDir}`);
      console.log(`🔗 Build URL: ${jenkinsConfig.url}/${artJobPath}/${buildNumber}`);
      console.log('');
      console.log('Contents of artifacts directory:');
      
      // List directory contents
      const files = await fs.promises.readdir(artifactsDir, { withFileTypes: true });
      for (const file of files) {
        const stats = await fs.promises.stat(`${artifactsDir}/${file.name}`);
        console.log(`  ${file.isDirectory() ? 'd' : '-'} ${file.name} (${stats.size} bytes)`);
      }
      
      // Look for ART report file specifically
      const artReportPath = downloadedArtifacts.find(path => 
        path.includes('art_report') && path.includes('.json')
      );
      
      return {
        success: true,
        artifactsDir,
        downloadedArtifacts,
        artReportPath: artReportPath || null,
        buildNumber,
        buildUrl: `${jenkinsConfig.url}/${artJobPath}/${buildNumber}`,
        message: `Successfully downloaded ${downloadedArtifacts.length} artifacts`
      };
      
    } catch (error: any) {
      console.log('❌ Failed to fetch ART report');
      throw new Error(`Failed to fetch ART report: ${error.message}`);
    }
  }
};

// Helper function for Slack messaging
async function sendSlackMessage(
  message: string, 
  threadId?: string, 
  context?: PipelineContext, 
  channelOverride?: string
): Promise<string> {
  const botToken = context?.slackConfig?.botToken;
  
  if (!botToken || !threadId) {
    console.log(`⚠️ Slack messaging skipped - missing bot token or thread_id`);
    return 'Slack messaging skipped';
  }
  
  try {
    // Parse thread_id format: C07NR5NQV7H:1758532559.784109
    let channel: string;
    let threadTs: string | undefined;
    
    if (threadId.includes(':')) {
      [channel, threadTs] = threadId.split(':', 2);
    } else {
      channel = channelOverride || threadId;
      threadTs = undefined;
    }
    
    const payload: any = {
      channel,
      text: message
    };
    
    if (threadTs) {
      payload.thread_ts = threadTs;
    }
    
    const response = await axios.post(
      'https://slack.com/api/chat.postMessage',
      payload,
      {
        headers: {
          'Authorization': `Bearer ${botToken}`,
          'Content-Type': 'application/json'
        },
        timeout: 30000
      }
    );
    
    if (response.status === 200 && response.data.ok) {
      console.log(`✅ Slack message sent to thread ${threadId}`);
      return `✅ Slack message sent successfully`;
    } else {
      console.log(`❌ Slack API error: ${response.data.error || 'Unknown error'}`);
      return `❌ Slack API error: ${response.data.error || 'Unknown error'}`;
    }
    
  } catch (error: any) {
    console.log(`❌ Error sending Slack message: ${error.message}`);
    return `❌ Error sending Slack message: ${error.message}`;
  }
}