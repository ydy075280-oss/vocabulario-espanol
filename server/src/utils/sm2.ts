// SM-2 Spaced Repetition Algorithm
// Based on SuperMemo 2 by Piotr Wozniak

export interface SM2Result {
  easeFactor: number;
  interval: number;
  repetitions: number;
  nextReviewAt: string;
  status: 'new' | 'learning' | 'mastered';
}

export function calculateSM2(
  currentEaseFactor: number,
  currentInterval: number,
  currentRepetitions: number,
  score: 0 | 1 | 2 | 3 | 4
): SM2Result {
  let easeFactor = currentEaseFactor;
  let interval = currentInterval;
  let repetitions = currentRepetitions;

  if (score >= 3) {
    // Correct response
    if (repetitions === 0) {
      interval = 1;
    } else if (repetitions === 1) {
      interval = 3;
    } else {
      interval = Math.round(interval * easeFactor);
    }
    repetitions += 1;
  } else if (score >= 1) {
    // Hesitant or incorrect with recall
    repetitions = 0;
    interval = 1;
  } else {
    // Complete blackout
    repetitions = 0;
    interval = 1;
  }

  // Update ease factor
  easeFactor = easeFactor + (0.1 - (4 - score) * (0.08 + (4 - score) * 0.02));
  if (easeFactor < 1.3) {
    easeFactor = 1.3;
  }

  // Calculate next review date
  const now = new Date();
  now.setDate(now.getDate() + interval);
  const nextReviewAt = now.toISOString();

  let status: 'new' | 'learning' | 'mastered';
  if (score >= 4 && interval >= 21) {
    status = 'mastered';
  } else if (score >= 3 && repetitions >= 1) {
    status = 'learning';
  } else {
    status = 'new';
  }

  return { easeFactor, interval, repetitions, nextReviewAt, status };
}
