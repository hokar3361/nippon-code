import { v4 as uuidv4 } from 'uuid';
import {
  Task,
  SubTask,
  TaskPlan,
  ValidationResult,
  TaskPriority,
  TaskStatus,
  DependencyGraph
} from './interfaces';
import { OpenAIProvider } from '../providers/openai';
import { config } from '../config';

export class TaskPlanner {
  private aiProvider: OpenAIProvider;

  constructor() {
    this.aiProvider = new OpenAIProvider(
      config.get('apiKey'),
      config.get('apiBaseUrl'),
      config.get('model')
    );
  }

  async analyzeRequest(userInput: string): Promise<TaskPlan> {
    const planId = uuidv4();
    
    const prompt = `You are an intelligent task planner using hierarchical task decomposition.
    Analyze the user's request and create a comprehensive execution plan.
    
    Return a JSON object with the following structure:
    {
      "tasks": [
        {
          "name": "Task name",
          "description": "Detailed description",
          "priority": "critical|high|medium|low",
          "estimatedDuration": number (in seconds),
          "dependencies": ["task_id"] (optional),
          "category": "setup|implementation|testing|documentation|deployment",
          "requiresApproval": boolean,
          "parallelizable": boolean
        }
      ],
      "estimatedTotalDuration": number (in seconds),
      "complexity": "simple|moderate|complex",
      "riskLevel": "low|medium|high"
    }
    
    Guidelines:
    - Use hierarchical decomposition for complex tasks
    - Identify tasks that can run in parallel
    - Mark high-risk operations for approval
    - Consider setup → implementation → testing → documentation flow
    - Include rollback considerations for risky operations
    - Estimate realistic durations with buffer
    - Create dependencies graph for optimal execution order
    - Focus on atomic, testable, reversible actions`;

    try {
      const fullPrompt = `${prompt}

User Request: ${userInput}`;
      const response = await this.aiProvider.complete({
        messages: [{ role: 'user', content: fullPrompt }],
        model: config.get('model'),
        temperature: 0.7,
        maxTokens: 2048
      });
      
      if (!response.content) {
        throw new Error('No response from AI');
      }
      
      const responseText = response.content;

      const planData = this.parseAIResponse(responseText);
      
      // Enhance task data with intelligent defaults
      const tasks: Task[] = planData.tasks.map((taskData: any, index: number) => {
        const task: Task = {
          id: `task-${planId}-${index}`,
          name: taskData.name,
          description: taskData.description,
          priority: this.validatePriority(taskData.priority) || 'medium',
          status: 'pending' as TaskStatus,
          estimatedDuration: taskData.estimatedDuration || 60,
          dependencies: this.validateDependencies(taskData.dependencies, planId, index),
          createdAt: new Date(),
          updatedAt: new Date()
        };
        
        // Store additional metadata for execution flow
        (task as any).category = taskData.category || 'implementation';
        (task as any).requiresApproval = taskData.requiresApproval || false;
        (task as any).parallelizable = taskData.parallelizable || false;
        
        return task;
      });
      
      // Optimize execution order based on dependencies and parallelization
      const optimizedTasks = this.optimizeTaskOrder(tasks);

      return {
        id: planId,
        userRequest: userInput,
        tasks: optimizedTasks,
        estimatedTotalDuration: this.calculateOptimalDuration(optimizedTasks, planData),
        createdAt: new Date(),
        approved: false,
        // Store execution metadata
        metadata: {
          complexity: planData.complexity || 'moderate',
          riskLevel: planData.riskLevel || 'medium',
          parallelTasks: optimizedTasks.filter((t: any) => t.parallelizable).length,
          criticalPath: this.findCriticalPath(optimizedTasks)
        }
      } as TaskPlan;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('Failed to analyze request:', errorMessage);
      throw new Error(`Failed to create task plan: ${errorMessage}`);
    }
  }

