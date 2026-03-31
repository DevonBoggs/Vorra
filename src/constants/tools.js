// AI Tool Definitions and Course Schema

export const EMPTY_DEEP = {
  courseCode:"",assessmentType:"",department:"",
  oaDetails:{format:"",questionCount:0,passingScore:"",timeLimit:"",proctoringTool:"",retakePolicy:""},
  paDetails:{taskDescription:"",rubricSummary:"",submissionFormat:"",evaluatorNotes:""},
  competencies:[],learningObjectives:[],
  topicBreakdown:[],keyTermsAndConcepts:[],commonMistakes:[],
  officialResources:[],recommendedExternal:[],studyGuideNotes:"",
  examTips:[],reportedDifficulty:3,averageStudyHours:0,passRate:"",versionInfo:"",
  knownFocusAreas:[],personalConfidence:{},studyLog:[],
  preAssessmentScore:null,preAssessmentWeakAreas:[],attemptHistory:[],
  prerequisites:[],relatedCourses:[],certAligned:"",lastUpdated:"",sourceNotes:"",
  // Study strategy fields
  studyStrategy:"", // "Read textbook → practice tests → review weak areas"
  quickWins:[], // Easy topics to build momentum
  hardestConcepts:[], // Concepts most students struggle with
  mnemonics:[], // [{concept,mnemonic}] Memory aids
  weeklyMilestones:[], // [{week,goals}] Week-by-week plan
  studyOrder:[], // Recommended order of topics within the course
  timeAllocation:[], // [{topic,percentage}] How to split study time
  practiceTestNotes:"", // Pre-assessment and practice test guidance
  instructorTips:[], // Course instructor tips
  communityInsights:[], // Reddit/Discord tips from other students
  examDate:"", // YYYY-MM-DD — when the exam/assessment is scheduled
};

export const CS = {
  name:{type:"string"},credits:{type:"number"},difficulty:{type:"number"},
  status:{type:"string",enum:["not_started","in_progress","completed"]},
  courseCode:{type:"string"},department:{type:"string"},
  assessmentType:{type:"string",enum:["OA","PA","OA+PA","Exam","Project","Essay","Lab","Presentation","Mixed"]},
  oaDetails:{type:"object",properties:{format:{type:"string"},questionCount:{type:"number"},passingScore:{type:"string"},timeLimit:{type:"string"},proctoringTool:{type:"string"},retakePolicy:{type:"string"}}},
  paDetails:{type:"object",properties:{taskDescription:{type:"string"},rubricSummary:{type:"string"},submissionFormat:{type:"string"},evaluatorNotes:{type:"string"}}},
  competencies:{type:"array",items:{type:"object",properties:{code:{type:"string"},title:{type:"string"},description:{type:"string"},weight:{type:"string"}}}},
  learningObjectives:{type:"array",items:{type:"string"}},
  topicBreakdown:{type:"array",items:{type:"object",properties:{topic:{type:"string"},subtopics:{type:"array",items:{type:"string"}},weight:{type:"string",enum:["high","medium","low"]},description:{type:"string"}}}},
  keyTermsAndConcepts:{type:"array",items:{type:"object",properties:{term:{type:"string"},definition:{type:"string"}}}},
  commonMistakes:{type:"array",items:{type:"string"}},
  officialResources:{type:"array",items:{type:"object",properties:{title:{type:"string"},type:{type:"string"},provider:{type:"string"},notes:{type:"string"}}}},
  recommendedExternal:{type:"array",items:{type:"object",properties:{title:{type:"string"},url:{type:"string"},type:{type:"string"},notes:{type:"string"}}}},
  studyGuideNotes:{type:"string"},examTips:{type:"array",items:{type:"string"}},
  reportedDifficulty:{type:"number"},averageStudyHours:{type:"number"},passRate:{type:"string"},
  versionInfo:{type:"string"},knownFocusAreas:{type:"array",items:{type:"string"}},
  prerequisites:{type:"array",items:{type:"string"}},relatedCourses:{type:"array",items:{type:"string"}},
  certAligned:{type:"string"},notes:{type:"string"},topics:{type:"string"},
  // Study strategy fields
  studyStrategy:{type:"string",description:"Recommended study approach e.g. 'Read textbook chapters 1-4, then practice tests, review weak areas'"},
  quickWins:{type:"array",items:{type:"string"},description:"Easy topics to tackle first for momentum and confidence"},
  hardestConcepts:{type:"array",items:{type:"string"},description:"Concepts most students struggle with — need extra focus"},
  mnemonics:{type:"array",items:{type:"object",properties:{concept:{type:"string"},mnemonic:{type:"string"}}},description:"Memory aids for key concepts"},
  weeklyMilestones:{type:"array",items:{type:"object",properties:{week:{type:"number"},goals:{type:"string"}}},description:"Week-by-week study plan"},
  studyOrder:{type:"array",items:{type:"string"},description:"Recommended order to study topics within the course"},
  timeAllocation:{type:"array",items:{type:"object",properties:{topic:{type:"string"},percentage:{type:"number"}}},description:"How to split study time, e.g. topic:Networking, percentage:40"},
  practiceTestNotes:{type:"string",description:"Pre-assessment strategy and practice test guidance"},
  instructorTips:{type:"array",items:{type:"string"},description:"Tips from course instructors or CIs"},
  examDate:{type:"string",description:"YYYY-MM-DD when exam/assessment is scheduled (if known)"},
  communityInsights:{type:"array",items:{type:"string"},description:"Tips from Reddit, Discord, or university community forums"},
};

