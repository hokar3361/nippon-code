import { EventEmitter } from 'events';
import { spawn, SpawnOptions } from 'child_process';
import * as fs from 'fs/promises';
import {
  DetailedTask,
  ExecutionResult,
  ExecutionStep,
  SafetyLevel,
  Command,
  CommandIntent,
  DryRunResult,
  LogEntry,
  ProgressUpdate
} from '../planning/interfaces';
import { TaskManager } from '../planning/task-manager';
import { ChatAgent, Session } from '../agents/chat';
import { v4 as uuidv4 } from 'uuid';

export class TaskExecutor extends EventEmitter {
  private taskManager: TaskManager;
  private chatAgent: ChatAgent;
  private session: Session;
  private executionLog: LogEntry[] = [];
  private currentTaskId: string | null = null;
  private abortController: AbortController | null = null;

  constructor(taskManager: TaskManager) {
    super();
    this.taskManager = taskManager;
    this.session = {
      id: 'executor-' + uuidv4(),
      name: 'Execution Session',
      messages: [],
      contexts: [],
      metadata: {
        createdAt: new Date(),
        updatedAt: new Date()
      }
    };
    this.chatAgent = new ChatAgent(this.session);
  }

  async executeTask(task: DetailedTask): Promise<ExecutionResult> {
    this.currentTaskId = task.id;
    this.executionLog = [];
    this.abortController = new AbortController();

    const startTime = Date.now();
    
    try {
      this.taskManager.updateTaskStatus(task.id, 'executing');
      this.log('info', `Starting execution of task: ${task.name}`);
      
      const results: any[] = [];
      let currentProgress = 0;
      const totalSteps = task.steps.length;

      for (const [index, step] of task.steps.entries()) {
        if (this.abortController.signal.aborted) {
          throw new Error('Task execution aborted');
        }

        currentProgress = Math.round(((index + 1) / totalSteps) * 100);
        
        this.emitProgress({
          taskId: task.id,
          progress: currentProgress,
          currentStep: step.description,
          message: `Executing step ${index + 1} of ${totalSteps}`,
          timestamp: new Date()
        });

        if (step.requiresApproval) {
          const approved = await this.requestApproval(step);
          if (!approved) {
            this.log('warning', `Step skipped due to lack of approval: ${step.description}`);
            continue;
          }
        }

        try {
          const stepResult = await this.executeStep(step);
          results.push(stepResult);
          this.log('info', `Step completed: ${step.description}`);
        } catch (stepError: any) {
          this.log('error', `Step failed: ${step.description}`, { error: stepError.message });
          
          if (task.rollbackStrategy?.automatic) {
            await this.executeRollback(task);
          }
          
          throw stepError;
        }
      }

      const duration = Date.now() - startTime;
      
      const result: ExecutionResult = {
        taskId: task.id,
        status: 'success',
        output: results,
        duration,
        executedAt: new Date(),
        logs: this.executionLog
      };

      this.taskManager.recordResult(result);
      return result;

    } catch (error: any) {
      const duration = Date.now() - startTime;
      
      const result: ExecutionResult = {
        taskId: task.id,
        status: 'failure',
        error: error,
        duration,
        executedAt: new Date(),
        logs: this.executionLog
      };

      this.taskManager.recordResult(result);
      return result;
      
    } finally {
      this.currentTaskId = null;
      this.abortController = null;
    }
  }

  async executeStep(step: ExecutionStep): Promise<any> {
    if (!step.command) {
      this.log('info', `Simulating step: ${step.description}`);
      return { simulated: true, description: step.description };
    }

    const command = this.parseCommand(step.command);
    
    const safetyCheck = await this.checkSafety(command, step.safetyLevel);
    if (!safetyCheck.safe) {
      throw new Error(`Safety check failed: ${safetyCheck.reason}`);
    }

    if (command.type === 'shell') {
      return await this.executeShellCommand(command);
    } else if (command.type === 'file') {
      return await this.executeFileOperation(command);
    } else {
      return await this.executeInternalCommand(command);
    }
  }

