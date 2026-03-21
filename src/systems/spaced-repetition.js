// Spaced Repetition System — FSRS-4.5 (Free Spaced Repetition Scheduler)
// Pure functions only — no side effects, no state management.
// Reference: https://github.com/open-spaced-repetition/fsrs4.5

// ── Constants ────────────────────────────────────────────────────────

/** Card states */
export const State = {
  New: 0,
  Learning: 1,
  Review: 2,
  Relearning: 3,
};

/** Review ratings */
export const Rating = {
  Again: 1,
  Hard: 2,
  Good: 3,
  Easy: 4,
};

/** Human-readable labels for ratings */
export const RATING_LABELS = {
  [Rating.Again]: 'Again',
  [Rating.Hard]: 'Hard',
  [Rating.Good]: 'Good',
  [Rating.Easy]: 'Easy',
};

/** Human-readable labels for states */
export const STATE_LABELS = {
  [State.New]: 'New',
  [State.Learning]: 'Learning',
  [State.Review]: 'Review',
  [State.Relearning]: 'Relearning',
};

/**
 * Default FSRS-4.5 weights (19 parameters), optimized from research.
 * w[0..3]  — initial stability for Again/Hard/Good/Easy on first review
 * w[4]     — initial difficulty for Good
 * w[5]     — difficulty multiplier for rating deviation
 * w[6]     — difficulty mean reversion weight
 * w[7]     — stability modifier after successful recall
 * w[8]     — stability exponent (difficulty factor)
 * w[9]     — stability exponent (stability factor)
 * w[10]    — stability exponent (retrievability factor)
 * w[11]    — stability penalty for failure
 * w[12]    — difficulty recovery after failure
 * w[13]    — stability modifier for hard rating
 * w[14]    — stability modifier for easy rating
 * w[15]    — hard penalty multiplier
 * w[16]    — easy bonus multiplier
 * w[17]    — short-term stability multiplier for Again
 * w[18]    — short-term stability multiplier for Hard
 */
export const DEFAULT_W = [
  0.4, 0.6, 2.4, 5.8,  // w[0..3]: initial stability per rating
  4.93,                   // w[4]: initial difficulty for Good
  0.94,                   // w[5]: difficulty change per rating delta
  0.86,                   // w[6]: mean reversion weight
  0.01,                   // w[7]: recall stability modifier
  1.49,                   // w[8]: difficulty exponent
  0.14,                   // w[9]: stability exponent
  0.94,                   // w[10]: retrievability exponent
  2.18,                   // w[11]: forget stability modifier
  0.05,                   // w[12]: difficulty recovery after lapse
  0.34,                   // w[13]: hard penalty
  1.26,                   // w[14]: easy bonus
  0.29,                   // w[15]: hard interval multiplier
  2.61,                   // w[16]: easy interval multiplier
  0.0,                    // w[17]: short-term Again modifier (unused in 4.5 standard)
  0.0,                    // w[18]: short-term Hard modifier (unused in 4.5 standard)
];

/** Default target retention (90%) */
export const DEFAULT_REQUEST_RETENTION = 0.9;

/** Maximum interval in days */
export const MAX_INTERVAL = 36500; // 100 years

/** Factor for power forgetting curve: R = (1 + t / (9 * S))^-1 */
const DECAY = -0.5;
const FACTOR = Math.pow(0.9, 1 / DECAY) - 1;

// ── Internal math helpers ────────────────────────────────────────────

/**
 * Clamp a value between min and max.
 */
function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

/**
 * Power forgetting curve: retrievability at time t (days) for stability S.
 * R(t, S) = (1 + FACTOR * t / S)^DECAY
 * @param {number} elapsedDays - days since last review
 * @param {number} stability - current stability in days
 * @returns {number} retrievability in [0, 1]
 */
function forgettingCurve(elapsedDays, stability) {
  if (stability <= 0) return 0;
  return Math.pow(1 + FACTOR * elapsedDays / stability, DECAY);
}

