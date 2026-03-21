import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  initCard,
  scheduleCard,
  getDueCards,
  getNewCards,
  getStudyQueue,
  generateCardsFromCourse,
  getRetentionStats,
  serializeCards,
  deserializeCards,
  State,
  Rating,
} from '../spaced-repetition.js';

// ── initCard ────────────────────────────────────────────────────────────

describe('initCard', () => {
  it('creates a valid new card with default values', () => {
    const card = initCard();
    expect(card).toHaveProperty('id');
    expect(card.id).toBeTruthy();
    expect(card.state).toBe(State.New);
    expect(card.difficulty).toBe(0);
    expect(card.stability).toBe(0);
    expect(card.due).toBeTruthy();
    expect(card.lastReview).toBeNull();
    expect(card.reps).toBe(0);
    expect(card.lapses).toBe(0);
    expect(card.elapsed_days).toBe(0);
    expect(card.scheduled_days).toBe(0);
    expect(card.reviewLog).toEqual([]);
    expect(card.front).toBe('');
    expect(card.back).toBe('');
    expect(card.tags).toEqual([]);
    expect(card.cardType).toBe('general');
    expect(card.courseId).toBe('');
    expect(card.topicId).toBe('');
  });

  it('accepts custom options', () => {
    const card = initCard({
      id: 'custom-id',
      courseId: 'course-1',
      topicId: 'topic-1',
      front: 'What is TCP?',
      back: 'Transmission Control Protocol',
      tags: ['networking'],
      cardType: 'term',
    });
    expect(card.id).toBe('custom-id');
    expect(card.courseId).toBe('course-1');
    expect(card.topicId).toBe('topic-1');
    expect(card.front).toBe('What is TCP?');
    expect(card.back).toBe('Transmission Control Protocol');
    expect(card.tags).toEqual(['networking']);
    expect(card.cardType).toBe('term');
    expect(card.state).toBe(State.New);
  });

  it('sets due date to approximately now', () => {
    const before = new Date().toISOString();
    const card = initCard();
    const after = new Date().toISOString();
    expect(card.due >= before).toBe(true);
    expect(card.due <= after).toBe(true);
  });
});

// ── scheduleCard — New → Learning with Good ─────────────────────────────

