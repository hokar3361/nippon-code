export type TaskPriority = 'critical' | 'high' | 'medium' | 'low';
export type TaskStatus = 'pending' | 'planning' | 'executing' | 'completed' | 'failed' | 'skipped';
export type SafetyLevel = 'safe' | 'caution' | 'danger' | 'forbidden';
export type Permission = 'yes' | 'no' | 'always' | 'never';

export interface Task {
  id: string;
  name: string;
  description: string;
  priority: TaskPriority;
  status: TaskStatus;
  estimatedDuration?: number;
  dependencies?: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface SubTask extends Task {
  parentId: string;
  order: number;
}

export interface DetailedTask extends SubTask {
  steps: ExecutionStep[];
  resources: ResourceRequirement[];
  risks: Risk[];
  rollbackStrategy?: RollbackStrategy;
}

export interface ExecutionStep {
  id: string;
  description: string;
  command?: string;
  expectedOutput?: string;
  requiresApproval: boolean;
  safetyLevel: SafetyLevel;
}

export interface ResourceRequirement {
  type: 'file' | 'api' | 'permission' | 'tool';
  name: string;
  required: boolean;
}

export interface Risk {
  type: string;
  description: string;
  probability: 'high' | 'medium' | 'low';
  impact: 'high' | 'medium' | 'low';
  mitigation: string;
}

export interface RollbackStrategy {
  steps: string[];
  automatic: boolean;
}

export interface TaskPlan {
  id: string;
  userRequest: string;
  tasks: Task[];
  estimatedTotalDuration: number;
  createdAt: Date;
  approved: boolean;
  approvedAt?: Date;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  suggestions?: string[];
}

export interface ExecutionResult {
  taskId: string;
  status: 'success' | 'failure' | 'partial';
  output?: any;
  error?: Error;
  duration: number;
  executedAt: Date;
  logs: LogEntry[];
}

export interface LogEntry {
  timestamp: Date;
  level: 'info' | 'warning' | 'error' | 'debug';
  message: string;
  metadata?: any;
}

export interface ProgressUpdate {
  taskId: string;
  progress: number;
  currentStep?: string;
  message?: string;
  timestamp: Date;
}

export interface DependencyGraph {
  nodes: Task[];
  edges: Array<{ from: string; to: string }>;
}

export interface ResourceEstimate {
  timeInSeconds: number;
  apiCalls: number;
  fileOperations: number;
  memoryUsageMB?: number;
}

export interface CompletedExecution {
  planId: string;
  results: ExecutionResult[];
  totalDuration: number;
  successRate: number;
  completedAt: Date;
}

export interface ValidationReport {
  allTasksCompleted: boolean;
  failedTasks: string[];
  warnings: string[];
  recommendations: string[];
}

export interface Command {
  id: string;
  type: 'shell' | 'file' | 'api' | 'internal';
  command: string;
  args?: string[];
  workingDirectory?: string;
  environment?: Record<string, string>;
}

export interface CommandIntent {
  purpose: string;
  category: 'read' | 'write' | 'execute' | 'delete' | 'network';
  targetResources: string[];
  estimatedRisk: SafetyLevel;
  alternatives?: string[];
}

export interface DryRunResult {
  command: Command;
  simulatedOutput: string;
  estimatedChanges: string[];
  safetyLevel: SafetyLevel;
  warnings: string[];
}

export interface SandboxResult {
  command: Command;
  output: string;
  exitCode: number;
  filesModified: string[];
  resourcesAccessed: string[];
  duration: number;
}

export interface SnapshotId {
  id: string;
  file: string;
  createdAt: Date;
}

export interface Snapshot {
  id: SnapshotId;
  content: string;
  metadata: {
    size: number;
    hash: string;
    reason?: string;
  };
}

export interface Change {
  type: 'add' | 'remove' | 'modify';
  path: string;
  lineNumber?: number;
  oldContent?: string;
  newContent?: string;
}

export interface Diff {
  file: string;
  changes: Change[];
  additions: number;
  deletions: number;
}

export interface ImpactAnalysis {
  affectedFiles: string[];
  estimatedRisk: SafetyLevel;
  dependencies: string[];
  testCoverage?: number;
}

export interface FormatStyle {
  indentation: 'tabs' | 'spaces';
  indentSize: number;
  lineEnding: 'lf' | 'crlf';
  quotes: 'single' | 'double';
}