/**
 * Calculate the interval (in days) needed to reach a target retrievability.
 * Inverse of forgetting curve: t = S / FACTOR * (R^(1/DECAY) - 1)
 * @param {number} stability - stability in days
 * @param {number} requestRetention - target retention (0-1)
 * @returns {number} interval in days (floored, >= 1)
 */
function nextInterval(stability, requestRetention) {
  const interval = (stability / FACTOR) * (Math.pow(requestRetention, 1 / DECAY) - 1);
  return Math.min(Math.max(Math.round(interval), 1), MAX_INTERVAL);
}

/**
 * Mean reversion: smoothly pulls a value toward the mean.
 * meanReversion(init, current, w) = w * init + (1 - w) * current
 * @param {number} init - initial / mean value
 * @param {number} current - current value
 * @param {number} w - reversion weight (0 = no reversion, 1 = full reversion)
 * @returns {number}
 */
function meanReversion(init, current, w) {
  return w * init + (1 - w) * current;
}

// ── FSRS-4.5 Core Functions ──────────────────────────────────────────

/**
 * Initial difficulty when a card is first reviewed.
 * D0(G) = w[4] - e^(w[5] * (G - 1)) + 1
 * where G is the rating (1-4).
 * @param {number} rating - first review rating (1-4)
 * @param {number[]} w - FSRS parameters
 * @returns {number} initial difficulty in [1, 10]
 */
function initDifficulty(rating, w) {
  return clamp(w[4] - Math.exp(w[5] * (rating - 1)) + 1, 1, 10);
}

/**
 * Initial stability when a card is first reviewed.
 * S0(G) = w[G-1]  (parameters w[0..3] map to Again/Hard/Good/Easy)
 * @param {number} rating - first review rating (1-4)
 * @param {number[]} w - FSRS parameters
 * @returns {number} initial stability in days
 */
function initStability(rating, w) {
  return Math.max(w[rating - 1], 0.1);
}

/**
 * Next difficulty after a review.
 * D'(D, G) = meanReversion(D0(4), D - w[6] * (G - 3))
 * Applies mean reversion to prevent difficulty from drifting too far.
 * @param {number} d - current difficulty
 * @param {number} rating - review rating (1-4)
 * @param {number[]} w - FSRS parameters
 * @returns {number} new difficulty in [1, 10]
 */
function nextDifficulty(d, rating, w) {
  const delta = d - w[6] * (rating - 3);
  return clamp(meanReversion(initDifficulty(4, w), delta, w[6]), 1, 10);
}

/**
 * Next stability after a successful recall (rating >= Hard on a Review card).
 * S'_r(D, S, R, G) = S * (e^(w[7]) * (11 - D) * S^(-w[8]) * (e^(w[9] * (1 - R)) - 1) * hardPenalty * easyBonus + 1)
 * @param {number} d - difficulty
 * @param {number} s - current stability
 * @param {number} r - retrievability at time of review
 * @param {number} rating - review rating (1-4)
 * @param {number[]} w - FSRS parameters
 * @returns {number} new stability in days
 */
function nextRecallStability(d, s, r, rating, w) {
  const hardPenalty = rating === Rating.Hard ? w[15] : 1;
  const easyBonus = rating === Rating.Easy ? w[16] : 1;
  return s * (
    Math.exp(w[7]) *
    (11 - d) *
    Math.pow(s, -w[9]) *
    (Math.exp(w[10] * (1 - r)) - 1) *
    hardPenalty *
    easyBonus +
    1
  );
}

/**
 * Next stability after a lapse (forgetting — rating = Again on a Review card).
 * S'_f(D, S, R) = w[11] * D^(-w[12]) * ((S + 1)^w[13] - 1) * e^(w[14] * (1 - R))
 * @param {number} d - difficulty
 * @param {number} s - current stability
 * @param {number} r - retrievability at time of review
 * @param {number[]} w - FSRS parameters
 * @returns {number} new stability in days (>= 0.1)
 */
function nextForgetStability(d, s, r, w) {
  return Math.max(
    w[11] *
    Math.pow(d, -w[12]) *
    (Math.pow(s + 1, w[13]) - 1) *
    Math.exp(w[14] * (1 - r)),
    0.1
  );
}

