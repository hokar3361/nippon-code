import { EventEmitter } from 'events';
import chalk from 'chalk';
import ora, { Ora } from 'ora';
import { ProgressUpdate, Task, TaskStatus } from '../planning/interfaces';

export class ProgressTracker extends EventEmitter {
  private spinners: Map<string, Ora> = new Map();
  private progress: Map<string, number> = new Map();
  private startTimes: Map<string, number> = new Map();

  startTask(task: Task): void {
    const spinner = ora({
      text: `${task.name}`,
      prefixText: this.getStatusPrefix(task.status)
    }).start();

    this.spinners.set(task.id, spinner);
    this.startTimes.set(task.id, Date.now());
    this.progress.set(task.id, 0);
  }

  updateProgress(update: ProgressUpdate): void {
    const spinner = this.spinners.get(update.taskId);
    if (!spinner) return;

    this.progress.set(update.taskId, update.progress);
    
    const elapsed = this.getElapsedTime(update.taskId);
    const progressBar = this.createProgressBar(update.progress);
    
    spinner.text = `${update.currentStep || 'Processing'} ${progressBar} ${update.progress}% [${elapsed}]`;
    
    if (update.message) {
      spinner.suffixText = chalk.gray(` - ${update.message}`);
    }
  }

  completeTask(taskId: string, status: 'success' | 'failure' | 'skipped'): void {
    const spinner = this.spinners.get(taskId);
    if (!spinner) return;

    const elapsed = this.getElapsedTime(taskId);
    
    switch (status) {
      case 'success':
        spinner.succeed(chalk.green(`Task completed [${elapsed}]`));
        break;
      case 'failure':
        spinner.fail(chalk.red(`Task failed [${elapsed}]`));
        break;
      case 'skipped':
        spinner.warn(chalk.yellow(`Task skipped [${elapsed}]`));
        break;
    }

    this.spinners.delete(taskId);
    this.progress.delete(taskId);
    this.startTimes.delete(taskId);
  }

  updateTaskStatus(taskId: string, status: TaskStatus, message?: string): void {
    const spinner = this.spinners.get(taskId);
    if (!spinner) return;

    spinner.prefixText = this.getStatusPrefix(status);
    
    if (message) {
      spinner.text = message;
    }

    if (status === 'completed') {
      this.completeTask(taskId, 'success');
    } else if (status === 'failed') {
      this.completeTask(taskId, 'failure');
    } else if (status === 'skipped') {
      this.completeTask(taskId, 'skipped');
    }
  }

  displayPlanSummary(tasks: Task[]): void {
    console.log(chalk.bold.cyan('\n📋 Execution Plan Summary'));
    console.log(chalk.gray('─'.repeat(50)));
    
    const totalTasks = tasks.length;
    const criticalTasks = tasks.filter(t => t.priority === 'critical').length;
    const highPriorityTasks = tasks.filter(t => t.priority === 'high').length;
    
    console.log(chalk.white(`Total Tasks: ${totalTasks}`));
    if (criticalTasks > 0) {
      console.log(chalk.red(`Critical: ${criticalTasks}`));
    }
    if (highPriorityTasks > 0) {
      console.log(chalk.yellow(`High Priority: ${highPriorityTasks}`));
    }
    
    const totalDuration = tasks.reduce((sum, t) => sum + (t.estimatedDuration || 0), 0);
    console.log(chalk.white(`Estimated Duration: ${this.formatDuration(totalDuration)}`));
    console.log(chalk.gray('─'.repeat(50)));
    console.log();
  }

  displayTaskList(tasks: Task[]): void {
    console.log(chalk.bold.white('\n📝 Task List:'));
    
    tasks.forEach((task, index) => {
      const statusIcon = this.getStatusIcon(task.status);
      const priorityIcon = this.getPriorityIcon(task.priority);
      const deps = task.dependencies?.length 
        ? chalk.gray(` [deps: ${task.dependencies.length}]`)
        : '';
      
      console.log(
        `${index + 1}. ${statusIcon} ${priorityIcon} ${task.name}${deps}`
      );
      
      if (task.description && task.description !== task.name) {
        console.log(chalk.gray(`   └─ ${task.description}`));
      }
    });
    console.log();
  }

  displayCompletionSummary(
    successCount: number,
    failureCount: number,
    skippedCount: number,
    totalDuration: number
  ): void {
    console.log(chalk.bold.cyan('\n✨ Execution Complete'));
    console.log(chalk.gray('─'.repeat(50)));
    
    const total = successCount + failureCount + skippedCount;
    const successRate = total > 0 ? Math.round((successCount / total) * 100) : 0;
    
    console.log(chalk.green(`✓ Successful: ${successCount}`));
    if (failureCount > 0) {
      console.log(chalk.red(`✗ Failed: ${failureCount}`));
    }
    if (skippedCount > 0) {
      console.log(chalk.yellow(`⊘ Skipped: ${skippedCount}`));
    }
    
    console.log(chalk.white(`Success Rate: ${successRate}%`));
    console.log(chalk.white(`Total Duration: ${this.formatDuration(totalDuration / 1000)}`));
    console.log(chalk.gray('─'.repeat(50)));
  }

  private createProgressBar(percentage: number): string {
    const width = 20;
    const filled = Math.floor((percentage / 100) * width);
    const empty = width - filled;
    
    return chalk.cyan('█'.repeat(filled)) + chalk.gray('░'.repeat(empty));
  }

  private getElapsedTime(taskId: string): string {
    const startTime = this.startTimes.get(taskId);
    if (!startTime) return '0s';
    
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    return this.formatDuration(elapsed);
  }

  private formatDuration(seconds: number): string {
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) {
      const minutes = Math.floor(seconds / 60);
      const secs = seconds % 60;
      return `${minutes}m ${secs}s`;
    }
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${hours}h ${minutes}m`;
  }

  private getStatusPrefix(status: TaskStatus): string {
    switch (status) {
      case 'pending': return chalk.gray('[PENDING]');
      case 'planning': return chalk.blue('[PLANNING]');
      case 'executing': return chalk.cyan('[EXECUTING]');
      case 'completed': return chalk.green('[COMPLETED]');
      case 'failed': return chalk.red('[FAILED]');
      case 'skipped': return chalk.yellow('[SKIPPED]');
      default: return '';
    }
  }

  private getStatusIcon(status: TaskStatus): string {
    switch (status) {
      case 'pending': return '⏳';
      case 'planning': return '📝';
      case 'executing': return '🔄';
      case 'completed': return '✅';
      case 'failed': return '❌';
      case 'skipped': return '⏭️';
      default: return '❓';
    }
  }

  private getPriorityIcon(priority: string): string {
    switch (priority) {
      case 'critical': return '🔴';
      case 'high': return '🟠';
      case 'medium': return '🟡';
      case 'low': return '🟢';
      default: return '⚪';
    }
  }

  clearAll(): void {
    for (const spinner of this.spinners.values()) {
      spinner.stop();
    }
    this.spinners.clear();
    this.progress.clear();
    this.startTimes.clear();
  }
}