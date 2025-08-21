import { EventEmitter } from 'events';
import { spawn, SpawnOptions } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import {
  Command,
  CommandIntent,
  Permission,
  DryRunResult,
  SandboxResult,
  Snapshot,
  SnapshotId
} from '../planning/interfaces';
import { ChatAgent, Session } from '../agents/chat';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';

interface PermissionCache {
  [command: string]: Permission;
}

interface ExecutionOptions {
  dryRun?: boolean;
  sandbox?: boolean;
  timeout?: number;
  workingDirectory?: string;
  environment?: Record<string, string>;
}

export class CommandExecutor extends EventEmitter {
  private chatAgent: ChatAgent;
  private session: Session;
  private permissionCache: PermissionCache = {};
  private snapshots: Map<string, Snapshot> = new Map();
  private executionHistory: Command[] = [];
  private abortController: AbortController | null = null;

  constructor() {
    super();
    
    this.session = {
      id: 'cmd-executor-' + uuidv4(),
      name: 'Command Executor Session',
      messages: [],
      contexts: [],
      metadata: {
        createdAt: new Date(),
        updatedAt: new Date()
      }
    };
    this.chatAgent = new ChatAgent(this.session);
  }

  async execute(
    commandStr: string,
    options: ExecutionOptions = {}
  ): Promise<any> {
    const command = this.parseCommand(commandStr);
    
    // Check permissions
    const permission = await this.checkPermission(command);
    if (permission === 'no' || permission === 'never') {
      throw new Error(`Command execution denied: ${commandStr}`);
    }

    // Analyze intent and safety
    const intent = await this.analyzeIntent(command);
    const safetyCheck = await this.validateSafety(command, intent);
    
    if (!safetyCheck.safe) {
      if (options.dryRun) {
        return await this.dryRun(command);
      }
      throw new Error(`Safety check failed: ${safetyCheck.reason}`);
    }

    // Execute based on options
    if (options.dryRun) {
      return await this.dryRun(command);
    }

    if (options.sandbox) {
      return await this.sandboxExecute(command, options);
    }

    // Take snapshot before dangerous operations
    if (intent.estimatedRisk === 'danger' || intent.category === 'write' || intent.category === 'delete') {
      await this.createSnapshots(intent.targetResources);
    }

    try {
      const result = await this.executeCommand(command, options);
      this.executionHistory.push(command);
      this.emit('command:executed', { command, result });
      return result;
    } catch (error) {
      this.emit('command:failed', { command, error });
      
      // Offer rollback for dangerous operations
      if (intent.estimatedRisk === 'danger') {
        this.emit('rollback:available', {
          command,
          snapshots: intent.targetResources.map(r => this.snapshots.get(r))
        });
      }
      
      throw error;
    }
  }

  async checkPermission(command: Command): Promise<Permission> {
    const cacheKey = `${command.command} ${command.args?.join(' ') || ''}`;
    
    // Check cache first
    if (this.permissionCache[cacheKey]) {
      const cached = this.permissionCache[cacheKey];
      if (cached === 'always' || cached === 'never') {
        return cached === 'always' ? 'yes' : 'no';
      }
    }

    // Ask for permission
    const permission = await this.askPermission(command);
    
    // Cache the decision
    if (permission === 'always' || permission === 'never') {
      this.permissionCache[cacheKey] = permission;
    }

    return permission;
  }

  private async askPermission(command: Command): Promise<Permission> {
    return new Promise((resolve) => {
      this.emit('permission:required', {
        command: `${command.command} ${command.args?.join(' ') || ''}`,
        callback: (permission: Permission) => resolve(permission)
      });

      // Default to 'no' after timeout
      setTimeout(() => resolve('no'), 30000);
    });
  }

  async analyzeIntent(command: Command): Promise<CommandIntent> {
    const fullCommand = `${command.command} ${command.args?.join(' ') || ''}`;
    
    // Quick categorization for common commands
    const quickCategories = this.quickCategorize(fullCommand);
    if (quickCategories) {
      return quickCategories;
    }

    // Use LLM for complex analysis
    const prompt = `Analyze this command for intent and safety:
    Command: ${fullCommand}
    Working Directory: ${command.workingDirectory || process.cwd()}
    
    Return JSON:
    {
      "purpose": "brief description",
      "category": "read|write|execute|delete|network",
      "targetResources": ["affected files/resources"],
      "estimatedRisk": "safe|caution|danger|forbidden",
      "alternatives": ["safer alternative commands if risky"]
    }`;

    try {
      const response = await this.chatAgent.chat(prompt);
      const analysis = this.parseJSONResponse(response);
      
      return {
        purpose: analysis.purpose || 'Execute command',
        category: analysis.category || 'execute',
        targetResources: analysis.targetResources || [],
        estimatedRisk: analysis.estimatedRisk || 'caution',
        alternatives: analysis.alternatives
      } as CommandIntent;
    } catch (error) {
      return {
        purpose: 'Execute command',
        category: 'execute',
        targetResources: [],
        estimatedRisk: 'caution'
      };
    }
  }

