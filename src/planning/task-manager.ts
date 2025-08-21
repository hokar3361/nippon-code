import { EventEmitter } from 'events';
import {
  Task,
  TaskPlan,
  TaskStatus,
  ExecutionResult,
  ProgressUpdate,
  CompletedExecution
} from './interfaces';

export class TaskManager extends EventEmitter {
  private plans: Map<string, TaskPlan> = new Map();
  private tasks: Map<string, Task> = new Map();
  private results: Map<string, ExecutionResult> = new Map();
  private activeTaskId: string | null = null;

  registerPlan(plan: TaskPlan): void {
    this.plans.set(plan.id, plan);
    for (const task of plan.tasks) {
      this.tasks.set(task.id, task);
    }
    this.emit('plan:registered', plan);
  }

  approvePlan(planId: string): boolean {
    const plan = this.plans.get(planId);
    if (!plan) return false;

    plan.approved = true;
    plan.approvedAt = new Date();
    this.emit('plan:approved', plan);
    return true;
  }

  updateTaskStatus(taskId: string, status: TaskStatus): void {
    const task = this.tasks.get(taskId);
    if (!task) return;

    const previousStatus = task.status;
    task.status = status;
    task.updatedAt = new Date();

    if (status === 'executing') {
      this.activeTaskId = taskId;
    } else if (status === 'completed' || status === 'failed' || status === 'skipped') {
      if (this.activeTaskId === taskId) {
        this.activeTaskId = null;
      }
    }

    this.emit('task:statusChanged', {
      taskId,
      previousStatus,
      newStatus: status,
      task
    });
  }

  recordResult(result: ExecutionResult): void {
    this.results.set(result.taskId, result);
    
    const task = this.tasks.get(result.taskId);
    if (task) {
      task.status = result.status === 'success' ? 'completed' : 'failed';
      task.updatedAt = new Date();
    }

    this.emit('task:completed', result);
  }

  emitProgress(update: ProgressUpdate): void {
    this.emit('task:progress', update);
  }

  getTask(taskId: string): Task | undefined {
    return this.tasks.get(taskId);
  }

  getPlan(planId: string): TaskPlan | undefined {
    return this.plans.get(planId);
  }

  getActiveTask(): Task | null {
    if (!this.activeTaskId) return null;
    return this.tasks.get(this.activeTaskId) || null;
  }

  getPlanTasks(planId: string): Task[] {
    const plan = this.plans.get(planId);
    if (!plan) return [];
    return plan.tasks;
  }

  getPlanProgress(planId: string): {
    total: number;
    completed: number;
    failed: number;
    inProgress: number;
    percentage: number;
  } {
    const tasks = this.getPlanTasks(planId);
    const total = tasks.length;
    const completed = tasks.filter(t => t.status === 'completed').length;
    const failed = tasks.filter(t => t.status === 'failed').length;
    const inProgress = tasks.filter(t => t.status === 'executing').length;
    const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;

    return { total, completed, failed, inProgress, percentage };
  }

  skipTask(taskId: string, reason?: string): void {
    const task = this.tasks.get(taskId);
    if (!task) return;

    task.status = 'skipped';
    task.updatedAt = new Date();

    const result: ExecutionResult = {
      taskId,
      status: 'success',
      output: { skipped: true, reason },
      duration: 0,
      executedAt: new Date(),
      logs: [{
        timestamp: new Date(),
        level: 'info',
        message: `Task skipped: ${reason || 'User request'}`
      }]
    };

    // Record result without updating status (already set to 'skipped')
    this.results.set(result.taskId, result);
    this.emit('task:completed', result);
  }

  getNextPendingTask(planId: string): Task | null {
    const tasks = this.getPlanTasks(planId);
    
    for (const task of tasks) {
      if (task.status !== 'pending') continue;
      
      if (!task.dependencies || task.dependencies.length === 0) {
        return task;
      }

      const dependenciesCompleted = task.dependencies.every(depId => {
        const depTask = this.tasks.get(depId);
        return depTask && (depTask.status === 'completed' || depTask.status === 'skipped');
      });

      if (dependenciesCompleted) {
        return task;
      }
    }

    return null;
  }

  compilePlanResults(planId: string): CompletedExecution | null {
    const plan = this.plans.get(planId);
    if (!plan) return null;

    const tasks = this.getPlanTasks(planId);
    const results: ExecutionResult[] = [];
    let totalDuration = 0;
    let successCount = 0;

    for (const task of tasks) {
      const result = this.results.get(task.id);
      if (result) {
        results.push(result);
        totalDuration += result.duration;
        if (result.status === 'success') {
          successCount++;
        }
      }
    }

    return {
      planId,
      results,
      totalDuration,
      successRate: tasks.length > 0 ? (successCount / tasks.length) * 100 : 0,
      completedAt: new Date()
    };
  }

  clearPlan(planId: string): void {
    const plan = this.plans.get(planId);
    if (!plan) return;

    for (const task of plan.tasks) {
      this.tasks.delete(task.id);
      this.results.delete(task.id);
    }

    this.plans.delete(planId);
    this.emit('plan:cleared', planId);
  }

  getAllPlans(): TaskPlan[] {
    return Array.from(this.plans.values());
  }

  getActivePlans(): TaskPlan[] {
    return this.getAllPlans().filter(plan => {
      const progress = this.getPlanProgress(plan.id);
      return progress.inProgress > 0 || 
             (progress.completed + progress.failed < progress.total);
    });
  }
}