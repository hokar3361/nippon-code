import { TaskPlanner } from '../planner';
import { Task, TaskPlan } from '../interfaces';
import { ChatAgent } from '../../agents/chat';

// Mock ChatAgent
jest.mock('../../agents/chat');

describe('TaskPlanner', () => {
  let planner: TaskPlanner;
  let mockChatAgent: jest.Mocked<ChatAgent>;

  beforeEach(() => {
    jest.clearAllMocks();
    planner = new TaskPlanner();
    
    // Get the mocked ChatAgent instance
    const ChatAgentMock = ChatAgent as jest.MockedClass<typeof ChatAgent>;
    mockChatAgent = ChatAgentMock.mock.instances[0] as jest.Mocked<ChatAgent>;
  });

  describe('analyzeRequest', () => {
    it('should create a task plan from user input', async () => {
      const userInput = 'Build a REST API with authentication';
      const mockResponse = JSON.stringify({
        tasks: [
          {
            name: 'Setup project',
            description: 'Initialize Node.js project',
            priority: 'high',
            estimatedDuration: 300,
            dependencies: []
          },
          {
            name: 'Implement authentication',
            description: 'Add JWT authentication',
            priority: 'high',
            estimatedDuration: 600,
            dependencies: []
          }
        ],
        estimatedTotalDuration: 900
      });

      mockChatAgent.chat.mockResolvedValue(mockResponse);

      const plan = await planner.analyzeRequest(userInput);

      expect(plan.userRequest).toBe(userInput);
      expect(plan.tasks).toHaveLength(2);
      expect(plan.tasks[0].name).toBe('Setup project');
      expect(plan.tasks[1].name).toBe('Implement authentication');
      expect(plan.estimatedTotalDuration).toBe(900);
      expect(plan.approved).toBe(false);
    });

    it('should handle AI response parsing errors gracefully', async () => {
      const userInput = 'Invalid request';
      mockChatAgent.chat.mockResolvedValue('Invalid JSON response');

      const plan = await planner.analyzeRequest(userInput);

      expect(plan.userRequest).toBe(userInput);
      expect(plan.tasks).toHaveLength(0);
      expect(plan.estimatedTotalDuration).toBe(0);
    });

    it('should assign unique IDs to tasks', async () => {
      const userInput = 'Create multiple tasks';
      const mockResponse = JSON.stringify({
        tasks: [
          {
            name: 'Task 1',
            description: 'Description 1',
            priority: 'medium',
            estimatedDuration: 100
          },
          {
            name: 'Task 2',
            description: 'Description 2',
            priority: 'low',
            estimatedDuration: 200
          }
        ],
        estimatedTotalDuration: 300
      });

      mockChatAgent.chat.mockResolvedValue(mockResponse);

      const plan = await planner.analyzeRequest(userInput);

      expect(plan.tasks[0].id).toMatch(/^task-.*-0$/);
      expect(plan.tasks[1].id).toMatch(/^task-.*-1$/);
      expect(plan.tasks[0].id).not.toBe(plan.tasks[1].id);
    });
  });

  describe('decomposeTask', () => {
    it('should decompose a task into subtasks', async () => {
      const task: Task = {
        id: 'task-1',
        name: 'Build API',
        description: 'Create REST API endpoints',
        priority: 'high',
        status: 'pending',
        createdAt: new Date(),
        updatedAt: new Date()
      };

      const mockResponse = JSON.stringify({
        subtasks: [
          {
            name: 'Setup Express',
            description: 'Initialize Express server',
            order: 1,
            estimatedDuration: 100
          },
          {
            name: 'Create routes',
            description: 'Define API routes',
            order: 2,
            estimatedDuration: 200
          }
        ]
      });

      mockChatAgent.chat.mockResolvedValue(mockResponse);

      const subtasks = await planner.decomposeTask(task);

      expect(subtasks).toHaveLength(2);
      expect(subtasks[0].parentId).toBe('task-1');
      expect(subtasks[0].name).toBe('Setup Express');
      expect(subtasks[1].name).toBe('Create routes');
      expect(subtasks[0].order).toBe(1);
      expect(subtasks[1].order).toBe(2);
    });

    it('should handle decomposition errors gracefully', async () => {
      const task: Task = {
        id: 'task-2',
        name: 'Invalid task',
        description: 'This will fail',
        priority: 'low',
        status: 'pending',
        createdAt: new Date(),
        updatedAt: new Date()
      };

      mockChatAgent.chat.mockRejectedValue(new Error('AI error'));

      const subtasks = await planner.decomposeTask(task);

      expect(subtasks).toHaveLength(0);
    });
  });

  describe('validatePlan', () => {
    it('should validate a valid plan', async () => {
      const plan: TaskPlan = {
        id: 'plan-1',
        userRequest: 'Valid plan',
        tasks: [
          {
            id: 'task-1',
            name: 'Task 1',
            description: 'Description 1',
            priority: 'high',
            status: 'pending',
            estimatedDuration: 100,
            createdAt: new Date(),
            updatedAt: new Date()
          }
        ],
        estimatedTotalDuration: 100,
        createdAt: new Date(),
        approved: false
      };

      const result = await planner.validatePlan(plan);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
    });

    it('should detect empty plan', async () => {
      const plan: TaskPlan = {
        id: 'plan-2',
        userRequest: 'Empty plan',
        tasks: [],
        estimatedTotalDuration: 0,
        createdAt: new Date(),
        approved: false
      };

      const result = await planner.validatePlan(plan);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Plan has no tasks');
    });

    it('should detect missing task information', async () => {
      const plan: TaskPlan = {
        id: 'plan-3',
        userRequest: 'Invalid tasks',
        tasks: [
          {
            id: 'task-1',
            name: '',
            description: '',
            priority: 'medium',
            status: 'pending',
            createdAt: new Date(),
            updatedAt: new Date()
          }
        ],
        estimatedTotalDuration: 0,
        createdAt: new Date(),
        approved: false
      };

      const result = await planner.validatePlan(plan);

      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('missing required information');
    });

    it('should detect invalid dependencies', async () => {
      const plan: TaskPlan = {
        id: 'plan-4',
        userRequest: 'Invalid dependencies',
        tasks: [
          {
            id: 'task-1',
            name: 'Task 1',
            description: 'Description 1',
            priority: 'high',
            status: 'pending',
            dependencies: ['non-existent-task'],
            createdAt: new Date(),
            updatedAt: new Date()
          }
        ],
        estimatedTotalDuration: 100,
        createdAt: new Date(),
        approved: false
      };

      const result = await planner.validatePlan(plan);

      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('invalid dependency');
    });

    it('should warn about missing duration estimates', async () => {
      const plan: TaskPlan = {
        id: 'plan-5',
        userRequest: 'No duration',
        tasks: [
          {
            id: 'task-1',
            name: 'Task 1',
            description: 'Description 1',
            priority: 'low',
            status: 'pending',
            createdAt: new Date(),
            updatedAt: new Date()
          }
        ],
        estimatedTotalDuration: 0,
        createdAt: new Date(),
        approved: false
      };

      const result = await planner.validatePlan(plan);

      expect(result.warnings[0]).toContain('no duration estimate');
    });

    it('should warn about very long tasks', async () => {
      const plan: TaskPlan = {
        id: 'plan-6',
        userRequest: 'Long task',
        tasks: [
          {
            id: 'task-1',
            name: 'Long Task',
            description: 'This will take a while',
            priority: 'medium',
            status: 'pending',
            estimatedDuration: 7200, // 2 hours
            createdAt: new Date(),
            updatedAt: new Date()
          }
        ],
        estimatedTotalDuration: 7200,
        createdAt: new Date(),
        approved: false
      };

      const result = await planner.validatePlan(plan);

      expect(result.warnings[0]).toContain('very long duration');
      expect(result.suggestions![0]).toContain('breaking down');
    });

    it('should detect circular dependencies', async () => {
      const plan: TaskPlan = {
        id: 'plan-7',
        userRequest: 'Circular dependencies',
        tasks: [
          {
            id: 'task-1',
            name: 'Task 1',
            description: 'Description 1',
            priority: 'high',
            status: 'pending',
            dependencies: ['task-2'],
            createdAt: new Date(),
            updatedAt: new Date()
          },
          {
            id: 'task-2',
            name: 'Task 2',
            description: 'Description 2',
            priority: 'high',
            status: 'pending',
            dependencies: ['task-1'],
            createdAt: new Date(),
            updatedAt: new Date()
          }
        ],
        estimatedTotalDuration: 200,
        createdAt: new Date(),
        approved: false
      };

      const result = await planner.validatePlan(plan);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Plan contains circular dependencies');
    });
  });

  describe('getExecutionOrder', () => {
    it('should return tasks in correct dependency order', () => {
      const tasks: Task[] = [
        {
          id: 'task-1',
          name: 'Task 1',
          description: 'First task',
          priority: 'high',
          status: 'pending',
          dependencies: ['task-2'],
          createdAt: new Date(),
          updatedAt: new Date()
        },
        {
          id: 'task-2',
          name: 'Task 2',
          description: 'Second task',
          priority: 'medium',
          status: 'pending',
          createdAt: new Date(),
          updatedAt: new Date()
        },
        {
          id: 'task-3',
          name: 'Task 3',
          description: 'Third task',
          priority: 'low',
          status: 'pending',
          dependencies: ['task-1'],
          createdAt: new Date(),
          updatedAt: new Date()
        }
      ];

      const ordered = planner.getExecutionOrder(tasks);

      expect(ordered[0].id).toBe('task-2');
      expect(ordered[1].id).toBe('task-1');
      expect(ordered[2].id).toBe('task-3');
    });

    it('should handle tasks without dependencies', () => {
      const tasks: Task[] = [
        {
          id: 'task-1',
          name: 'Independent 1',
          description: 'No dependencies',
          priority: 'high',
          status: 'pending',
          createdAt: new Date(),
          updatedAt: new Date()
        },
        {
          id: 'task-2',
          name: 'Independent 2',
          description: 'No dependencies',
          priority: 'low',
          status: 'pending',
          createdAt: new Date(),
          updatedAt: new Date()
        }
      ];

      const ordered = planner.getExecutionOrder(tasks);

      expect(ordered).toHaveLength(2);
      expect(ordered.map(t => t.id)).toContain('task-1');
      expect(ordered.map(t => t.id)).toContain('task-2');
    });
  });

  describe('buildDependencyGraph', () => {
    it('should build correct dependency graph', () => {
      const tasks: Task[] = [
        {
          id: 'task-1',
          name: 'Task 1',
          description: 'First task',
          priority: 'high',
          status: 'pending',
          dependencies: ['task-2'],
          createdAt: new Date(),
          updatedAt: new Date()
        },
        {
          id: 'task-2',
          name: 'Task 2',
          description: 'Second task',
          priority: 'medium',
          status: 'pending',
          createdAt: new Date(),
          updatedAt: new Date()
        }
      ];

      const graph = planner.buildDependencyGraph(tasks);

      expect(graph.nodes).toEqual(tasks);
      expect(graph.edges).toHaveLength(1);
      expect(graph.edges[0]).toEqual({ from: 'task-2', to: 'task-1' });
    });
  });

  describe('formatPlanForDisplay', () => {
    it('should format plan for display', () => {
      const plan: TaskPlan = {
        id: 'plan-display',
        userRequest: 'Test display',
        tasks: [
          {
            id: 'task-1',
            name: 'Critical Task',
            description: 'Very important',
            priority: 'critical',
            status: 'pending',
            estimatedDuration: 300,
            createdAt: new Date(),
            updatedAt: new Date()
          },
          {
            id: 'task-2',
            name: 'High Priority Task',
            description: 'Important task',
            priority: 'high',
            status: 'pending',
            estimatedDuration: 600,
            dependencies: ['task-1'],
            createdAt: new Date(),
            updatedAt: new Date()
          }
        ],
        estimatedTotalDuration: 900,
        createdAt: new Date(),
        approved: false
      };

      const display = planner.formatPlanForDisplay(plan);

      expect(display).toContain('📋 Execution Plan');
      expect(display).toContain('Test display');
      expect(display).toContain('15m 0s'); // Total duration
      expect(display).toContain('🔴'); // Critical priority emoji
      expect(display).toContain('🟠'); // High priority emoji
      expect(display).toContain('[depends on: task-1]');
    });
  });
});