  private quickCategorize(command: string): CommandIntent | null {
    // Safe read operations
    if (/^(ls|dir|cat|type|echo|pwd|git status|git log)/.test(command)) {
      return {
        purpose: 'Read information',
        category: 'read',
        targetResources: [],
        estimatedRisk: 'safe'
      };
    }

    // Write operations
    if (/^(touch|mkdir|git add|git commit|npm install)/.test(command)) {
      return {
        purpose: 'Create or modify files',
        category: 'write',
        targetResources: [],
        estimatedRisk: 'caution'
      };
    }

    // Dangerous operations
    if (/^(rm -rf|del \/s|format|dd if=)/.test(command)) {
      return {
        purpose: 'Destructive operation',
        category: 'delete',
        targetResources: [],
        estimatedRisk: 'danger'
      };
    }

    return null;
  }

  async validateSafety(
    command: Command,
    intent: CommandIntent
  ): Promise<{ safe: boolean; reason?: string }> {
    // Forbidden patterns
    const forbiddenPatterns = [
      /rm\s+-rf\s+\/($|\s)/,  // rm -rf /
      /format\s+[cC]:/,        // format C:
      /:(){ :|:& };:/,         // Fork bomb
      />\/dev\/sda/,           // Overwrite disk
      /dd\s+if=.*of=\/dev\//   // dd to device
    ];

    const fullCommand = `${command.command} ${command.args?.join(' ') || ''}`;
    
    for (const pattern of forbiddenPatterns) {
      if (pattern.test(fullCommand)) {
        return { 
          safe: false, 
          reason: 'Command matches forbidden pattern - this could cause system damage'
        };
      }
    }

    // Check intent risk level
    if (intent.estimatedRisk === 'forbidden') {
      return { 
        safe: false, 
        reason: 'Command classified as forbidden by safety analysis'
      };
    }

    // Require explicit confirmation for dangerous operations
    if (intent.estimatedRisk === 'danger') {
      const confirmed = await this.confirmDangerousOperation(command, intent);
      if (!confirmed) {
        return { 
          safe: false, 
          reason: 'Dangerous operation cancelled by user'
        };
      }
    }

    return { safe: true };
  }

  private async confirmDangerousOperation(
    command: Command,
    intent: CommandIntent
  ): Promise<boolean> {
    return new Promise((resolve) => {
      this.emit('danger:confirmation', {
        command: `${command.command} ${command.args?.join(' ') || ''}`,
        intent,
        callback: (confirmed: boolean) => resolve(confirmed)
      });

      // Default to false after timeout
      setTimeout(() => resolve(false), 30000);
    });
  }

  async dryRun(command: Command): Promise<DryRunResult> {
    const intent = await this.analyzeIntent(command);
    
    const simulatedOutput = `[DRY RUN] Would execute: ${command.command} ${command.args?.join(' ') || ''}
Working Directory: ${command.workingDirectory || process.cwd()}
Environment: ${JSON.stringify(command.environment || {})}`;

    const estimatedChanges: string[] = [];
    const warnings: string[] = [];

    // Estimate changes based on intent
    if (intent.category === 'write') {
      estimatedChanges.push(...intent.targetResources.map(r => `Would create/modify: ${r}`));
    } else if (intent.category === 'delete') {
      estimatedChanges.push(...intent.targetResources.map(r => `Would delete: ${r}`));
    }

    // Add warnings for risky operations
    if (intent.estimatedRisk === 'danger') {
      warnings.push(`⚠️ HIGH RISK: ${intent.purpose}`);
    }
    if (intent.estimatedRisk === 'caution') {
      warnings.push(`⚠️ CAUTION: ${intent.purpose}`);
    }

    // Suggest alternatives if available
    if (intent.alternatives && intent.alternatives.length > 0) {
      warnings.push(`💡 Consider alternatives: ${intent.alternatives.join(', ')}`);
    }

    return {
      command,
      simulatedOutput,
      estimatedChanges,
      safetyLevel: intent.estimatedRisk,
      warnings
    };
  }