describe('scheduleCard', () => {
  const now = new Date('2026-03-21T10:00:00Z');

  it('advances state from New to Learning with Good rating', () => {
    const card = initCard({ id: 'test-1', front: 'Q', back: 'A' });
    const next = scheduleCard(card, Rating.Good, now);

    expect(next.state).toBe(State.Learning);
    expect(next.reps).toBe(1);
    expect(next.difficulty).toBeGreaterThan(0);
    expect(next.stability).toBeGreaterThan(0);
    expect(next.lastReview).toBe(now.toISOString());
    expect(next.reviewLog).toHaveLength(1);
    expect(next.reviewLog[0].rating).toBe(Rating.Good);
    expect(next.reviewLog[0].state).toBe(State.New);
    // Due in ~10 minutes for Good on New card
    const dueDate = new Date(next.due);
    const diffMinutes = (dueDate - now) / (1000 * 60);
    expect(diffMinutes).toBeCloseTo(10, 0);
  });

  it('advances from New directly to Review with Easy rating', () => {
    const card = initCard({ id: 'test-2' });
    const next = scheduleCard(card, Rating.Easy, now);

    expect(next.state).toBe(State.Review);
    expect(next.reps).toBe(1);
    expect(next.scheduled_days).toBeGreaterThan(0);
    // Due should be days in the future, not minutes
    const dueDate = new Date(next.due);
    const diffDays = (dueDate - now) / (1000 * 60 * 60 * 24);
    expect(diffDays).toBeGreaterThanOrEqual(1);
  });

  it('reaches Review state after multiple Good ratings', () => {
    let card = initCard({ id: 'test-3' });

    // First review: New → Learning
    card = scheduleCard(card, Rating.Good, now);
    expect(card.state).toBe(State.Learning);

    // Second review: Learning → Review (Good graduates)
    const later = new Date(now.getTime() + 15 * 60 * 1000); // 15 min later
    card = scheduleCard(card, Rating.Good, later);
    expect(card.state).toBe(State.Review);
    expect(card.reps).toBe(2);
    expect(card.scheduled_days).toBeGreaterThan(0);
  });

  it('stays in Learning with Again rating from New', () => {
    const card = initCard({ id: 'test-4' });
    const next = scheduleCard(card, Rating.Again, now);

    expect(next.state).toBe(State.Learning);
    expect(next.reps).toBe(1);
    // Due in ~1 minute for Again
    const dueDate = new Date(next.due);
    const diffMinutes = (dueDate - now) / (1000 * 60);
    expect(diffMinutes).toBeCloseTo(1, 0);
  });

  it('triggers Relearning state when Again is rated on a Review card', () => {
    let card = initCard({ id: 'test-5' });

    // Fast-track to Review via Easy
    card = scheduleCard(card, Rating.Easy, now);
    expect(card.state).toBe(State.Review);

    // Review the card some time later with Again → Relearning
    const reviewTime = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000); // 2 days later
    const lapsed = scheduleCard(card, Rating.Again, reviewTime);

    expect(lapsed.state).toBe(State.Relearning);
    expect(lapsed.lapses).toBe(1);
    expect(lapsed.reviewLog).toHaveLength(2);
    expect(lapsed.reviewLog[1].rating).toBe(Rating.Again);
  });

  it('does not mutate the original card', () => {
    const card = initCard({ id: 'immutable-test' });
    const originalState = card.state;
    const originalReps = card.reps;
    scheduleCard(card, Rating.Good, now);

    expect(card.state).toBe(originalState);
    expect(card.reps).toBe(originalReps);
    expect(card.reviewLog).toEqual([]);
  });

  it('handles Hard rating from Learning state', () => {
    let card = initCard({ id: 'test-hard' });
    card = scheduleCard(card, Rating.Good, now); // New → Learning
    expect(card.state).toBe(State.Learning);

    const later = new Date(now.getTime() + 15 * 60 * 1000);
    const next = scheduleCard(card, Rating.Hard, later);
    // Hard in Learning keeps card in Learning
    expect(next.state).toBe(State.Learning);
    expect(next.reps).toBe(2);
  });

  it('appends review log entries correctly across multiple reviews', () => {
    let card = initCard({ id: 'test-log' });

    card = scheduleCard(card, Rating.Good, now);
    expect(card.reviewLog).toHaveLength(1);

    const t2 = new Date(now.getTime() + 15 * 60 * 1000);
    card = scheduleCard(card, Rating.Good, t2);
    expect(card.reviewLog).toHaveLength(2);

    const t3 = new Date(t2.getTime() + 3 * 24 * 60 * 60 * 1000);
    card = scheduleCard(card, Rating.Hard, t3);
    expect(card.reviewLog).toHaveLength(3);
    expect(card.reviewLog[2].rating).toBe(Rating.Hard);
  });
});

// ── getDueCards ─────────────────────────────────────────────────────────

describe('getDueCards', () => {
  it('returns only cards past their due date', () => {
    const now = new Date('2026-03-21T12:00:00Z');
    const pastDue = initCard({ id: 'due-1' });
    pastDue.state = State.Review;
    pastDue.due = new Date('2026-03-20T10:00:00Z').toISOString();
    pastDue.difficulty = 5;

    const futureDue = initCard({ id: 'future-1' });
    futureDue.state = State.Review;
    futureDue.due = new Date('2026-03-25T10:00:00Z').toISOString();

    const newCard = initCard({ id: 'new-1' });
    // New cards are excluded from getDueCards (state === New)

    const result = getDueCards([pastDue, futureDue, newCard], now);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('due-1');
  });

  it('returns empty array when no cards are due', () => {
    const now = new Date('2026-03-21T12:00:00Z');
    const future = initCard({ id: 'f1' });
    future.state = State.Review;
    future.due = new Date('2026-04-01T10:00:00Z').toISOString();

    expect(getDueCards([future], now)).toEqual([]);
  });

  it('sorts by most overdue first', () => {
    const now = new Date('2026-03-21T12:00:00Z');

    const card1 = initCard({ id: 'old' });
    card1.state = State.Review;
    card1.due = new Date('2026-03-18T10:00:00Z').toISOString();
    card1.difficulty = 3;

    const card2 = initCard({ id: 'older' });
    card2.state = State.Review;
    card2.due = new Date('2026-03-15T10:00:00Z').toISOString();
    card2.difficulty = 3;

    const result = getDueCards([card1, card2], now);
    expect(result[0].id).toBe('older');
    expect(result[1].id).toBe('old');
  });
});

