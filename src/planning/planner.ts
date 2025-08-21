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
import { ChatAgent, Session } from '../agents/chat';

export class TaskPlanner {
  private chatAgent: ChatAgent;
  private session: Session;

  constructor() {
    this.session = {
      id: 'planner-' + uuidv4(),
      name: 'Planning Session',
      messages: [],
      contexts: [],
      metadata: {
        createdAt: new Date(),
        updatedAt: new Date()
      }
    };
    this.chatAgent = new ChatAgent(this.session);
  }

  async analyzeRequest(userInput: string): Promise<TaskPlan> {
    const planId = uuidv4();
    
    const prompt = `You are an intelligent task planner. Analyze the user's request and break it down into manageable tasks.
    
    Return a JSON object with the following structure:
    {
      "tasks": [
        {
          "name": "Task name",
          "description": "Detailed description",
          "priority": "high|medium|low",
          "estimatedDuration": number (in seconds),
          "dependencies": ["task_id"] (optional)
        }
      ],
      "estimatedTotalDuration": number (in seconds)
    }
    
    Guidelines:
    - Break complex tasks into smaller, actionable subtasks
    - Identify dependencies between tasks
    - Estimate realistic durations
    - Prioritize tasks based on importance and dependencies
    - Focus on clear, executable actions`;

    try {
      const fullPrompt = `${prompt}

User Request: ${userInput}`;
      const response = await this.chatAgent.chat(fullPrompt);

      const planData = this.parseAIResponse(response);
      
      const tasks: Task[] = planData.tasks.map((taskData: any, index: number) => ({
        id: `task-${planId}-${index}`,
        name: taskData.name,
        description: taskData.description,
        priority: taskData.priority as TaskPriority || 'medium',
        status: 'pending' as TaskStatus,
        estimatedDuration: taskData.estimatedDuration,
        dependencies: taskData.dependencies,
        createdAt: new Date(),
        updatedAt: new Date()
      }));

      return {
        id: planId,
        userRequest: userInput,
        tasks,
        estimatedTotalDuration: planData.estimatedTotalDuration || 
          tasks.reduce((sum, task) => sum + (task.estimatedDuration || 0), 0),
        createdAt: new Date(),
        approved: false
      };
    } catch (error) {
      console.error('Failed to analyze request:', error);
      throw new Error('Failed to create task plan');
    }
  }

  async decomposeTask(task: Task): Promise<SubTask[]> {
    const prompt = `Break down the following task into specific, actionable subtasks:
    
    Task: ${task.name}
    Description: ${task.description}
    
    Return a JSON array of subtasks with:
    {
      "subtasks": [
        {
          "name": "Subtask name",
          "description": "Specific action to take",
          "order": number,
          "estimatedDuration": number (in seconds)
        }
      ]
    }
    
    Guidelines:
    - Each subtask should be a single, clear action
    - Order subtasks logically
    - Keep subtasks small and manageable`;

    try {
      const fullPrompt = `${prompt}\n\nDecompose this task: ${task.description}`;
      const response = await this.chatAgent.chat(fullPrompt);

      const subtaskData = this.parseAIResponse(response);
      
      return subtaskData.subtasks.map((data: any, index: number) => ({
        id: `${task.id}-sub-${index}`,
        parentId: task.id,
        name: data.name,
        description: data.description,
        order: data.order || index,
        priority: task.priority,
        status: 'pending' as TaskStatus,
        estimatedDuration: data.estimatedDuration,
        createdAt: new Date(),
        updatedAt: new Date()
      }));
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
      console.error('Failed to parse AI response:', error);
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
}