  async decomposeTask(task: Task): Promise<SubTask[]> {
    const prompt = `Perform intelligent task decomposition using best practices.
    
    Task: ${task.name}
    Description: ${task.description}
    Priority: ${task.priority}
    Category: ${(task as any).category || 'implementation'}
    
    Return a JSON with detailed subtasks:
    {
      "subtasks": [
        {
          "name": "Subtask name",
          "description": "Specific action to take",
          "order": number,
          "estimatedDuration": number (in seconds),
          "command": "actual command to execute (optional)",
          "validation": "how to verify success",
          "rollback": "how to undo if needed",
          "requiresApproval": boolean,
          "riskLevel": "low|medium|high"
        }
      ]
    }
    
    Guidelines:
    - Each subtask should be atomic and reversible
    - Include validation criteria for success
    - Provide rollback strategy for risky operations
    - Consider dry-run for dangerous commands
    - Order by dependencies and risk (safer operations first)
    - Include specific commands where applicable
    - Mark high-risk subtasks for approval`;

    try {
      const fullPrompt = `${prompt}\n\nDecompose this task: ${task.description}`;
      const response = await this.aiProvider.complete({
        messages: [{ role: 'user', content: fullPrompt }],
        model: config.get('model'),
        temperature: 0.7,
        maxTokens: 2048
      });
      
      if (!response.content) {
        throw new Error('No response from AI');
      }

      const subtaskData = this.parseAIResponse(response.content);
      
      return subtaskData.subtasks.map((data: any, index: number) => {
        const subtask: SubTask = {
          id: `${task.id}-sub-${index}`,
          parentId: task.id,
          name: data.name,
          description: data.description,
          order: data.order || index,
          priority: task.priority,
          status: 'pending' as TaskStatus,
          estimatedDuration: data.estimatedDuration || 30,
          createdAt: new Date(),
          updatedAt: new Date()
        };
        
        // Store execution metadata
        (subtask as any).command = data.command;
        (subtask as any).validation = data.validation;
        (subtask as any).rollback = data.rollback;
        (subtask as any).requiresApproval = data.requiresApproval || false;
        (subtask as any).riskLevel = data.riskLevel || 'low';
        
        return subtask;
      });
    } catch (error) {
      console.error('Failed to decompose task:', error);
      return [];
    }
  }