// ── getNewCards ──────────────────────────────────────────────────────────

describe('getNewCards', () => {
  it('returns only cards in New state', () => {
    const newCard = initCard({ id: 'new-1' });
    const learningCard = initCard({ id: 'learning-1' });
    learningCard.state = State.Learning;
    const reviewCard = initCard({ id: 'review-1' });
    reviewCard.state = State.Review;

    const result = getNewCards([newCard, learningCard, reviewCard]);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('new-1');
  });

  it('respects the limit parameter', () => {
    const cards = Array.from({ length: 30 }, (_, i) =>
      initCard({ id: `new-${i}` })
    );

    expect(getNewCards(cards, 10)).toHaveLength(10);
    expect(getNewCards(cards, 5)).toHaveLength(5);
    expect(getNewCards(cards)).toHaveLength(20); // default limit is 20
  });

  it('returns all new cards if fewer than limit', () => {
    const cards = [initCard({ id: 'a' }), initCard({ id: 'b' })];
    expect(getNewCards(cards, 10)).toHaveLength(2);
  });
});

// ── getStudyQueue ───────────────────────────────────────────────────────

describe('getStudyQueue', () => {
  it('combines due and new cards correctly', () => {
    const now = new Date('2026-03-21T12:00:00Z');

    // A learning card that is due
    const learning = initCard({ id: 'learning-due' });
    learning.state = State.Learning;
    learning.due = new Date('2026-03-21T11:00:00Z').toISOString();

    // A review card that is due
    const review = initCard({ id: 'review-due' });
    review.state = State.Review;
    review.due = new Date('2026-03-20T10:00:00Z').toISOString();
    review.difficulty = 5;

    // A new card
    const newCard = initCard({ id: 'new-card' });

    // A review card NOT yet due
    const futureDue = initCard({ id: 'future' });
    futureDue.state = State.Review;
    futureDue.due = new Date('2026-04-01T10:00:00Z').toISOString();

    const queue = getStudyQueue([learning, review, newCard, futureDue], 20, now);

    // Learning due comes first, then review due, then new cards
    expect(queue.length).toBe(3); // learning + review + new (future excluded)
    expect(queue[0].id).toBe('learning-due');
    expect(queue[1].id).toBe('review-due');
    expect(queue[2].id).toBe('new-card');
  });

  it('respects newLimit parameter', () => {
    const now = new Date('2026-03-21T12:00:00Z');
    const newCards = Array.from({ length: 10 }, (_, i) =>
      initCard({ id: `new-${i}` })
    );

    const queue = getStudyQueue(newCards, 3, now);
    expect(queue).toHaveLength(3);
  });

  it('returns empty array when no cards qualify', () => {
    const now = new Date('2026-03-21T12:00:00Z');
    const future = initCard({ id: 'f' });
    future.state = State.Review;
    future.due = new Date('2026-04-01T10:00:00Z').toISOString();

    // No new cards, no due cards
    const queue = getStudyQueue([future], 0, now);
    expect(queue).toEqual([]);
  });
});

// ── generateCardsFromCourse ─────────────────────────────────────────────