// ── Card Creation ────────────────────────────────────────────────────

/**
 * Create a new flashcard with default FSRS state.
 * @param {object} opts - card content options
 * @param {string} [opts.id] - unique card ID (auto-generated if omitted)
 * @param {string} [opts.courseId] - links to a Vorra course
 * @param {string} [opts.topicId] - links to a topic in topicBreakdown
 * @param {string} [opts.front] - question / concept
 * @param {string} [opts.back] - answer / definition
 * @param {string[]} [opts.tags] - e.g. ['networking', 'osi-model']
 * @param {string} [opts.cardType] - e.g. 'term', 'competency', 'topic', 'mistake'
 * @returns {object} initialized card
 */
export function initCard(opts = {}) {
  const now = new Date().toISOString();
  return {
    id: opts.id || crypto.randomUUID(),
    // Content
    courseId: opts.courseId || '',
    topicId: opts.topicId || '',
    front: opts.front || '',
    back: opts.back || '',
    tags: opts.tags || [],
    cardType: opts.cardType || 'general',
    // FSRS state
    state: State.New,
    difficulty: 0,
    stability: 0,
    due: now,
    lastReview: null,
    reps: 0,
    lapses: 0,
    elapsed_days: 0,
    scheduled_days: 0,
    // Stats
    reviewLog: [],
  };
}

// ── Scheduling ───────────────────────────────────────────────────────

/**
 * Schedule the next review for a card based on the user's rating.
 * Implements the full FSRS-4.5 scheduling algorithm.
 *
 * @param {object} card - the card to schedule (from initCard or previous scheduleCard)
 * @param {number} rating - Rating.Again (1), Rating.Hard (2), Rating.Good (3), or Rating.Easy (4)
 * @param {Date|string} [now] - current time (defaults to new Date())
 * @param {object} [params] - FSRS parameters
 * @param {number[]} [params.w] - 19 FSRS weights
 * @param {number} [params.requestRetention] - target retention (0-1)
 * @returns {object} updated card with new scheduling state and appended reviewLog entry
 */
