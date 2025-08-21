import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import {
  Task,
  DetailedTask,
  TaskPlan,
  ExecutionResult,
  ValidationReport,
  CompletedExecution,
  ProgressUpdate
} from '../planning/interfaces';
import { TaskPlanner } from '../planning/planner';
import { TaskManager } from '../planning/task-manager';
import { TaskExecutor } from './executor';
import { ProgressTracker } from './progress-tracker';
import { ChatAgent, Session } from '../agents/chat';

export interface ExecutionPhase {
  name: 'planning' | 'detailing' | 'execution' | 'completion';
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  startedAt?: Date;
  completedAt?: Date;
  error?: string;
}

export interface ExecutionFlowState {
  id: string;
  userRequest: string;
  phases: ExecutionPhase[];
  currentPhase: ExecutionPhase['name'] | null;
  plan?: TaskPlan;
  detailedTasks: DetailedTask[];
  results: ExecutionResult[];
  approved: boolean;
  approvedAt?: Date;
  startedAt: Date;
  completedAt?: Date;
  paused: boolean;
  aborted: boolean;
}

export interface FlowOptions {
  autoApprove?: boolean;
  verbose?: boolean;
  dryRun?: boolean;
  maxRetries?: number;
  timeout?: number;
}

export class ExecutionFlow extends EventEmitter {
  private state: ExecutionFlowState;
  private planner: TaskPlanner;
  private taskManager: TaskManager;
  private executor: TaskExecutor;
  private progressTracker: ProgressTracker;
  private chatAgent: ChatAgent;
  private session: Session;
  private options: FlowOptions;
  private abortController: AbortController;

  constructor(options: FlowOptions = {}) {
    super();
    
    this.options = {
      autoApprove: false,
      verbose: true,
      dryRun: false,
      maxRetries: 3,
      timeout: 300000, // 5 minutes default
      ...options
    };

    this.state = this.initializeState();
    this.planner = new TaskPlanner();
    this.taskManager = new TaskManager();
    this.executor = new TaskExecutor(this.taskManager);
    this.progressTracker = new ProgressTracker();
    this.abortController = new AbortController();

    this.session = {
      id: 'flow-' + uuidv4(),
      name: 'Execution Flow Session',
      messages: [],
      contexts: [],
      metadata: {
        createdAt: new Date(),
        updatedAt: new Date()
      }
    };
    this.chatAgent = new ChatAgent(this.session);

    this.setupEventHandlers();
  }

  private initializeState(): ExecutionFlowState {
    return {
      id: uuidv4(),
      userRequest: '',
      phases: [
        { name: 'planning', status: 'pending' },
        { name: 'detailing', status: 'pending' },
        { name: 'execution', status: 'pending' },
        { name: 'completion', status: 'pending' }
      ],
      currentPhase: null,
      detailedTasks: [],
      results: [],
      approved: false,
      startedAt: new Date(),
      paused: false,
      aborted: false
    };
  }

  private setupEventHandlers(): void {
    // Progress tracking
    this.taskManager.on('progress', (update: ProgressUpdate) => {
      this.progressTracker.updateProgress(update);
      this.emit('progress', update);
    });

    // Approval handling
    this.executor.on('approval:required', async (data) => {
      if (this.options.autoApprove) {
        this.executor.emit('approval:response', true);
      } else {
        this.emit('approval:required', data);
      }
    });

    // Error handling
    this.executor.on('error', (error) => {
      this.emit('error', error);
    });

    // Log forwarding
    this.executor.on('log', (entry) => {
      if (this.options.verbose) {
        this.emit('log', entry);
      }
    });
  }

  async execute(userRequest: string): Promise<CompletedExecution> {
    this.state.userRequest = userRequest;
    this.emit('flow:started', { id: this.state.id, request: userRequest });

    try {
      // Phase 1: Planning
      await this.runPlanningPhase();

      // Phase 2: Detailing
      await this.runDetailingPhase();

      // Phase 3: Execution
      await this.runExecutionPhase();

      // Phase 4: Completion
      return await this.runCompletionPhase();

    } catch (error) {
      this.handleFlowError(error);
      throw error;
    }
  }

  private async runPlanningPhase(): Promise<void> {
    this.updatePhase('planning', 'in_progress');
    this.emit('phase:started', { phase: 'planning' });

    try {
      // Analyze request and create plan
      const plan = await this.planner.analyzeRequest(this.state.userRequest);
      
      // Validate plan
      const validation = await this.planner.validatePlan(plan);
      if (!validation.valid) {
        throw new Error(`Plan validation failed: ${validation.errors.join(', ')}`);
      }

      if (validation.warnings.length > 0) {
        this.emit('warnings', validation.warnings);
      }

      this.state.plan = plan;
      
      // Display plan for approval
      const planDisplay = this.planner.formatPlanForDisplay(plan);
      this.emit('plan:created', { plan: planDisplay, validation });

      // Wait for approval if not auto-approve
      if (!this.options.autoApprove) {
        await this.waitForApproval();
      } else {
        this.state.approved = true;
        this.state.approvedAt = new Date();
      }

      this.updatePhase('planning', 'completed');
      this.emit('phase:completed', { phase: 'planning' });

    } catch (error) {
      this.updatePhase('planning', 'failed', error);
      throw error;
    }
  }

