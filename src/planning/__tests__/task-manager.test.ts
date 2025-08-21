import { TaskManager } from '../task-manager';
import { Task, TaskPlan, ExecutionResult } from '../interfaces';

describe('TaskManager', () => {
  let taskManager: TaskManager;

  beforeEach(() => {
    taskManager = new TaskManager();
  });

  describe('registerPlan', () => {
    it('should register a plan and its tasks', () => {
      const plan: TaskPlan = {
        id: 'plan-1',
        userRequest: 'Test request',
        tasks: [
          {
            id: 'task-1',
            name: 'Test Task',
            description: 'Test description',
            priority: 'medium',
            status: 'pending',
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
        estimatedTotalDuration: 60,
        createdAt: new Date(),
        approved: false,
      };

      taskManager.registerPlan(plan);

      expect(taskManager.getPlan('plan-1')).toEqual(plan);
      expect(taskManager.getTask('task-1')).toEqual(plan.tasks[0]);
    });

    it('should emit plan:registered event', (done) => {
      const plan: TaskPlan = {
        id: 'plan-2',
        userRequest: 'Test request',
        tasks: [],
        estimatedTotalDuration: 0,
        createdAt: new Date(),
        approved: false,
      };

      taskManager.on('plan:registered', (registeredPlan) => {
        expect(registeredPlan).toEqual(plan);
        done();
      });

      taskManager.registerPlan(plan);
    });
  });

  describe('approvePlan', () => {
    it('should approve a plan', () => {
      const plan: TaskPlan = {
        id: 'plan-3',
        userRequest: 'Test request',
        tasks: [],
        estimatedTotalDuration: 0,
        createdAt: new Date(),
        approved: false,
      };

      taskManager.registerPlan(plan);
      const result = taskManager.approvePlan('plan-3');

      expect(result).toBe(true);
      const approvedPlan = taskManager.getPlan('plan-3');
      expect(approvedPlan?.approved).toBe(true);
      expect(approvedPlan?.approvedAt).toBeInstanceOf(Date);
    });

    it('should return false for non-existent plan', () => {
      const result = taskManager.approvePlan('non-existent');
      expect(result).toBe(false);
    });
  });

  describe('updateTaskStatus', () => {
    it('should update task status', () => {
      const task: Task = {
        id: 'task-4',
        name: 'Test Task',
        description: 'Test description',
        priority: 'high',
        status: 'pending',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const plan: TaskPlan = {
        id: 'plan-4',
        userRequest: 'Test request',
        tasks: [task],
        estimatedTotalDuration: 60,
        createdAt: new Date(),
        approved: false,
      };

      taskManager.registerPlan(plan);
      taskManager.updateTaskStatus('task-4', 'executing');

      const updatedTask = taskManager.getTask('task-4');
      expect(updatedTask?.status).toBe('executing');
    });

    it('should set activeTaskId when status is executing', () => {
      const task: Task = {
        id: 'task-5',
        name: 'Test Task',
        description: 'Test description',
        priority: 'critical',
        status: 'pending',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const plan: TaskPlan = {
        id: 'plan-5',
        userRequest: 'Test request',
        tasks: [task],
        estimatedTotalDuration: 60,
        createdAt: new Date(),
        approved: false,
      };

      taskManager.registerPlan(plan);
      taskManager.updateTaskStatus('task-5', 'executing');

      const activeTask = taskManager.getActiveTask();
      expect(activeTask?.id).toBe('task-5');
    });

    it('should clear activeTaskId when task completes', () => {
      const task: Task = {
        id: 'task-6',
        name: 'Test Task',
        description: 'Test description',
        priority: 'medium',
        status: 'executing',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const plan: TaskPlan = {
        id: 'plan-6',
        userRequest: 'Test request',
        tasks: [task],
        estimatedTotalDuration: 60,
        createdAt: new Date(),
        approved: false,
      };

      taskManager.registerPlan(plan);
      taskManager.updateTaskStatus('task-6', 'executing');
      taskManager.updateTaskStatus('task-6', 'completed');

      const activeTask = taskManager.getActiveTask();
      expect(activeTask).toBeNull();
    });
  });

  describe('recordResult', () => {
    it('should record execution result and update task status', () => {
      const task: Task = {
        id: 'task-7',
        name: 'Test Task',
        description: 'Test description',
        priority: 'low',
        status: 'executing',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const plan: TaskPlan = {
        id: 'plan-7',
        userRequest: 'Test request',
        tasks: [task],
        estimatedTotalDuration: 60,
        createdAt: new Date(),
        approved: false,
      };

      const result: ExecutionResult = {
        taskId: 'task-7',
        status: 'success',
        output: { test: 'output' },
        duration: 1000,
        executedAt: new Date(),
        logs: [],
      };

      taskManager.registerPlan(plan);
      taskManager.recordResult(result);

      const updatedTask = taskManager.getTask('task-7');
      expect(updatedTask?.status).toBe('completed');
    });

    it('should set task status to failed when result status is failure', () => {
      const task: Task = {
        id: 'task-8',
        name: 'Test Task',
        description: 'Test description',
        priority: 'high',
        status: 'executing',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const plan: TaskPlan = {
        id: 'plan-8',
        userRequest: 'Test request',
        tasks: [task],
        estimatedTotalDuration: 60,
        createdAt: new Date(),
        approved: false,
      };

      const result: ExecutionResult = {
        taskId: 'task-8',
        status: 'failure',
        error: new Error('Test error'),
        duration: 500,
        executedAt: new Date(),
        logs: [],
      };

      taskManager.registerPlan(plan);
      taskManager.recordResult(result);

      const updatedTask = taskManager.getTask('task-8');
      expect(updatedTask?.status).toBe('failed');
    });
  });

  describe('getPlanProgress', () => {
    it('should calculate plan progress correctly', () => {
      const tasks: Task[] = [
        {
          id: 'task-9-1',
          name: 'Task 1',
          description: 'Description 1',
          priority: 'high',
          status: 'completed',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: 'task-9-2',
          name: 'Task 2',
          description: 'Description 2',
          priority: 'medium',
          status: 'executing',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: 'task-9-3',
          name: 'Task 3',
          description: 'Description 3',
          priority: 'low',
          status: 'failed',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: 'task-9-4',
          name: 'Task 4',
          description: 'Description 4',
          priority: 'medium',
          status: 'pending',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      const plan: TaskPlan = {
        id: 'plan-9',
        userRequest: 'Test request',
        tasks,
        estimatedTotalDuration: 240,
        createdAt: new Date(),
        approved: false,
      };

      taskManager.registerPlan(plan);
      const progress = taskManager.getPlanProgress('plan-9');

      expect(progress.total).toBe(4);
      expect(progress.completed).toBe(1);
      expect(progress.failed).toBe(1);
      expect(progress.inProgress).toBe(1);
      expect(progress.percentage).toBe(25);
    });

    it('should return empty progress for non-existent plan', () => {
      const progress = taskManager.getPlanProgress('non-existent');
      
      expect(progress.total).toBe(0);
      expect(progress.completed).toBe(0);
      expect(progress.failed).toBe(0);
      expect(progress.inProgress).toBe(0);
      expect(progress.percentage).toBe(0);
    });
  });

  describe('getNextPendingTask', () => {
    it('should return next pending task without dependencies', () => {
      const tasks: Task[] = [
        {
          id: 'task-10-1',
          name: 'Task 1',
          description: 'Description 1',
          priority: 'high',
          status: 'completed',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: 'task-10-2',
          name: 'Task 2',
          description: 'Description 2',
          priority: 'medium',
          status: 'pending',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      const plan: TaskPlan = {
        id: 'plan-10',
        userRequest: 'Test request',
        tasks,
        estimatedTotalDuration: 120,
        createdAt: new Date(),
        approved: false,
      };

      taskManager.registerPlan(plan);
      const nextTask = taskManager.getNextPendingTask('plan-10');

      expect(nextTask?.id).toBe('task-10-2');
    });

    it('should return pending task with completed dependencies', () => {
      const tasks: Task[] = [
        {
          id: 'task-11-1',
          name: 'Task 1',
          description: 'Description 1',
          priority: 'high',
          status: 'completed',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: 'task-11-2',
          name: 'Task 2',
          description: 'Description 2',
          priority: 'medium',
          status: 'pending',
          dependencies: ['task-11-1'],
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      const plan: TaskPlan = {
        id: 'plan-11',
        userRequest: 'Test request',
        tasks,
        estimatedTotalDuration: 120,
        createdAt: new Date(),
        approved: false,
      };

      taskManager.registerPlan(plan);
      const nextTask = taskManager.getNextPendingTask('plan-11');

      expect(nextTask?.id).toBe('task-11-2');
    });

    it('should not return pending task with incomplete dependencies', () => {
      const tasks: Task[] = [
        {
          id: 'task-12-1',
          name: 'Task 1',
          description: 'Description 1',
          priority: 'high',
          status: 'pending',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: 'task-12-2',
          name: 'Task 2',
          description: 'Description 2',
          priority: 'medium',
          status: 'pending',
          dependencies: ['task-12-1'],
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      const plan: TaskPlan = {
        id: 'plan-12',
        userRequest: 'Test request',
        tasks,
        estimatedTotalDuration: 120,
        createdAt: new Date(),
        approved: false,
      };

      taskManager.registerPlan(plan);
      const nextTask = taskManager.getNextPendingTask('plan-12');

      expect(nextTask?.id).toBe('task-12-1');
    });
  });

  describe('skipTask', () => {
    it('should skip a task with reason', () => {
      const task: Task = {
        id: 'task-13',
        name: 'Test Task',
        description: 'Test description',
        priority: 'low',
        status: 'pending',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const plan: TaskPlan = {
        id: 'plan-13',
        userRequest: 'Test request',
        tasks: [task],
        estimatedTotalDuration: 60,
        createdAt: new Date(),
        approved: false,
      };

      taskManager.registerPlan(plan);
      taskManager.skipTask('task-13', 'Test reason');

      const skippedTask = taskManager.getTask('task-13');
      expect(skippedTask?.status).toBe('skipped');
    });
  });

  describe('clearPlan', () => {
    it('should clear a plan and its associated data', () => {
      const plan: TaskPlan = {
        id: 'plan-14',
        userRequest: 'Test request',
        tasks: [
          {
            id: 'task-14',
            name: 'Test Task',
            description: 'Test description',
            priority: 'medium',
            status: 'pending',
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
        estimatedTotalDuration: 60,
        createdAt: new Date(),
        approved: false,
      };

      taskManager.registerPlan(plan);
      taskManager.clearPlan('plan-14');

      expect(taskManager.getPlan('plan-14')).toBeUndefined();
      expect(taskManager.getTask('task-14')).toBeUndefined();
    });
  });

  describe('getActivePlans', () => {
    it('should return only active plans', () => {
      const activePlan: TaskPlan = {
        id: 'plan-15',
        userRequest: 'Active plan',
        tasks: [
          {
            id: 'task-15',
            name: 'Active Task',
            description: 'Active description',
            priority: 'high',
            status: 'executing',
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
        estimatedTotalDuration: 60,
        createdAt: new Date(),
        approved: true,
      };

      const completedPlan: TaskPlan = {
        id: 'plan-16',
        userRequest: 'Completed plan',
        tasks: [
          {
            id: 'task-16',
            name: 'Completed Task',
            description: 'Completed description',
            priority: 'low',
            status: 'completed',
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
        estimatedTotalDuration: 30,
        createdAt: new Date(),
        approved: true,
      };

      taskManager.registerPlan(activePlan);
      taskManager.registerPlan(completedPlan);

      const activePlans = taskManager.getActivePlans();
      expect(activePlans).toHaveLength(1);
      expect(activePlans[0].id).toBe('plan-15');
    });
  });
});