export function scheduleCard(card, rating, now, params = {}) {
  const w = params.w || DEFAULT_W;
  const requestRetention = params.requestRetention || DEFAULT_REQUEST_RETENTION;
  const currentTime = now ? new Date(now) : new Date();
  const currentTimeISO = currentTime.toISOString();

  // Calculate elapsed days since last review
  let elapsedDays = 0;
  if (card.lastReview) {
    const lastReview = new Date(card.lastReview);
    elapsedDays = Math.max(0, (currentTime - lastReview) / (1000 * 60 * 60 * 24));
  }

  // Clone the card to avoid mutation
  const next = { ...card, reviewLog: [...card.reviewLog] };

  // State transitions based on current state
  switch (card.state) {
    case State.New: {
      // First review — initialize stability and difficulty
      next.difficulty = initDifficulty(rating, w);
      next.stability = initStability(rating, w);
      next.reps = 1;
      next.elapsed_days = 0;

      if (rating === Rating.Again) {
        // Stay in learning
        next.state = State.Learning;
        next.scheduled_days = 0;
        // Due in 1 minute (short-term)
        next.due = new Date(currentTime.getTime() + 1 * 60 * 1000).toISOString();
      } else if (rating === Rating.Hard) {
        // Stay in learning
        next.state = State.Learning;
        next.scheduled_days = 0;
        // Due in 5 minutes
        next.due = new Date(currentTime.getTime() + 5 * 60 * 1000).toISOString();
      } else if (rating === Rating.Good) {
        // Stay in learning
        next.state = State.Learning;
        next.scheduled_days = 0;
        // Due in 10 minutes
        next.due = new Date(currentTime.getTime() + 10 * 60 * 1000).toISOString();
      } else {
        // Easy — graduate directly to review
        next.state = State.Review;
        const interval = nextInterval(next.stability, requestRetention);
        next.scheduled_days = interval;
        next.due = addDays(currentTime, interval).toISOString();
      }
      break;
    }

    case State.Learning:
    case State.Relearning: {
      // In learning/relearning — decide whether to graduate or stay
      next.elapsed_days = elapsedDays;

      if (rating === Rating.Again) {
        // Reset: stay in current state
        next.difficulty = nextDifficulty(card.difficulty, rating, w);
        next.stability = initStability(rating, w);
        next.state = card.state === State.Learning ? State.Learning : State.Relearning;
        next.scheduled_days = 0;
        next.reps = card.reps + 1;
        if (card.state === State.Relearning) {
          next.lapses = card.lapses; // no additional lapse, already counted
        }
        // Due in 1 minute
        next.due = new Date(currentTime.getTime() + 1 * 60 * 1000).toISOString();
      } else if (rating === Rating.Hard) {
        next.difficulty = nextDifficulty(card.difficulty, rating, w);
        next.stability = initStability(rating, w);
        next.state = card.state;
        next.scheduled_days = 0;
        next.reps = card.reps + 1;
        // Due in 5 minutes
        next.due = new Date(currentTime.getTime() + 5 * 60 * 1000).toISOString();
      } else {
        // Good or Easy — graduate to Review
        next.difficulty = nextDifficulty(card.difficulty, rating, w);
        next.stability = initStability(rating, w);
        next.state = State.Review;
        next.reps = card.reps + 1;
        const interval = nextInterval(next.stability, requestRetention);
        next.scheduled_days = interval;
        next.due = addDays(currentTime, interval).toISOString();
      }
      break;
    }

    case State.Review: {
      // In review — calculate retrievability and update stability
      next.elapsed_days = elapsedDays;
      const retrievability = forgettingCurve(elapsedDays, card.stability);
      next.reps = card.reps + 1;

      if (rating === Rating.Again) {
        // Lapse — enter relearning
        next.difficulty = nextDifficulty(card.difficulty, rating, w);
        next.stability = nextForgetStability(card.difficulty, card.stability, retrievability, w);
        next.state = State.Relearning;
        next.lapses = card.lapses + 1;
        next.scheduled_days = 0;
        // Due in 5 minutes for relearning
        next.due = new Date(currentTime.getTime() + 5 * 60 * 1000).toISOString();
      } else {
        // Successful recall — update stability based on recall quality
        next.difficulty = nextDifficulty(card.difficulty, rating, w);
        next.stability = nextRecallStability(
          card.difficulty, card.stability, retrievability, rating, w
        );
        next.state = State.Review;
        const interval = nextInterval(next.stability, requestRetention);
        next.scheduled_days = interval;
        next.due = addDays(currentTime, interval).toISOString();
      }
      break;
    }

    default:
      // Unknown state — treat as new
      return scheduleCard({ ...card, state: State.New }, rating, now, params);
  }

  // Update last review time
  next.lastReview = currentTimeISO;

  // Append review log entry
  next.reviewLog = [
    ...next.reviewLog,
    {
      date: currentTimeISO,
      rating,
      elapsed: elapsedDays,
      state: card.state,
      stability: next.stability,
      difficulty: next.difficulty,
      scheduledDays: next.scheduled_days,
    },
  ];

  return next;
}

/**
 * Get the next review date and retrievability for a card.
 * @param {object} card - a card object
 * @param {Date|string} [now] - current time
 * @returns {object} { due, overdue, retrievability, daysUntilDue, state }
 */
export function getNextReview(card, now) {
  const currentTime = now ? new Date(now) : new Date();
  const dueDate = new Date(card.due);
  const daysUntilDue = (dueDate - currentTime) / (1000 * 60 * 60 * 24);
  const overdue = daysUntilDue < 0;

  let retrievability = 1;
  if (card.lastReview && card.stability > 0) {
    const elapsed = (currentTime - new Date(card.lastReview)) / (1000 * 60 * 60 * 24);
    retrievability = forgettingCurve(elapsed, card.stability);
  }

  return {
    due: card.due,
    overdue,
    retrievability,
    daysUntilDue: Math.round(daysUntilDue * 10) / 10,
    state: card.state,
  };
}

/**
 * Calculate the current retrievability of a card.
 * @param {object} card - a card object
 * @param {Date|string} [now] - current time
 * @returns {number} retrievability in [0, 1]
 */
