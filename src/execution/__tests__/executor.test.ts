import { TaskExecutor } from '../executor';
import { TaskManager } from '../../planning/task-manager';
import { DetailedTask, ExecutionStep, SafetyLevel } from '../../planning/interfaces';
import { ChatAgent } from '../../agents/chat';
import { spawn } from 'child_process';
import * as fs from 'fs/promises';

// Mock dependencies
jest.mock('../../agents/chat');
jest.mock('child_process');
jest.mock('fs/promises');

describe('TaskExecutor', () => {
  let executor: TaskExecutor;
  let taskManager: TaskManager;
  let mockChatAgent: jest.Mocked<ChatAgent>;

  beforeEach(() => {
    jest.clearAllMocks();
    taskManager = new TaskManager();
    executor = new TaskExecutor(taskManager);
    
    // Get the mocked ChatAgent instance
    const ChatAgentMock = ChatAgent as jest.MockedClass<typeof ChatAgent>;
    mockChatAgent = ChatAgentMock.mock.instances[0] as jest.Mocked<ChatAgent>;
  });

  describe('executeTask', () => {
    it('should execute a simple task successfully', async () => {
      const task: DetailedTask = {
        id: 'task-1',
        parentId: 'parent-1',
        order: 1,
        name: 'Test Task',
        description: 'Test description',
        priority: 'medium',
        status: 'pending',
        steps: [
          {
            id: 'step-1',
            description: 'Test step',
            requiresApproval: false,
            safetyLevel: 'safe' as SafetyLevel
          }
        ],
        resources: [],
        risks: [],
        createdAt: new Date(),
        updatedAt: new Date()
      };

      const result = await executor.executeTask(task);

      expect(result.taskId).toBe('task-1');
      expect(result.status).toBe('success');
      expect(result.duration).toBeGreaterThan(0);
    });

    it('should handle task with approval requirement', async () => {
      const task: DetailedTask = {
        id: 'task-2',
        parentId: 'parent-2',
        order: 1,
        name: 'Approval Task',
        description: 'Requires approval',
        priority: 'high',
        status: 'pending',
        steps: [
          {
            id: 'step-1',
            description: 'Dangerous step',
            requiresApproval: true,
            safetyLevel: 'danger' as SafetyLevel
          }
        ],
        resources: [],
        risks: [],
        createdAt: new Date(),
        updatedAt: new Date()
      };

      // Simulate approval
      setTimeout(() => {
        executor.emit('approval:response', true);
      }, 100);

      const result = await executor.executeTask(task);

      expect(result.status).toBe('success');
    });

    it('should skip step when approval is denied', async () => {
      const task: DetailedTask = {
        id: 'task-3',
        parentId: 'parent-3',
        order: 1,
        name: 'Denied Task',
        description: 'Will be denied',
        priority: 'critical',
        status: 'pending',
        steps: [
          {
            id: 'step-1',
            description: 'Will be skipped',
            requiresApproval: true,
            safetyLevel: 'caution' as SafetyLevel
          }
        ],
        resources: [],
        risks: [],
        createdAt: new Date(),
        updatedAt: new Date()
      };

      // Simulate denial
      setTimeout(() => {
        executor.emit('approval:response', false);
      }, 100);

      const result = await executor.executeTask(task);

      expect(result.status).toBe('success');
      expect(result.logs.some(log => log.message.includes('skipped'))).toBe(true);
    });

    it('should handle task execution failure', async () => {
      const task: DetailedTask = {
        id: 'task-4',
        parentId: 'parent-4',
        order: 1,
        name: 'Failing Task',
        description: 'Will fail',
        priority: 'low',
        status: 'pending',
        steps: [
          {
            id: 'step-1',
            description: 'Failing step',
            command: 'shell: invalid-command',
            requiresApproval: false,
            safetyLevel: 'safe' as SafetyLevel
          }
        ],
        resources: [],
        risks: [],
        createdAt: new Date(),
        updatedAt: new Date()
      };

      // Mock spawn to simulate failure
      const mockSpawn = spawn as jest.MockedFunction<typeof spawn>;
      const mockChildProcess = {
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn((event, callback) => {
          if (event === 'data') callback('Command not found');
        }) },
        on: jest.fn((event, callback) => {
          if (event === 'close') callback(1);
        }),
        kill: jest.fn()
      };
      mockSpawn.mockReturnValue(mockChildProcess as any);

      const result = await executor.executeTask(task);

      expect(result.status).toBe('failure');
      expect(result.error).toBeDefined();
    });

    it('should execute rollback on failure when automatic rollback is enabled', async () => {
      const task: DetailedTask = {
        id: 'task-5',
        parentId: 'parent-5',
        order: 1,
        name: 'Rollback Task',
        description: 'Has rollback',
        priority: 'high',
        status: 'pending',
        steps: [
          {
            id: 'step-1',
            description: 'Will fail',
            command: 'shell: exit 1',
            requiresApproval: false,
            safetyLevel: 'safe' as SafetyLevel
          }
        ],
        resources: [],
        risks: [],
        rollbackStrategy: {
          steps: ['echo "Rolling back"'],
          automatic: true
        },
        createdAt: new Date(),
        updatedAt: new Date()
      };

      // Mock spawn for both main command and rollback
      const mockSpawn = spawn as jest.MockedFunction<typeof spawn>;
      let callCount = 0;
      mockSpawn.mockImplementation(() => {
        callCount++;
        const mockChildProcess = {
          stdout: { on: jest.fn() },
          stderr: { on: jest.fn() },
          on: jest.fn((event, callback) => {
            if (event === 'close') {
              // First call fails, rollback succeeds
              callback(callCount === 1 ? 1 : 0);
            }
          }),
          kill: jest.fn()
        };
        return mockChildProcess as any;
      });

      const result = await executor.executeTask(task);

      expect(result.status).toBe('failure');
      expect(mockSpawn).toHaveBeenCalledTimes(2); // Main command + rollback
    });

    it('should abort execution when aborted', async () => {
      const task: DetailedTask = {
        id: 'task-6',
        parentId: 'parent-6',
        order: 1,
        name: 'Aborted Task',
        description: 'Will be aborted',
        priority: 'medium',
        status: 'pending',
        steps: [
          {
            id: 'step-1',
            description: 'Long running step',
            command: 'shell: sleep 10',
            requiresApproval: false,
            safetyLevel: 'safe' as SafetyLevel
          }
        ],
        resources: [],
        risks: [],
        createdAt: new Date(),
        updatedAt: new Date()
      };

      // Start execution
      const executionPromise = executor.executeTask(task);

      // Abort after a short delay
      setTimeout(() => {
        executor.abort();
      }, 50);

      const result = await executionPromise;

      expect(result.status).toBe('failure');
      expect(result.error?.message).toContain('aborted');
    });
  });

  describe('analyzeCommandIntent', () => {
    it('should analyze command intent correctly', async () => {
      const mockResponse = JSON.stringify({
        purpose: 'Delete temporary files',
        category: 'delete',
        targetResources: ['/tmp/*'],
        estimatedRisk: 'caution'
      });

      mockChatAgent.chat.mockResolvedValue(mockResponse);

      const intent = await executor.analyzeCommandIntent({
        id: 'cmd-1',
        type: 'shell',
        command: 'rm',
        args: ['-rf', '/tmp/*']
      });

      expect(intent.purpose).toBe('Delete temporary files');
      expect(intent.category).toBe('delete');
      expect(intent.targetResources).toContain('/tmp/*');
      expect(intent.estimatedRisk).toBe('caution');
    });

    it('should handle analysis failure gracefully', async () => {
      mockChatAgent.chat.mockRejectedValue(new Error('AI error'));

      const intent = await executor.analyzeCommandIntent({
        id: 'cmd-2',
        type: 'shell',
        command: 'echo',
        args: ['test']
      });

      expect(intent.purpose).toBe('Unknown command');
      expect(intent.category).toBe('execute');
      expect(intent.estimatedRisk).toBe('caution');
    });
  });

  describe('dryRun', () => {
    it('should perform dry run analysis', async () => {
      const mockResponse = JSON.stringify({
        purpose: 'Create new directory',
        category: 'write',
        targetResources: ['./new-dir'],
        estimatedRisk: 'safe'
      });

      mockChatAgent.chat.mockResolvedValue(mockResponse);

      const result = await executor.dryRun({
        id: 'cmd-3',
        type: 'shell',
        command: 'mkdir',
        args: ['new-dir']
      });

      expect(result.simulatedOutput).toContain('[DRY RUN]');
      expect(result.estimatedChanges).toContain('Would modify: ./new-dir');
      expect(result.safetyLevel).toBe('safe');
      expect(result.warnings).toHaveLength(0);
    });

    it('should include warnings for dangerous commands', async () => {
      const mockResponse = JSON.stringify({
        purpose: 'Delete system files',
        category: 'delete',
        targetResources: ['/system/*'],
        estimatedRisk: 'danger'
      });

      mockChatAgent.chat.mockResolvedValue(mockResponse);

      const result = await executor.dryRun({
        id: 'cmd-4',
        type: 'shell',
        command: 'rm',
        args: ['-rf', '/system/*']
      });

      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain('High risk command');
      expect(result.safetyLevel).toBe('danger');
    });
  });

  describe('executeStep', () => {
    it('should simulate step without command', async () => {
      const step: ExecutionStep = {
        id: 'step-sim',
        description: 'Simulated step',
        requiresApproval: false,
        safetyLevel: 'safe' as SafetyLevel
      };

      const result = await executor.executeStep(step);

      expect(result.simulated).toBe(true);
      expect(result.description).toBe('Simulated step');
    });

    it('should check safety before executing', async () => {
      const step: ExecutionStep = {
        id: 'step-danger',
        description: 'Dangerous step',
        command: 'rm -rf /',
        requiresApproval: false,
        safetyLevel: 'danger' as SafetyLevel
      };

      mockChatAgent.chat.mockResolvedValue(JSON.stringify({
        purpose: 'Delete root',
        category: 'delete',
        targetResources: ['/'],
        estimatedRisk: 'forbidden'
      }));

      await expect(executor.executeStep(step)).rejects.toThrow('Safety check failed');
    });

    it('should execute shell command', async () => {
      const step: ExecutionStep = {
        id: 'step-shell',
        description: 'Shell command',
        command: 'echo test',
        requiresApproval: false,
        safetyLevel: 'safe' as SafetyLevel
      };

      mockChatAgent.chat.mockResolvedValue(JSON.stringify({
        purpose: 'Print text',
        category: 'read',
        targetResources: [],
        estimatedRisk: 'safe'
      }));

      const mockSpawn = spawn as jest.MockedFunction<typeof spawn>;
      const mockChildProcess = {
        stdout: { on: jest.fn((event, callback) => {
          if (event === 'data') callback('test\n');
        }) },
        stderr: { on: jest.fn() },
        on: jest.fn((event, callback) => {
          if (event === 'close') callback(0);
        }),
        kill: jest.fn()
      };
      mockSpawn.mockReturnValue(mockChildProcess as any);

      const result = await executor.executeStep(step);

      expect(result.stdout).toBe('test\n');
      expect(result.exitCode).toBe(0);
    });

    it('should execute file operation', async () => {
      const step: ExecutionStep = {
        id: 'step-file',
        description: 'File operation',
        command: 'file:read test.txt',
        requiresApproval: false,
        safetyLevel: 'safe' as SafetyLevel
      };

      mockChatAgent.chat.mockResolvedValue(JSON.stringify({
        purpose: 'Read file',
        category: 'read',
        targetResources: ['test.txt'],
        estimatedRisk: 'safe'
      }));

      const mockReadFile = fs.readFile as jest.MockedFunction<typeof fs.readFile>;
      mockReadFile.mockResolvedValue('File content');

      const result = await executor.executeStep(step);

      expect(result).toBe('File content');
      expect(mockReadFile).toHaveBeenCalledWith('test.txt', 'utf-8');
    });

    it('should execute internal command', async () => {
      const step: ExecutionStep = {
        id: 'step-internal',
        description: 'Internal command',
        command: 'internal:test-command arg1 arg2',
        requiresApproval: false,
        safetyLevel: 'safe' as SafetyLevel
      };

      mockChatAgent.chat.mockResolvedValue(JSON.stringify({
        purpose: 'Internal operation',
        category: 'execute',
        targetResources: [],
        estimatedRisk: 'safe'
      }));

      const result = await executor.executeStep(step);

      expect(result.executed).toBe(true);
      expect(result.command).toBe('test-command');
      expect(result.args).toEqual(['arg1', 'arg2']);
    });
  });
});