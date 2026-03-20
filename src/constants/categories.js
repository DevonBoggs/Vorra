// Category, priority, and status constants

export const AI_CATS = ["study","review","exam-prep","exam-day","project","class","break","exam"];
export const STUDY_CATS = ["study","review","exam-prep","exam-day","project","class","exam"];
export const STATUS_L = {not_started:"Not Started", in_progress:"In Progress", completed:"Completed"};

// These need the current theme to generate colors
export function getCAT(T) {
  return {
    study:{bg:T.purpleD,fg:T.purple,l:"Study"},
    review:{bg:"#1e1b4b",fg:"#a78bfa",l:"Review"},
    "exam-prep":{bg:T.orangeD,fg:T.orange,l:"Exam Prep"},
    "exam-day":{bg:"#7f1d1d",fg:"#f87171",l:"Exam Day"},
    project:{bg:"#164e63",fg:"#22d3ee",l:"Project/PA"},
    class:{bg:T.blueD,fg:T.blue,l:"Class"},
    break:{bg:T.yellowD,fg:T.yellow,l:"Break"},
    health:{bg:T.accentD,fg:T.accent,l:"Health"},
    work:{bg:T.cyanD,fg:T.cyan,l:"Work"},
    personal:{bg:T.pinkD,fg:T.pink,l:"Personal"},
    other:{bg:T.blueD,fg:T.soft,l:"Other"},
    exam:{bg:T.orangeD,fg:T.orange,l:"Exam"},
  };
}

export function getPRIO(T) {
  return {high:T.red, medium:T.orange, low:T.accent};
}

export function getSTATUS_C(T) {
  return {not_started:T.dim, in_progress:T.blue, completed:T.accent};
}