  private parseCommand(commandStr: string): Command {
    const parts = this.parseCommandArgs(commandStr.trim());
    const cmd = parts[0];
    const args = parts.slice(1);

    let type: 'shell' | 'file' | 'api' | 'internal' = 'shell';
    
    if (cmd.startsWith('file:')) {
      type = 'file';
    } else if (cmd.startsWith('api:')) {
      type = 'api';
    } else if (cmd.startsWith('internal:')) {
      type = 'internal';
    }

    return {
      id: `cmd-${Date.now()}`,
      type,
      command: type !== 'shell' ? cmd.split(':')[1] : cmd,
      args,
      workingDirectory: process.cwd()
    };
  }

  private parseCommandArgs(input: string): string[] {
    const args: string[] = [];
    let current = '';
    let inQuotes = false;
    let quoteChar = '';
    let escapeNext = false;

    for (let i = 0; i < input.length; i++) {
      const char = input[i];

      if (escapeNext) {
        current += char;
        escapeNext = false;
        continue;
      }

      if (char === '\\') {
        escapeNext = true;
        continue;
      }

      if (!inQuotes && (char === '"' || char === "'")) {
        inQuotes = true;
        quoteChar = char;
        continue;
      }

      if (inQuotes && char === quoteChar) {
        inQuotes = false;
        quoteChar = '';
        continue;
      }

      if (!inQuotes && char === ' ') {
        if (current) {
          args.push(current);
          current = '';
        }
        continue;
      }

      current += char;
    }

    if (current) {
      args.push(current);
    }

    return args;
  }

  private async checkSafety(command: Command, expectedLevel: SafetyLevel): Promise<{ safe: boolean; reason?: string }> {
    const intent = await this.analyzeCommandIntent(command);
    
    if (intent.estimatedRisk === 'forbidden') {
      return { safe: false, reason: 'Command is forbidden' };
    }

    if (intent.estimatedRisk === 'danger' && expectedLevel !== 'danger') {
      return { safe: false, reason: 'Command is too dangerous for the expected safety level' };
    }

    const dangerousPatterns = [
      /rm\s+-rf\s+\//,
      /format\s+/,
      /del\s+\/s\s+\/q/,
      />\/dev\/sda/
    ];

    const fullCommand = `${command.command} ${command.args?.join(' ') || ''}`;
    
    for (const pattern of dangerousPatterns) {
      if (pattern.test(fullCommand)) {
        return { safe: false, reason: 'Command matches dangerous pattern' };
      }
    }

    return { safe: true };
  }

  async analyzeCommandIntent(command: Command): Promise<CommandIntent> {
    const fullCommand = `${command.command} ${command.args?.join(' ') || ''}`;
    
    const prompt = `Analyze this command and determine its intent and safety level:
    Command: ${fullCommand}
    
    Return JSON with:
    {
      "purpose": "brief description of what the command does",
      "category": "read|write|execute|delete|network",
      "targetResources": ["list of files/resources affected"],
      "estimatedRisk": "safe|caution|danger|forbidden"
    }`;

    try {
      const response = await this.chatAgent.chat(prompt);
      const analysis = this.parseJSONResponse(response);
      
      return {
        purpose: analysis.purpose || 'Unknown',
        category: analysis.category || 'execute',
        targetResources: analysis.targetResources || [],
        estimatedRisk: analysis.estimatedRisk || 'caution'
      };
    } catch (error) {
      return {
        purpose: 'Unknown command',
        category: 'execute',
        targetResources: [],
        estimatedRisk: 'caution'
      };
    }
  }