export const TOOLS = [
  { name:"add_tasks", description:"Add tasks to study schedule.",
    input_schema:{type:"object",properties:{tasks:{type:"array",items:{type:"object",properties:{date:{type:"string"},time:{type:"string"},endTime:{type:"string"},title:{type:"string"},category:{type:"string",enum:["study","review","exam-prep","exam-day","project","class","break","health","work","personal","other"]},priority:{type:"string",enum:["high","medium","low"]},notes:{type:"string"},courseId:{type:"string",description:"ID of the associated course"}},required:["date","time","endTime","title","category","priority"]}}},required:["tasks"]}},
  { name:"add_courses", description:"Add courses with DEEP context. Include assessment type, competencies/objectives, topic breakdown with weights, key terms, study resources, tips, difficulty, hours, focus areas, cert alignment, prerequisites.",
    input_schema:{type:"object",properties:{courses:{type:"array",items:{type:"object",properties:CS,required:["name","credits","difficulty","status"]}}},required:["courses"]}},
  { name:"update_courses", description:"Update existing courses by name match. Can update any field.",
    input_schema:{type:"object",properties:{updates:{type:"array",items:{type:"object",properties:{course_name_match:{type:"string",description:"Substring match (case insensitive)"},...CS},required:["course_name_match"]}}},required:["updates"]}},
  { name:"enrich_course_context", description:"Generate/regenerate deep context for courses. Provide the MOST CURRENT assessment intelligence — courses update frequently. Include specific competency/objective codes, exact topic names with weights, concrete study hours per topic, current assessment format, and actionable community tips. When user asks 'what do I need to know to pass', go as deep as possible.",
    input_schema:{type:"object",properties:{enrichments:{type:"array",items:{type:"object",properties:{course_name_match:{type:"string"},...CS},required:["course_name_match"]}}},required:["enrichments"]}},
  { name:"generate_study_plan", description:"Generate daily study tasks for a specific date range. Each task has a date, time, title, and category.",
    input_schema:{type:"object",properties:{summary:{type:"string",description:"Brief 1-sentence summary"},daily_tasks:{type:"array",items:{type:"object",properties:{date:{type:"string",description:"YYYY-MM-DD format"},time:{type:"string",description:"HH:MM 24-hour format"},endTime:{type:"string",description:"HH:MM 24-hour format"},title:{type:"string",description:"Format: CourseCode - Topic description"},category:{type:"string",enum:["study","review","exam-prep","exam-day","project","class","break","health","work","personal","other"]},priority:{type:"string",enum:["high","medium","low"]},notes:{type:"string"},courseId:{type:"string",description:"Course code or name"}},required:["date","time","endTime","title","category","priority"]}}},required:["summary","daily_tasks"]}},
  { name:"create_lesson_plan", description:"Create a structured lesson plan for all courses. Defines what to study, in what order, at what depth, with learning objectives per unit. This is the pedagogical plan — WHAT to learn, not WHEN.",
    input_schema:{type:"object",properties:{summary:{type:"string"},courses:{type:"array",items:{type:"object",properties:{course_code:{type:"string"},course_name:{type:"string"},total_hours:{type:"number",description:"Realistic hours for this student"},units:{type:"array",description:"Ordered learning units",items:{type:"object",properties:{unit_number:{type:"number"},title:{type:"string"},hours:{type:"number"},type:{type:"string",enum:["learn","review","practice","exam-prep","exam-day"]},topics:{type:"array",items:{type:"string"}},objectives:{type:"string",description:"What the student should know after this unit"},prerequisites:{type:"array",items:{type:"string"},description:"Prior units that must be completed first"},notes:{type:"string"}},required:["unit_number","title","hours","type","topics"]}}},required:["course_code","course_name","total_hours","units"]}}},required:["summary","courses"]}},
  { name:"create_schedule_outline", description:"Map a lesson plan onto the student's calendar. Assigns lesson units to specific weeks based on availability. This is the scheduling plan — WHEN to study each unit.",
    input_schema:{type:"object",properties:{summary:{type:"string"},total_weeks:{type:"number"},weeks:{type:"array",items:{type:"object",properties:{week:{type:"number"},week_of:{type:"string",description:"YYYY-MM-DD Monday of this week"},courses:{type:"array",items:{type:"object",properties:{course_code:{type:"string"},hours:{type:"number"},phase:{type:"string",enum:["learn","review","practice","exam-prep","exam-day"]},units:{type:"array",items:{type:"number"},description:"Unit numbers from the lesson plan to cover this week"},notes:{type:"string"}},required:["course_code","hours","phase","units"]}},total_hours:{type:"number"},notes:{type:"string"}},required:["week","week_of","courses","total_hours"]}}},required:["summary","total_weeks","weeks"]}},
];

