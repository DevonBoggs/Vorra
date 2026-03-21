// Core data types for Vorra

export interface Task {
  id: string;
  time: string;
  endTime: string;
  title: string;
  category: 'study' | 'review' | 'exam-prep' | 'exam-day' | 'project' | 'class' | 'break' | 'health' | 'work' | 'personal' | 'other';
  priority: 'high' | 'medium' | 'low';
  notes: string;
  done: boolean;
}

export interface Course {
  id: string;
  name: string;
  credits: number;
  difficulty: number;
  status: 'not_started' | 'in_progress' | 'completed';
  courseCode: string;
  department: string;
  assessmentType: string;
  // OA/PA details
  oaDetails: { format: string; questionCount: number; passingScore: string; timeLimit: string; proctoringTool: string; retakePolicy: string; };
  paDetails: { taskDescription: string; rubricSummary: string; submissionFormat: string; evaluatorNotes: string; };
  // Deep context
  competencies: Array<{ code: string; title: string; description: string; weight: string; }>;
  learningObjectives: string[];
  topicBreakdown: Array<{ topic: string; subtopics: string[]; weight: 'high' | 'medium' | 'low'; description: string; }>;
  keyTermsAndConcepts: Array<{ term: string; definition: string; }>;
  commonMistakes: string[];
  officialResources: Array<{ title: string; type: string; provider: string; notes: string; }>;
  recommendedExternal: Array<{ title: string; url: string; type: string; notes: string; }>;
  studyGuideNotes: string;
  examTips: string[];
  reportedDifficulty: number;
  averageStudyHours: number;
  passRate: string;
  versionInfo: string;
  knownFocusAreas: string[];
  personalConfidence: Record<string, number>;
  studyLog: any[];
  preAssessmentScore: number | null;
  preAssessmentWeakAreas: string[];
  attemptHistory: any[];
  prerequisites: string[];
  relatedCourses: string[];
  certAligned: string;
  lastUpdated: string;
  sourceNotes: string;
  // Strategy fields
  studyStrategy: string;
  quickWins: string[];
  hardestConcepts: string[];
  mnemonics: Array<{ concept: string; mnemonic: string; }>;
  weeklyMilestones: Array<{ week: number; goals: string; }>;
  studyOrder: string[];
  timeAllocation: Array<{ topic: string; percentage: number; }>;
  practiceTestNotes: string;
  instructorTips: string[];
  communityInsights: string[];
  // Confidence metadata (for enrichment verification)
  _confidence?: Record<string, 'high' | 'medium' | 'low'>;
  _lastVerified?: string;
}

export interface AIProfile {
  id: string;
  name: string;
  provider: string;
  apiKey: string;
  baseUrl: string;
  model: string;
}

export interface StudyStreak {
  lastStudyDate: string;
  currentStreak: number;
  longestStreak: number;
}

export interface NotificationSettings {
  enabled: boolean;
  studyReminder: { enabled: boolean; intervalMinutes: number; };
  breakReminder: { enabled: boolean; studyMinutes: number; };
  streakReminder: { enabled: boolean; hour: number; minute: number; };
  taskReminders: { enabled: boolean; minutesBefore: number; };
  sound: boolean;
}

export interface AppData {
  tasks: Record<string, Task[]>;
  profiles: AIProfile[];
  activeProfileId: string | null;
  courses: Course[];
  targetDate: string;
  targetCompletionDate: string;
  studyStartDate: string;
  studyStartTime: string;
  studyHoursPerDay: number;
  overrideSafeguards: boolean;
  exceptionDates: string[];
  userContext: string;
  universityProfile: string;
  chatHistories: Record<string, Array<{ role: string; content: string; }>>;
  theme: string;
  fontScale: number;
  uiZoom: number;
  ytApiKey: string;
  studySessions: any[];
  studyStreak: StudyStreak;
  dashboardWidgets?: string[];
  notifications?: NotificationSettings;
}

// Window augmentation for Electron bridge
declare global {
  interface Window {
    vorra?: {
      db: {
        get(key: string): Promise<any>;
        set(key: string, value: any): Promise<void>;
        getAll(): Promise<Record<string, any>>;
        export(): Promise<string>;
        import(json: string): Promise<void>;
        getPath(): Promise<string>;
      };
      backup: {
        save(path?: string): Promise<string>;
        restore(path: string): Promise<any>;
        listBackups(): Promise<Array<{ path: string; date: string; size: number; }>>;
        autoBackup(): Promise<void>;
      };
      platform: {
        isElectron: true;
        os: 'win32' | 'darwin' | 'linux';
        appVersion: string;
      };
      notify: {
        show(title: string, body: string, options?: any): Promise<void>;
        setBadge(count: number): Promise<void>;
      };
    };
  }
}