  private async runDetailingPhase(): Promise<void> {
    if (!this.state.plan) {
      throw new Error('No plan available for detailing');
    }

    this.updatePhase('detailing', 'in_progress');
    this.emit('phase:started', { phase: 'detailing' });

    try {
      const detailedTasks: DetailedTask[] = [];
      
      for (const task of this.state.plan.tasks) {
        if (this.state.aborted) {
          throw new Error('Flow aborted by user');
        }

        // Decompose task into subtasks
        const subtasks = await this.planner.decomposeTask(task);
        
        // Create detailed task with execution steps
        const detailedTask = await this.createDetailedTask(task, subtasks);
        detailedTasks.push(detailedTask);
        
        this.emit('task:detailed', {
          task: task.name,
          steps: (detailedTask.steps || []).length,
          resources: detailedTask.resources.length
        });
      }

      this.state.detailedTasks = detailedTasks;
      
      // Initialize task manager with detailed tasks
      for (const task of detailedTasks) {
        this.taskManager.addTask(task);
      }

      this.updatePhase('detailing', 'completed');
      this.emit('phase:completed', { phase: 'detailing' });

    } catch (error) {
      this.updatePhase('detailing', 'failed', error);
      throw error;
    }
  }

  private async runExecutionPhase(): Promise<void> {
    this.updatePhase('execution', 'in_progress');
    this.emit('phase:started', { phase: 'execution' });

    try {
      const executionOrder = this.planner.getExecutionOrder(this.state.plan!.tasks);
      
      for (const task of executionOrder) {
        if (this.state.aborted) {
          throw new Error('Flow aborted by user');
        }

        if (this.state.paused) {
          await this.waitForResume();
        }

        const detailedTask = this.state.detailedTasks.find(dt => dt.id === task.id);
        if (!detailedTask) {
          throw new Error(`Detailed task not found for ${task.id}`);
        }

        this.emit('task:started', {
          id: task.id,
          name: task.name,
          estimatedDuration: task.estimatedDuration
        });

        // Execute with retry logic
        let result: ExecutionResult | null = null;
        let retries = 0;
        
        while (retries < this.options.maxRetries!) {
          try {
            if (this.options.dryRun) {
              result = await this.simulateExecution(detailedTask);
            } else {
              result = await this.executor.executeTask(detailedTask);
            }
            break;
          } catch (execError: any) {
            retries++;
            if (retries >= this.options.maxRetries!) {
              throw execError;
            }
            this.emit('task:retry', {
              id: task.id,
              attempt: retries,
              error: execError.message
            });
            await this.delay(1000 * retries); // Exponential backoff
          }
        }

        if (result) {
          this.state.results.push(result);
          this.emit('task:completed', {
            id: task.id,
            status: result.status,
            duration: result.duration
          });
        }
      }

      this.updatePhase('execution', 'completed');
      this.emit('phase:completed', { phase: 'execution' });

    } catch (error) {
      this.updatePhase('execution', 'failed', error);
      throw error;
    }
  }

  private async runCompletionPhase(): Promise<CompletedExecution> {
    this.updatePhase('completion', 'in_progress');
    this.emit('phase:started', { phase: 'completion' });

    try {
      // Validate all results
      const report = this.validateResults();
      
      // Generate completion summary
      const completion: CompletedExecution = {
        planId: this.state.plan!.id,
        results: this.state.results,
        totalDuration: Date.now() - this.state.startedAt.getTime(),
        successRate: this.calculateSuccessRate(),
        completedAt: new Date()
      };

      this.state.completedAt = completion.completedAt;
      
      // Generate and emit report
      const reportText = this.generateCompletionReport(completion, report);
      this.emit('completion:report', { report: reportText, validation: report });

      this.updatePhase('completion', 'completed');
      this.emit('phase:completed', { phase: 'completion' });
      this.emit('flow:completed', completion);

      return completion;

    } catch (error) {
      this.updatePhase('completion', 'failed', error);
      throw error;
    }
  }

  private async createDetailedTask(task: Task, _subtasks: any[]): Promise<DetailedTask> {
    const prompt = `Create execution steps for task: ${task.name}
    Description: ${task.description}
    
    Return JSON with:
    {
      "steps": [
        {
          "description": "step description",
          "command": "actual command to run (optional)",
          "expectedOutput": "what to expect",
          "requiresApproval": boolean,
          "safetyLevel": "safe|caution|danger"
        }
      ],
      "resources": [
        {
          "type": "file|api|permission|tool",
          "name": "resource name",
          "required": boolean
        }
      ],
      "risks": [
        {
          "type": "risk type",
          "description": "risk description",
          "probability": "high|medium|low",
          "impact": "high|medium|low",
          "mitigation": "how to mitigate"
        }
      ]
    }`;

    try {
      const response = await this.chatAgent.chat(prompt);
      const data = this.parseJSONResponse(response);
      
      return {
        ...task,
        parentId: task.id,
        order: 0,
        steps: data.steps?.map((s: any, i: number) => ({
          id: `${task.id}-step-${i}`,
          ...s
        })) || [],
        resources: data.resources || [],
        risks: data.risks || [],
        rollbackStrategy: {
          steps: [],
          automatic: false
        }
      };
    } catch (error) {
      // Return minimal detailed task on error
      return {
        ...task,
        parentId: task.id,
        order: 0,
        steps: [],
        resources: [],
        risks: []
      };
    }
  }