export const TOOLS_OPENAI = TOOLS.map(t=>({type:"function",function:{name:t.name,description:t.description,parameters:t.input_schema}}));

// Provider-specific quirks that affect API behavior
export const PROVIDER_QUIRKS = {
  // Direct providers
  deepseek:   { maxToolLoops: 3, noVision: true },
  gemini:     { singleToolCallPreferred: true },
  cohere:     { hasToolPlan: true, noVision: true },
  ai21:       { disableStreamingWithTools: true, noVision: true },
  zai:        { disableStreamingWithTools: true }, // Z.AI has 30s idle timeout on SSE — GLM batches tool args, causing ECONNRESET
  perplexity: { noToolSupport: true, noVision: true },
  // Aggregators
  groq:       { requireToolChoice: true, noVision: true },
  sambanova:  { maxToolLoops: 3, noVision: true },
  chutes:     { maxToolLoops: 2, noVision: true },
  // Local
  clewdr:     { noToolSupport: true },
  ollama:     { singleToolCallPreferred: true, disableStreamingWithTools: true, noVision: true },
  lmstudio:   { disableStreamingWithTools: true, noVision: true },
  vllm:       { disableStreamingWithTools: true, noVision: true },
};

export function getProviderQuirks(profile) {
  return PROVIDER_QUIRKS[profile?.provider] || {};
}

// Model-level vision capability check — needed because aggregators like Z.AI
// route to multiple backends, some with vision (gpt-4o) and some without (glm-5-turbo).
// Provider-level noVision is too coarse for these cases.
export function isLikelyVisionCapable(profile) {
  const quirks = getProviderQuirks(profile);

  // Providers that definitely don't support vision regardless of model
  if (quirks.noVision) return false;

  const model = (profile?.model || '').toLowerCase();
  if (!model) return true; // no model set yet — assume capable

  // Known vision-capable model patterns
  const visionModels = [
    'gpt-4o', 'gpt-4.1', 'gpt-4-turbo', 'gpt-4-vision',
    'claude-sonnet', 'claude-opus',
    'gemini-2.5', 'gemini-2.0', 'gemini-pro',
    'qwen-vl', 'qwen2-vl',
    'grok-3', 'grok-2',
    'llava', 'vision',
  ];

  // Known non-vision model patterns
  const knownNonVision = [
    'glm', 'deepseek-chat', 'deepseek-coder', 'deepseek-reasoner',
    'jamba', 'command-r', 'command-a',
    'llama-3.3', 'llama-3.1', 'llama3.3', 'llama3.1',
    'mixtral', 'mistral',
    'phi4', 'gemma', 'codellama', 'codestral',
    'sonar',
  ];

  // Check non-vision first (more specific for aggregator models)
  if (knownNonVision.some(p => model.includes(p))) return false;

  // Check if model matches a known vision pattern
  if (visionModels.some(p => model.includes(p))) return true;

  // Unknown model — assume capable (API layer will retry without image on 400)
  return true;
}

// Model-level tool-calling capability check.
// Returns false for providers/models known to lack tool calling support.
export function isLikelyToolCapable(profile) {
  const quirks = getProviderQuirks(profile);
  if (quirks.noToolSupport) return false;

  const provider = (profile?.provider || '').toLowerCase();
  const model = (profile?.model || '').toLowerCase();
  if (!model) return true; // no model set — assume capable

  // Local providers: only specific models support tools
  if (['ollama', 'lmstudio', 'vllm', 'kobold', 'textgen', 'tabby', 'jan'].includes(provider)) {
    const toolCapableLocal = [
      'llama-3.1', 'llama-3.2', 'llama-3.3', 'llama3.1', 'llama3.2', 'llama3.3',
      'mistral-nemo', 'mistral-small', 'mistral-large',
      'qwen2.5', 'qwen-2.5', 'qwen3',
      'hermes', 'firefunction', 'functionary',
      'command-r', 'command-a',
      'nemotron',
    ];
    return toolCapableLocal.some(p => model.includes(p));
  }

  // Known non-tool-capable models on any provider
  const noToolModels = [
    'llama-2', 'llama2', 'llama-3.0', 'llama3.0',
    'phi-2', 'phi2', 'phi-1',
    'falcon', 'mpt-', 'dolly',
    'stablelm', 'starcoder', 'codellama',
    'tinyllama', 'orca-mini',
  ];
  if (noToolModels.some(p => model.includes(p))) return false;

  return true;
}