export function getRetrievability(card, now) {
  if (card.state === State.New) return 0;
  if (!card.lastReview || card.stability <= 0) return 0;
  const currentTime = now ? new Date(now) : new Date();
  const elapsed = (currentTime - new Date(card.lastReview)) / (1000 * 60 * 60 * 24);
  return forgettingCurve(elapsed, card.stability);
}

// ── Queue & Filtering ────────────────────────────────────────────────

/**
 * Get all cards that are due for review, sorted by priority (most overdue first).
 * @param {object[]} cards - array of card objects
 * @param {Date|string} [now] - current time
 * @returns {object[]} cards due for review, sorted by urgency
 */
export function getDueCards(cards, now) {
  const currentTime = now ? new Date(now) : new Date();
  return cards
    .filter(c => c.state !== State.New && new Date(c.due) <= currentTime)
    .sort((a, b) => {
      // Most overdue first
      const aDue = new Date(a.due);
      const bDue = new Date(b.due);
      if (aDue.getTime() !== bDue.getTime()) return aDue - bDue;
      // Break ties: higher difficulty first (harder cards prioritized)
      return b.difficulty - a.difficulty;
    });
}

/**
 * Get new (unreviewed) cards, up to a daily limit.
 * @param {object[]} cards - array of card objects
 * @param {number} [limit=20] - maximum number of new cards to return
 * @returns {object[]} new cards, up to limit
 */
export function getNewCards(cards, limit = 20) {
  return cards
    .filter(c => c.state === State.New)
    .slice(0, limit);
}

/**
 * Get a study queue combining due cards and new cards in optimal order.
 * Due cards come first (most urgent), then new cards up to the daily limit.
 * Learning/relearning cards are interleaved at the front for immediate practice.
 *
 * @param {object[]} cards - array of card objects
 * @param {number} [newLimit=20] - max new cards to introduce
 * @param {Date|string} [now] - current time
 * @returns {object[]} ordered study queue
 */
export function getStudyQueue(cards, newLimit = 20, now) {
  const currentTime = now ? new Date(now) : new Date();

  // Learning/relearning cards due now (highest priority — short intervals)
  const learningDue = cards
    .filter(c =>
      (c.state === State.Learning || c.state === State.Relearning) &&
      new Date(c.due) <= currentTime
    )
    .sort((a, b) => new Date(a.due) - new Date(b.due));

  // Review cards due now
  const reviewDue = cards
    .filter(c =>
      c.state === State.Review &&
      new Date(c.due) <= currentTime
    )
    .sort((a, b) => {
      // Most overdue first
      const aDue = new Date(a.due);
      const bDue = new Date(b.due);
      if (aDue.getTime() !== bDue.getTime()) return aDue - bDue;
      return b.difficulty - a.difficulty;
    });

  // New cards
  const newCards = getNewCards(cards, newLimit);

  // Interleave: learning first, then reviews, then new
  return [...learningDue, ...reviewDue, ...newCards];
}

// ── Card Generation ──────────────────────────────────────────────────

/**
 * Auto-generate flashcards from a Vorra course's deep context.
 * Extracts cards from keyTermsAndConcepts, topicBreakdown, competencies,
 * commonMistakes, mnemonics, learningObjectives, and hardestConcepts.
 *
 * @param {object} course - a Vorra course object with deep context
 * @returns {object[]} array of initialized cards
 */