  async validatePlan(plan: TaskPlan): Promise<ValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];
    const suggestions: string[] = [];

    if (!plan.tasks || plan.tasks.length === 0) {
      errors.push('Plan has no tasks');
    }

    const taskIds = new Set(plan.tasks.map(t => t.id));
    
    for (const task of plan.tasks) {
      if (!task.name || !task.description) {
        errors.push(`Task ${task.id} is missing required information`);
      }

      if (task.dependencies) {
        for (const dep of task.dependencies) {
          if (!taskIds.has(dep)) {
            errors.push(`Task ${task.id} has invalid dependency: ${dep}`);
          }
        }
      }

      if (!task.estimatedDuration) {
        warnings.push(`Task ${task.id} has no duration estimate`);
      }

      if (task.estimatedDuration && task.estimatedDuration > 3600) {
        warnings.push(`Task ${task.id} has very long duration (>1 hour)`);
        suggestions.push(`Consider breaking down task ${task.id} into smaller subtasks`);
      }
    }

    const hasCycles = this.detectCycles(plan.tasks);
    if (hasCycles) {
      errors.push('Plan contains circular dependencies');
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      suggestions
    };
  }

  buildDependencyGraph(tasks: Task[]): DependencyGraph {
    const nodes = tasks;
    const edges: Array<{ from: string; to: string }> = [];

    for (const task of tasks) {
      if (task.dependencies) {
        for (const dep of task.dependencies) {
          edges.push({ from: dep, to: task.id });
        }
      }
    }

    return { nodes, edges };
  }

  getExecutionOrder(tasks: Task[]): Task[] {
    const visited = new Set<string>();
    const result: Task[] = [];
    const taskMap = new Map(tasks.map(t => [t.id, t]));

    const visit = (taskId: string) => {
      if (visited.has(taskId)) return;
      visited.add(taskId);

      const task = taskMap.get(taskId);
      if (!task) return;

      if (task.dependencies) {
        for (const dep of task.dependencies) {
          visit(dep);
        }
      }

      result.push(task);
    };

    for (const task of tasks) {
      visit(task.id);
    }

    return result;
  }

  private parseAIResponse(response: string): any {
    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
      
      const codeBlockMatch = response.match(/```(?:json)?\n?([\s\S]*?)\n?```/);
      if (codeBlockMatch) {
        return JSON.parse(codeBlockMatch[1]);
      }

      return JSON.parse(response);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('Failed to parse AI response:', errorMessage);
      // Return default structure to allow graceful degradation
      return { tasks: [], estimatedTotalDuration: 0 };
    }
  }

  private detectCycles(tasks: Task[]): boolean {
    const visited = new Set<string>();
    const recursionStack = new Set<string>();

    const hasCycle = (taskId: string, taskMap: Map<string, Task>): boolean => {
      visited.add(taskId);
      recursionStack.add(taskId);

      const task = taskMap.get(taskId);
      if (task?.dependencies) {
        for (const dep of task.dependencies) {
          if (!visited.has(dep)) {
            if (hasCycle(dep, taskMap)) return true;
          } else if (recursionStack.has(dep)) {
            return true;
          }
        }
      }

      recursionStack.delete(taskId);
      return false;
    };

    const taskMap = new Map(tasks.map(t => [t.id, t]));
    for (const task of tasks) {
      if (!visited.has(task.id)) {
        if (hasCycle(task.id, taskMap)) return true;
      }
    }

    return false;
  }

  formatPlanForDisplay(plan: TaskPlan): string {
    const lines: string[] = [];
    lines.push('📋 Execution Plan');
    lines.push('═'.repeat(50));
    lines.push(`Request: ${plan.userRequest}`);
    lines.push(`Total Duration: ${this.formatDuration(plan.estimatedTotalDuration)}`);
    lines.push(`Tasks: ${plan.tasks.length}`);
    lines.push('');

    const orderedTasks = this.getExecutionOrder(plan.tasks);
    
    orderedTasks.forEach((task, index) => {
      const priority = this.getPriorityEmoji(task.priority);
      const deps = task.dependencies ? ` [depends on: ${task.dependencies.join(', ')}]` : '';
      
      lines.push(`${index + 1}. ${priority} ${task.name}`);
      lines.push(`   ${task.description}`);
      lines.push(`   Duration: ${this.formatDuration(task.estimatedDuration || 0)}${deps}`);
      lines.push('');
    });

    return lines.join('\n');
  }

  private formatDuration(seconds: number): string {
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
    return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  }

  private getPriorityEmoji(priority: TaskPriority): string {
    switch (priority) {
      case 'critical': return '🔴';
      case 'high': return '🟠';
      case 'medium': return '🟡';
      case 'low': return '🟢';
      default: return '⚪';
    }
  }

  private validatePriority(priority: any): TaskPriority | null {
    const valid: TaskPriority[] = ['critical', 'high', 'medium', 'low'];
    return valid.includes(priority) ? priority : null;
  }

  private validateDependencies(deps: any, planId: string, currentIndex: number): string[] | undefined {
    if (!deps || !Array.isArray(deps)) return undefined;
    
    return deps.map(dep => {
      if (typeof dep === 'number') {
        return `task-${planId}-${dep}`;
      }
      return dep;
    }).filter(dep => !dep.includes(`-${currentIndex}`)); // Prevent self-dependency
  }

  private optimizeTaskOrder(tasks: Task[]): Task[] {
    // Group parallelizable tasks
    const parallelGroups = new Map<number, Task[]>();
    const sequential: Task[] = [];
    
    tasks.forEach(task => {
      if ((task as any).parallelizable && !task.dependencies?.length) {
        const group = 0; // Initial parallel group
        if (!parallelGroups.has(group)) {
          parallelGroups.set(group, []);
        }
        parallelGroups.get(group)!.push(task);
      } else {
        sequential.push(task);
      }
    });
    
    // Merge parallel and sequential tasks optimally
    const optimized: Task[] = [];
    parallelGroups.forEach(group => optimized.push(...group));
    optimized.push(...this.getExecutionOrder(sequential));
    
    return optimized;
  }

  private calculateOptimalDuration(tasks: Task[], planData: any): number {
    // Calculate considering parallel execution
    const parallelTasks = tasks.filter((t: any) => t.parallelizable);
    const sequentialTasks = tasks.filter((t: any) => !t.parallelizable);
    
    const maxParallelDuration = Math.max(
      ...parallelTasks.map(t => t.estimatedDuration || 0),
      0
    );
    
    const sequentialDuration = sequentialTasks.reduce(
      (sum, t) => sum + (t.estimatedDuration || 0),
      0
    );
    
    const calculated = maxParallelDuration + sequentialDuration;
    return planData.estimatedTotalDuration || calculated;
  }

  private findCriticalPath(tasks: Task[]): string[] {
    // Find the longest path through the dependency graph
    const taskMap = new Map(tasks.map(t => [t.id, t]));
    const pathLengths = new Map<string, number>();
    
    const calculatePath = (taskId: string): number => {
      if (pathLengths.has(taskId)) {
        return pathLengths.get(taskId)!;
      }
      
      const task = taskMap.get(taskId);
      if (!task) return 0;
      
      let maxDepPath = 0;
      if (task.dependencies) {
        for (const dep of task.dependencies) {
          maxDepPath = Math.max(maxDepPath, calculatePath(dep));
        }
      }
      
      const pathLength = maxDepPath + (task.estimatedDuration || 0);
      pathLengths.set(taskId, pathLength);
      return pathLength;
    };
    
    // Calculate all paths
    tasks.forEach(t => calculatePath(t.id));
    
    // Find critical path
    const criticalPath: string[] = [];
    let maxLength = 0;
    let criticalTaskId = '';
    
    pathLengths.forEach((length, taskId) => {
      if (length > maxLength) {
        maxLength = length;
        criticalTaskId = taskId;
      }
    });
    
    // Trace back the critical path
    if (criticalTaskId) {
      const tracePath = (taskId: string) => {
        criticalPath.unshift(taskId);
        const task = taskMap.get(taskId);
        if (task?.dependencies?.[0]) {
          tracePath(task.dependencies[0]);
        }
      };
      tracePath(criticalTaskId);
    }
    
    return criticalPath;
  }
}