  async dryRun(command: Command): Promise<DryRunResult> {
    const intent = await this.analyzeCommandIntent(command);
    
    const simulatedOutput = `[DRY RUN] Would execute: ${command.command} ${command.args?.join(' ') || ''}`;
    const estimatedChanges: string[] = [];
    const warnings: string[] = [];

    if (intent.category === 'write' || intent.category === 'delete') {
      estimatedChanges.push(...intent.targetResources.map(r => `Would modify: ${r}`));
    }

    if (intent.estimatedRisk === 'danger' || intent.estimatedRisk === 'forbidden') {
      warnings.push(`⚠️ High risk command: ${intent.purpose}`);
    }

    return {
      command,
      simulatedOutput,
      estimatedChanges,
      safetyLevel: intent.estimatedRisk,
      warnings
    };
  }

  private async executeShellCommand(command: Command): Promise<any> {
    return new Promise((resolve, reject) => {
      const options: SpawnOptions = {
        cwd: command.workingDirectory,
        env: { ...process.env, ...command.environment },
        shell: true
      };

      const child = spawn(command.command, command.args || [], options);
      
      let stdout = '';
      let stderr = '';

      child.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('error', (error) => {
        reject(error);
      });

      child.on('close', (code) => {
        if (code === 0) {
          resolve({ stdout, stderr, exitCode: code });
        } else {
          reject(new Error(`Command failed with exit code ${code}: ${stderr}`));
        }
      });

      // Setup abort handler with cleanup
      const abortHandler = () => {
        child.kill('SIGTERM');
      };
      
      if (this.abortController) {
        this.abortController.signal.addEventListener('abort', abortHandler);
      }

      // Cleanup listener on completion
      child.on('exit', () => {
        if (this.abortController) {
          this.abortController.signal.removeEventListener('abort', abortHandler);
        }
      });
    });
  }

  private async executeFileOperation(command: Command): Promise<any> {
    const operation = command.command;
    const [target, ...rest] = command.args || [];

    switch (operation) {
      case 'read':
        return await fs.readFile(target, 'utf-8');
      
      case 'write': {
        const content = rest.join(' ');
        await fs.writeFile(target, content);
        return { written: true, file: target };
      }
      
      case 'delete':
        await fs.unlink(target);
        return { deleted: true, file: target };
      
      case 'exists':
        try {
          await fs.access(target);
          return { exists: true, file: target };
        } catch {
          return { exists: false, file: target };
        }
      
      default:
        throw new Error(`Unknown file operation: ${operation}`);
    }
  }

  private async executeInternalCommand(command: Command): Promise<any> {
    return {
      executed: true,
      command: command.command,
      args: command.args,
      timestamp: new Date()
    };
  }

  private async requestApproval(step: ExecutionStep): Promise<boolean> {
    this.emit('approval:required', {
      step,
      taskId: this.currentTaskId
    });

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        resolve(false);
      }, 30000);

      this.once('approval:response', (approved: boolean) => {
        clearTimeout(timeout);
        resolve(approved);
      });
    });
  }

  private async executeRollback(task: DetailedTask): Promise<void> {
    if (!task.rollbackStrategy) return;

    this.log('warning', 'Executing rollback strategy');
    
    for (const step of task.rollbackStrategy.steps) {
      try {
        const command = this.parseCommand(step);
        await this.executeShellCommand(command);
        this.log('info', `Rollback step completed: ${step}`);
      } catch (error: any) {
        this.log('error', `Rollback step failed: ${step}`, { error: error.message });
      }
    }
  }

  abort(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.log('warning', 'Task execution aborted by user');
    }
  }

  private log(level: LogEntry['level'], message: string, metadata?: any): void {
    const entry: LogEntry = {
      timestamp: new Date(),
      level,
      message,
      metadata
    };
    
    this.executionLog.push(entry);
    this.emit('log', entry);
  }

  private emitProgress(update: ProgressUpdate): void {
    this.taskManager.emitProgress(update);
    this.emit('progress', update);
  }

  private parseJSONResponse(response: string): any {
    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
      return {};
    } catch {
      return {};
    }
  }
}