export function generateCardsFromCourse(course) {
  if (!course) return [];

  const courseId = course.id || course.name || '';
  const courseName = course.name || '';
  const cards = [];

  const safeArr = v => (Array.isArray(v) ? v : []);

  // 1. Key Terms and Concepts → term/definition cards
  for (const item of safeArr(course.keyTermsAndConcepts)) {
    if (!item.term || !item.definition) continue;
    cards.push(initCard({
      courseId,
      front: `Define: ${item.term}`,
      back: item.definition,
      tags: [slugify(courseName), 'term'],
      cardType: 'term',
    }));
  }

  // 2. Topic Breakdown → topic overview cards with subtopics
  for (const topic of safeArr(course.topicBreakdown)) {
    if (!topic.topic) continue;
    const topicId = slugify(topic.topic);

    // Main topic card
    if (topic.description) {
      cards.push(initCard({
        courseId,
        topicId,
        front: `Explain the topic: ${topic.topic}`,
        back: topic.description,
        tags: [slugify(courseName), topicId, 'topic'],
        cardType: 'topic',
      }));
    }

    // Subtopic cards
    for (const sub of safeArr(topic.subtopics)) {
      if (!sub) continue;
      cards.push(initCard({
        courseId,
        topicId,
        front: `What is "${sub}" in the context of ${topic.topic}?`,
        back: `Subtopic of ${topic.topic} (${courseName}). Weight: ${topic.weight || 'unknown'}.`,
        tags: [slugify(courseName), topicId, 'subtopic'],
        cardType: 'subtopic',
      }));
    }
  }

  // 3. Competencies → competency understanding cards
  for (const comp of safeArr(course.competencies)) {
    if (!comp.title) continue;
    const desc = comp.description || `Competency for ${courseName}`;
    const code = comp.code ? ` (${comp.code})` : '';
    cards.push(initCard({
      courseId,
      front: `What is competency${code}: "${comp.title}"?`,
      back: `${desc}${comp.weight ? ` — Weight: ${comp.weight}` : ''}`,
      tags: [slugify(courseName), 'competency'],
      cardType: 'competency',
    }));
  }

  // 4. Common Mistakes → awareness cards
  for (const mistake of safeArr(course.commonMistakes)) {
    if (!mistake) continue;
    cards.push(initCard({
      courseId,
      front: `What is a common mistake students make in ${courseName}?`,
      back: mistake,
      tags: [slugify(courseName), 'mistake'],
      cardType: 'mistake',
    }));
  }

  // 5. Learning Objectives → objective cards
  for (const objective of safeArr(course.learningObjectives)) {
    if (!objective) continue;
    cards.push(initCard({
      courseId,
      front: `Learning objective for ${courseName}: Can you explain this?`,
      back: objective,
      tags: [slugify(courseName), 'objective'],
      cardType: 'objective',
    }));
  }

  // 6. Mnemonics → memory aid cards
  for (const m of safeArr(course.mnemonics)) {
    if (!m.concept || !m.mnemonic) continue;
    cards.push(initCard({
      courseId,
      front: `What mnemonic helps remember "${m.concept}"?`,
      back: m.mnemonic,
      tags: [slugify(courseName), 'mnemonic'],
      cardType: 'mnemonic',
    }));
  }

  // 7. Hardest Concepts → focused recall cards
  for (const concept of safeArr(course.hardestConcepts)) {
    if (!concept) continue;
    cards.push(initCard({
      courseId,
      front: `Explain this commonly difficult concept: ${concept}`,
      back: `This is one of the hardest concepts in ${courseName}. Focus extra study time here.`,
      tags: [slugify(courseName), 'hard-concept'],
      cardType: 'hard-concept',
    }));
  }

  return cards;
}

// ── Statistics ────────────────────────────────────────────────────────

/**
 * Calculate retention and review statistics for a set of cards.
 * @param {object[]} cards - array of card objects
 * @param {Date|string} [now] - current time
 * @returns {object} { totalCards, dueToday, newCards, avgRetention, streakDays, maturedCards }
 */
export function getRetentionStats(cards, now) {
  const currentTime = now ? new Date(now) : new Date();
  const todayStart = startOfDay(currentTime);
  const todayEnd = endOfDay(currentTime);

  let totalRetention = 0;
  let retentionCount = 0;
  let dueToday = 0;
  let newCards = 0;
  let maturedCards = 0;

  for (const card of cards) {
    if (card.state === State.New) {
      newCards++;
      continue;
    }

    // Calculate retrievability for non-new cards
    if (card.lastReview && card.stability > 0) {
      const elapsed = (currentTime - new Date(card.lastReview)) / (1000 * 60 * 60 * 24);
      totalRetention += forgettingCurve(elapsed, card.stability);
      retentionCount++;
    }

    // Due today: due date falls on or before end of today
    const dueDate = new Date(card.due);
    if (dueDate <= todayEnd) {
      dueToday++;
    }

    // Matured: cards in Review state with stability >= 21 days
    if (card.state === State.Review && card.stability >= 21) {
      maturedCards++;
    }
  }

  // Calculate streak: consecutive days with at least one review
  const streakDays = calculateStreak(cards, currentTime);

  return {
    totalCards: cards.length,
    dueToday,
    newCards,
    avgRetention: retentionCount > 0 ? totalRetention / retentionCount : 0,
    streakDays,
    maturedCards,
  };
}