  async sandboxExecute(
    command: Command,
    options: ExecutionOptions = {}
  ): Promise<SandboxResult> {
    const startTime = Date.now();
    const sandboxDir = path.join(process.cwd(), '.sandbox', uuidv4());
    
    try {
      // Create sandbox directory
      await fs.mkdir(sandboxDir, { recursive: true });
      
      // Execute in sandbox
      const result = await this.executeCommand({
        ...command,
        workingDirectory: sandboxDir
      }, options);

      // Analyze sandbox changes
      const filesModified = await this.detectFileChanges(sandboxDir);
      
      return {
        command,
        output: result.stdout || '',
        exitCode: result.exitCode || 0,
        filesModified,
        resourcesAccessed: [], // Would need syscall tracing for full list
        duration: Date.now() - startTime
      };
    } finally {
      // Cleanup sandbox
      try {
        await fs.rm(sandboxDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  private async executeCommand(
    command: Command,
    options: ExecutionOptions = {}
  ): Promise<any> {
    return new Promise((resolve, reject) => {
      const spawnOptions: SpawnOptions = {
        cwd: options.workingDirectory || command.workingDirectory || process.cwd(),
        env: { ...process.env, ...command.environment, ...options.environment },
        shell: true,
        timeout: options.timeout
      };

      const child = spawn(command.command, command.args || [], spawnOptions);
      
      let stdout = '';
      let stderr = '';

      child.stdout?.on('data', (data) => {
        stdout += data.toString();
        this.emit('output', { type: 'stdout', data: data.toString() });
      });

      child.stderr?.on('data', (data) => {
        stderr += data.toString();
        this.emit('output', { type: 'stderr', data: data.toString() });
      });

      child.on('error', (error) => {
        reject(error);
      });

      child.on('close', (code) => {
        resolve({ 
          stdout, 
          stderr, 
          exitCode: code,
          duration: options.timeout
        });
      });

      // Handle abort
      this.abortController = new AbortController();
      this.abortController.signal.addEventListener('abort', () => {
        child.kill('SIGTERM');
        reject(new Error('Command execution aborted'));
      });
    });
  }

  private async createSnapshots(resources: string[]): Promise<void> {
    for (const resource of resources) {
      try {
        const content = await fs.readFile(resource, 'utf-8');
        const hash = crypto.createHash('sha256').update(content).digest('hex');
        
        const snapshotId: SnapshotId = {
          id: uuidv4(),
          file: resource,
          createdAt: new Date()
        };

        const snapshot: Snapshot = {
          id: snapshotId,
          content,
          metadata: {
            size: content.length,
            hash,
            reason: 'Pre-execution backup'
          }
        };

        this.snapshots.set(resource, snapshot);
      } catch {
        // Skip files that can't be read
      }
    }
  }

  async rollback(snapshotId: string): Promise<void> {
    for (const [file, snapshot] of this.snapshots.entries()) {
      if (snapshot.id.id === snapshotId) {
        await fs.writeFile(file, snapshot.content);
        this.emit('rollback:completed', { file, snapshotId });
        return;
      }
    }
    throw new Error(`Snapshot not found: ${snapshotId}`);
  }

  private async detectFileChanges(directory: string): Promise<string[]> {
    const changes: string[] = [];
    
    try {
      const files = await fs.readdir(directory, { withFileTypes: true });
      
      for (const file of files) {
        const fullPath = path.join(directory, file.name);
        if (file.isDirectory()) {
          const subChanges = await this.detectFileChanges(fullPath);
          changes.push(...subChanges);
        } else {
          changes.push(fullPath);
        }
      }
    } catch {
      // Ignore errors
    }

    return changes;
  }

  private parseCommand(commandStr: string): Command {
    const parts = this.parseCommandLine(commandStr);
    const cmd = parts[0];
    const args = parts.slice(1);

    return {
      id: `cmd-${uuidv4()}`,
      type: 'shell',
      command: cmd,
      args,
      workingDirectory: process.cwd()
    };
  }

  private parseCommandLine(input: string): string[] {
    const args: string[] = [];
    let current = '';
    let inQuotes = false;
    let quoteChar = '';

    for (let i = 0; i < input.length; i++) {
      const char = input[i];

      if (!inQuotes && (char === '"' || char === "'")) {
        inQuotes = true;
        quoteChar = char;
      } else if (inQuotes && char === quoteChar) {
        inQuotes = false;
        quoteChar = '';
      } else if (!inQuotes && char === ' ') {
        if (current) {
          args.push(current);
          current = '';
        }
      } else {
        current += char;
      }
    }

    if (current) {
      args.push(current);
    }

    return args;
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

  clearPermissionCache(): void {
    this.permissionCache = {};
  }

  getExecutionHistory(): Command[] {
    return [...this.executionHistory];
  }

  abort(): void {
    this.abortController?.abort();
  }
}