  private async simulateExecution(task: DetailedTask): Promise<ExecutionResult> {
    await this.delay(100); // Simulate work
    
    return {
      taskId: task.id,
      status: 'success',
      output: { simulated: true, task: task.name },
      duration: 100,
      executedAt: new Date(),
      logs: []
    };
  }

  private validateResults(): ValidationReport {
    const failedTasks = this.state.results
      .filter(r => r.status === 'failure')
      .map(r => r.taskId);

    const warnings: string[] = [];
    const recommendations: string[] = [];

    if (failedTasks.length > 0) {
      warnings.push(`${failedTasks.length} tasks failed`);
      recommendations.push('Review failed tasks and consider retry or manual intervention');
    }

    const longRunningTasks = this.state.results
      .filter(r => r.duration > 60000)
      .map(r => r.taskId);

    if (longRunningTasks.length > 0) {
      warnings.push(`${longRunningTasks.length} tasks took longer than expected`);
      recommendations.push('Consider optimizing long-running tasks');
    }

    return {
      allTasksCompleted: failedTasks.length === 0,
      failedTasks,
      warnings,
      recommendations
    };
  }

  private generateCompletionReport(completion: CompletedExecution, validation: ValidationReport): string {
    const lines: string[] = [];
    
    lines.push('✅ Execution Complete');
    lines.push('═'.repeat(50));
    lines.push(`Total Duration: ${this.formatDuration(completion.totalDuration)}`);
    lines.push(`Success Rate: ${(completion.successRate * 100).toFixed(1)}%`);
    lines.push(`Tasks Executed: ${completion.results.length}`);
    lines.push('');
    
    if (validation.failedTasks.length > 0) {
      lines.push('❌ Failed Tasks:');
      validation.failedTasks.forEach(id => {
        const task = this.state.plan?.tasks.find(t => t.id === id);
        lines.push(`  - ${task?.name || id}`);
      });
      lines.push('');
    }

    if (validation.warnings.length > 0) {
      lines.push('⚠️ Warnings:');
      validation.warnings.forEach(w => lines.push(`  - ${w}`));
      lines.push('');
    }

    if (validation.recommendations.length > 0) {
      lines.push('💡 Recommendations:');
      validation.recommendations.forEach(r => lines.push(`  - ${r}`));
    }

    return lines.join('\n');
  }

  private calculateSuccessRate(): number {
    if (this.state.results.length === 0) return 0;
    
    const successful = this.state.results.filter(r => r.status === 'success').length;
    return successful / this.state.results.length;
  }

  private updatePhase(phaseName: ExecutionPhase['name'], status: ExecutionPhase['status'], error?: any): void {
    const phase = this.state.phases.find(p => p.name === phaseName);
    if (!phase) return;

    phase.status = status;
    
    if (status === 'in_progress') {
      phase.startedAt = new Date();
      this.state.currentPhase = phaseName;
    } else if (status === 'completed') {
      phase.completedAt = new Date();
    } else if (status === 'failed' && error) {
      phase.error = error instanceof Error ? error.message : String(error);
    }
  }

  private async waitForApproval(): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Approval timeout'));
      }, this.options.timeout!);

      this.once('approval:granted', () => {
        clearTimeout(timeout);
        this.state.approved = true;
        this.state.approvedAt = new Date();
        resolve();
      });

      this.once('approval:denied', () => {
        clearTimeout(timeout);
        reject(new Error('Plan rejected by user'));
      });
    });
  }

  private async waitForResume(): Promise<void> {
    return new Promise((resolve) => {
      this.once('flow:resumed', resolve);
    });
  }

  private handleFlowError(error: any): void {
    const errorMessage = error instanceof Error ? error.message : String(error);
    this.emit('flow:error', {
      id: this.state.id,
      phase: this.state.currentPhase,
      error: errorMessage
    });
  }

  private formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ${minutes % 60}m`;
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

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Public control methods
  approve(): void {
    this.emit('approval:granted');
  }

  deny(): void {
    this.emit('approval:denied');
  }

  pause(): void {
    this.state.paused = true;
    this.emit('flow:paused');
  }

  resume(): void {
    this.state.paused = false;
    this.emit('flow:resumed');
  }

  abort(): void {
    this.state.aborted = true;
    this.abortController.abort();
    this.executor.abort();
    this.emit('flow:aborted');
  }

  skipTask(taskId: string): void {
    const task = this.state.plan?.tasks.find(t => t.id === taskId);
    if (task) {
      task.status = 'skipped';
      this.emit('task:skipped', { id: taskId });
    }
  }

  getState(): ExecutionFlowState {
    return { ...this.state };
  }

  getProgress(): number {
    return this.progressTracker.getOverallProgress();
  }
}