/**
 * Predict review workload for the next N days.
 * @param {object[]} cards - array of card objects
 * @param {number} [days=30] - number of days to predict
 * @param {Date|string} [now] - current time
 * @returns {object[]} array of { date, dueCount, newCount, totalCount } per day
 */
export function predictWorkload(cards, days = 30, now) {
  const currentTime = now ? new Date(now) : new Date();
  const result = [];

  for (let d = 0; d < days; d++) {
    const dayStart = startOfDay(addDays(currentTime, d));
    const dayEnd = endOfDay(addDays(currentTime, d));

    let dueCount = 0;
    let newCount = 0;

    for (const card of cards) {
      if (card.state === State.New) {
        // New cards could be introduced any day — count towards day 0
        if (d === 0) newCount++;
        continue;
      }

      const dueDate = new Date(card.due);
      if (dueDate >= dayStart && dueDate <= dayEnd) {
        dueCount++;
      } else if (dueDate < dayStart && d === 0) {
        // Overdue cards count towards today
        dueCount++;
      }
    }

    result.push({
      date: dayStart.toISOString().split('T')[0],
      dueCount,
      newCount: d === 0 ? newCount : 0,
      totalCount: dueCount + (d === 0 ? newCount : 0),
    });
  }

  return result;
}

/**
 * Calculate mastery percentage per topic for a given course.
 * Mastery is based on average retrievability of cards in each topic.
 *
 * @param {object[]} cards - array of card objects
 * @param {string} courseId - the course ID to filter by
 * @param {Date|string} [now] - current time
 * @returns {object[]} array of { topicId, topicName, mastery, totalCards, reviewedCards, avgStability }
 */
export function getTopicMastery(cards, courseId, now) {
  const currentTime = now ? new Date(now) : new Date();
  const courseCards = cards.filter(c => c.courseId === courseId);

  // Group cards by topicId
  const topicMap = {};
  for (const card of courseCards) {
    const tid = card.topicId || '_general';
    if (!topicMap[tid]) {
      topicMap[tid] = { cards: [], totalRetention: 0, retentionCount: 0, totalStability: 0 };
    }
    topicMap[tid].cards.push(card);

    if (card.state !== State.New && card.lastReview && card.stability > 0) {
      const elapsed = (currentTime - new Date(card.lastReview)) / (1000 * 60 * 60 * 24);
      topicMap[tid].totalRetention += forgettingCurve(elapsed, card.stability);
      topicMap[tid].retentionCount++;
      topicMap[tid].totalStability += card.stability;
    }
  }

  return Object.entries(topicMap).map(([topicId, data]) => ({
    topicId,
    topicName: topicId === '_general' ? 'General' : topicId,
    mastery: data.retentionCount > 0 ? data.totalRetention / data.retentionCount : 0,
    totalCards: data.cards.length,
    reviewedCards: data.retentionCount,
    avgStability: data.retentionCount > 0 ? data.totalStability / data.retentionCount : 0,
  })).sort((a, b) => a.mastery - b.mastery); // weakest topics first
}

/**
 * Get overall course mastery as a single percentage.
 * @param {object[]} cards - array of card objects
 * @param {string} courseId - the course ID to filter by
 * @param {Date|string} [now] - current time
 * @returns {number} mastery percentage 0-100
 */
export function getCourseMastery(cards, courseId, now) {
  const topics = getTopicMastery(cards, courseId, now);
  if (topics.length === 0) return 0;
  const totalMastery = topics.reduce((sum, t) => sum + t.mastery, 0);
  return Math.round((totalMastery / topics.length) * 100);
}