describe('generateCardsFromCourse', () => {
  it('returns empty array for null course', () => {
    expect(generateCardsFromCourse(null)).toEqual([]);
  });

  it('returns empty array for course with no deep context', () => {
    const course = { id: 'c1', name: 'Empty Course' };
    expect(generateCardsFromCourse(course)).toEqual([]);
  });

  it('generates cards from keyTermsAndConcepts', () => {
    const course = {
      id: 'c1',
      name: 'Networking',
      keyTermsAndConcepts: [
        { term: 'TCP', definition: 'Transmission Control Protocol' },
        { term: 'UDP', definition: 'User Datagram Protocol' },
      ],
    };
    const cards = generateCardsFromCourse(course);
    expect(cards.length).toBe(2);
    expect(cards[0].front).toContain('TCP');
    expect(cards[0].back).toContain('Transmission Control Protocol');
    expect(cards[0].cardType).toBe('term');
    expect(cards[0].courseId).toBe('c1');
    expect(cards[0].tags).toContain('term');
  });

  it('generates cards from topicBreakdown with subtopics', () => {
    const course = {
      id: 'c2',
      name: 'Security',
      topicBreakdown: [
        {
          topic: 'Cryptography',
          description: 'The practice of secure communication',
          subtopics: ['Symmetric', 'Asymmetric'],
          weight: 'high',
        },
      ],
    };
    const cards = generateCardsFromCourse(course);
    // 1 topic card + 2 subtopic cards = 3
    expect(cards.length).toBe(3);
    const types = cards.map(c => c.cardType);
    expect(types).toContain('topic');
    expect(types).toContain('subtopic');
  });

  it('generates cards from competencies', () => {
    const course = {
      id: 'c3',
      name: 'Math',
      competencies: [
        { code: 'M1', title: 'Calculus Basics', description: 'Limits and derivatives', weight: '30%' },
      ],
    };
    const cards = generateCardsFromCourse(course);
    expect(cards.length).toBe(1);
    expect(cards[0].cardType).toBe('competency');
    expect(cards[0].front).toContain('Calculus Basics');
  });

  it('generates cards from multiple deep context fields', () => {
    const course = {
      id: 'c4',
      name: 'Full Course',
      keyTermsAndConcepts: [{ term: 'A', definition: 'B' }],
      commonMistakes: ['Forgetting semicolons'],
      learningObjectives: ['Understand variables'],
      mnemonics: [{ concept: 'Order of ops', mnemonic: 'PEMDAS' }],
      hardestConcepts: ['Recursion'],
    };
    const cards = generateCardsFromCourse(course);
    // 1 term + 1 mistake + 1 objective + 1 mnemonic + 1 hard-concept = 5
    expect(cards.length).toBe(5);
    const types = cards.map(c => c.cardType);
    expect(types).toContain('term');
    expect(types).toContain('mistake');
    expect(types).toContain('objective');
    expect(types).toContain('mnemonic');
    expect(types).toContain('hard-concept');
  });

  it('skips entries with missing required fields', () => {
    const course = {
      id: 'c5',
      name: 'Partial',
      keyTermsAndConcepts: [
        { term: 'Valid', definition: 'Has both fields' },
        { term: '', definition: 'Missing term' },     // skipped
        { term: 'No def', definition: '' },            // skipped
      ],
      mnemonics: [
        { concept: '', mnemonic: 'No concept' },       // skipped
        { concept: 'Has concept', mnemonic: '' },       // skipped
      ],
    };
    const cards = generateCardsFromCourse(course);
    expect(cards.length).toBe(1); // only the valid term
  });
});

// ── getRetentionStats ───────────────────────────────────────────────────

describe('getRetentionStats', () => {
  it('computes correct statistics for empty card set', () => {
    const stats = getRetentionStats([]);
    expect(stats.totalCards).toBe(0);
    expect(stats.dueToday).toBe(0);
    expect(stats.newCards).toBe(0);
    expect(stats.avgRetention).toBe(0);
    expect(stats.streakDays).toBe(0);
    expect(stats.maturedCards).toBe(0);
  });

  it('counts new cards correctly', () => {
    const cards = [initCard({ id: '1' }), initCard({ id: '2' }), initCard({ id: '3' })];
    const stats = getRetentionStats(cards, '2026-03-21T12:00:00Z');
    expect(stats.totalCards).toBe(3);
    expect(stats.newCards).toBe(3);
    expect(stats.dueToday).toBe(0); // new cards are not counted as due
  });

  it('counts due cards correctly', () => {
    const now = new Date('2026-03-21T12:00:00Z');
    const dueCard = initCard({ id: 'due' });
    dueCard.state = State.Review;
    dueCard.due = new Date('2026-03-20T10:00:00Z').toISOString();
    dueCard.lastReview = new Date('2026-03-19T10:00:00Z').toISOString();
    dueCard.stability = 5;

    const futureCard = initCard({ id: 'future' });
    futureCard.state = State.Review;
    futureCard.due = new Date('2026-04-01T10:00:00Z').toISOString();
    futureCard.lastReview = new Date('2026-03-20T10:00:00Z').toISOString();
    futureCard.stability = 30;

    const stats = getRetentionStats([dueCard, futureCard], now);
    expect(stats.totalCards).toBe(2);
    expect(stats.dueToday).toBe(1); // only dueCard
    expect(stats.newCards).toBe(0);
  });

  it('counts matured cards (stability >= 21 and Review state)', () => {
    const now = new Date('2026-03-21T12:00:00Z');
    const matured = initCard({ id: 'matured' });
    matured.state = State.Review;
    matured.stability = 25;
    matured.due = new Date('2026-04-15T10:00:00Z').toISOString();
    matured.lastReview = new Date('2026-03-20T10:00:00Z').toISOString();

    const notMatured = initCard({ id: 'young' });
    notMatured.state = State.Review;
    notMatured.stability = 5;
    notMatured.due = new Date('2026-03-25T10:00:00Z').toISOString();
    notMatured.lastReview = new Date('2026-03-20T10:00:00Z').toISOString();

    const stats = getRetentionStats([matured, notMatured], now);
    expect(stats.maturedCards).toBe(1);
  });

  it('computes average retention for reviewed cards', () => {
    const now = new Date('2026-03-21T12:00:00Z');
    const card = initCard({ id: 'r1' });
    card.state = State.Review;
    card.stability = 100; // high stability = high retention
    card.lastReview = new Date('2026-03-20T10:00:00Z').toISOString();
    card.due = new Date('2026-06-01T10:00:00Z').toISOString();

    const stats = getRetentionStats([card], now);
    expect(stats.avgRetention).toBeGreaterThan(0);
    expect(stats.avgRetention).toBeLessThanOrEqual(1);
  });
});

// ── serializeCards / deserializeCards ────────────────────────────────────

describe('serializeCards / deserializeCards', () => {
  it('round-trips cards correctly', () => {
    const cards = [
      initCard({ id: 'a', front: 'Q1', back: 'A1', tags: ['tag1'] }),
      initCard({ id: 'b', front: 'Q2', back: 'A2' }),
    ];

    const json = serializeCards(cards);
    expect(typeof json).toBe('string');

    const restored = deserializeCards(json);
    expect(restored).toHaveLength(2);
    expect(restored[0].id).toBe('a');
    expect(restored[0].front).toBe('Q1');
    expect(restored[0].tags).toEqual(['tag1']);
    expect(restored[1].id).toBe('b');
    expect(restored[1].back).toBe('A2');
  });

  it('round-trips cards with review history', () => {
    const now = new Date('2026-03-21T10:00:00Z');
    let card = initCard({ id: 'reviewed' });
    card = scheduleCard(card, Rating.Good, now);
    card = scheduleCard(card, Rating.Good, new Date(now.getTime() + 15 * 60 * 1000));

    const json = serializeCards([card]);
    const restored = deserializeCards(json);
    expect(restored).toHaveLength(1);
    expect(restored[0].reviewLog).toHaveLength(2);
    expect(restored[0].state).toBe(card.state);
    expect(restored[0].stability).toBe(card.stability);
  });

  it('deserializeCards returns empty array for invalid JSON', () => {
    expect(deserializeCards('not valid json')).toEqual([]);
    expect(deserializeCards('')).toEqual([]);
  });

  it('deserializeCards returns empty array for non-array JSON', () => {
    expect(deserializeCards('{"not": "array"}')).toEqual([]);
    expect(deserializeCards('"string"')).toEqual([]);
  });
});