// ── Utility Functions ────────────────────────────────────────────────

/**
 * Add days to a date, returning a new Date.
 * @param {Date} date - base date
 * @param {number} days - days to add
 * @returns {Date} new date
 */
function addDays(date, days) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

/**
 * Get start of day (00:00:00.000) for a date.
 * @param {Date} date
 * @returns {Date}
 */
function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Get end of day (23:59:59.999) for a date.
 * @param {Date} date
 * @returns {Date}
 */
function endOfDay(date) {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

/**
 * Convert a string to a URL-friendly slug.
 * @param {string} str
 * @returns {string}
 */
function slugify(str) {
  return (str || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Calculate the current study streak (consecutive days with reviews).
 * @param {object[]} cards - array of card objects
 * @param {Date} now - current time
 * @returns {number} streak in days
 */
function calculateStreak(cards, now) {
  // Collect all review dates
  const reviewDates = new Set();
  for (const card of cards) {
    for (const log of card.reviewLog || []) {
      if (log.date) {
        reviewDates.add(new Date(log.date).toISOString().split('T')[0]);
      }
    }
  }

  if (reviewDates.size === 0) return 0;

  // Check consecutive days backwards from today
  let streak = 0;
  const today = startOfDay(now);

  // Check if there was a review today; if not, start from yesterday
  const todayStr = today.toISOString().split('T')[0];
  let checkDate = reviewDates.has(todayStr) ? today : addDays(today, -1);
  const checkStr = checkDate.toISOString().split('T')[0];
  if (!reviewDates.has(checkStr) && !reviewDates.has(todayStr)) return 0;

  for (let i = 0; i < 3650; i++) {
    const dateStr = checkDate.toISOString().split('T')[0];
    if (reviewDates.has(dateStr)) {
      streak++;
      checkDate = addDays(checkDate, -1);
    } else {
      break;
    }
  }

  return streak;
}

/**
 * Serialize cards for storage (already plain objects, but ensures clean output).
 * @param {object[]} cards - array of card objects
 * @returns {string} JSON string
 */
export function serializeCards(cards) {
  return JSON.stringify(cards);
}

/**
 * Deserialize cards from storage.
 * @param {string} json - JSON string of cards array
 * @returns {object[]} array of card objects
 */
export function deserializeCards(json) {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Get a preview of all scheduling outcomes for a card (for UI display).
 * Returns what would happen for each possible rating without mutating the card.
 *
 * @param {object} card - the card to preview
 * @param {Date|string} [now] - current time
 * @param {object} [params] - FSRS parameters
 * @returns {object} { [Rating.Again]: { card, interval }, [Rating.Hard]: ..., ... }
 */
export function previewSchedule(card, now, params = {}) {
  const result = {};
  for (const rating of [Rating.Again, Rating.Hard, Rating.Good, Rating.Easy]) {
    const scheduled = scheduleCard(card, rating, now, params);
    const dueDate = new Date(scheduled.due);
    const currentTime = now ? new Date(now) : new Date();
    const intervalMs = dueDate - currentTime;
    const intervalDays = intervalMs / (1000 * 60 * 60 * 24);

    let intervalLabel;
    if (intervalDays < 1 / 24) {
      // Less than 1 hour — show minutes
      intervalLabel = `${Math.max(1, Math.round(intervalMs / 60000))}m`;
    } else if (intervalDays < 1) {
      // Less than 1 day — show hours
      intervalLabel = `${Math.round(intervalDays * 24)}h`;
    } else if (intervalDays < 30) {
      intervalLabel = `${Math.round(intervalDays)}d`;
    } else if (intervalDays < 365) {
      intervalLabel = `${Math.round(intervalDays / 30)}mo`;
    } else {
      intervalLabel = `${(intervalDays / 365).toFixed(1)}y`;
    }

    result[rating] = {
      card: scheduled,
      interval: intervalDays,
      intervalLabel,
      state: scheduled.state,
    };
  }
  return result;
}
