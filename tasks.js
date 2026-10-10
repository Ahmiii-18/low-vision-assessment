'use strict';

/**
 * 18-task Low Vision Functional Assessment.
 * Static definitions — the frontend randomizes actual stimuli per participant.
 */

const TASKS = [
  { n: 1, name: 'Distance Visual Acuity', type: 'snellen',
    prompt: 'Tap the direction the letter E is pointing.',
    config: { rounds: 6, sizes: [220, 160, 110, 75, 50, 34] } },

  { n: 2, name: 'Contrast Sensitivity', type: 'contrast',
    prompt: 'Is the letter visible? Tap YES or NO.',
    // Michelson-style percentages — 100% = black on white, lower = subtle
    config: { letter: 'H', levels: [100, 75, 50, 30, 20, 12, 8, 5, 3, 2] } },

  { n: 3, name: 'Color Vision (Ishihara)', type: 'ishihara',
    prompt: 'What number do you see in the circle?',
    // The frontend picks one of these at random per participant
    config: { pool: ['74', '12', '45', '8', '29', '57', '6', '3', '15', '97'] } },

  { n: 4, name: 'Amsler Grid', type: 'amsler',
    prompt: 'Stare at the center dot. Tap any areas where the lines look wavy, broken, or missing.',
    config: {} },

  { n: 5, name: 'Visual Field', type: 'visual_field',
    prompt: 'Keep your eyes on the center cross. Tap where the light appears.',
    config: { rounds: 8 } },

  { n: 6, name: 'Motion Detection', type: 'motion',
    prompt: 'Watch the dot. Which direction did it move?',
    config: { rounds: 5 } },

  { n: 7, name: 'Reading Speed', type: 'reading',
    prompt: 'Read the sentence aloud, then type it exactly.',
    config: { pool: [
      'The quick brown fox jumps over the lazy dog.',
      'Bright morning sunlight fills the quiet room.',
      'Small birds sing outside the open window.',
      'A gentle breeze moves the tall green trees.',
      'Coffee is best enjoyed on a calm morning.',
      'The old book lay open on the wooden table.',
      'Rain fell softly on the tin roof all night.',
      'She walked slowly along the narrow path.',
    ] } },

  { n: 8, name: 'Glare Sensitivity', type: 'glare',
    prompt: 'Look at the light. Rate your discomfort (0 = none, 10 = unbearable).',
    config: {} },

  { n: 9, name: 'Face Recognition', type: 'face',
    prompt: 'What emotion does this face show?',
    config: { pool: ['happy', 'sad', 'angry', 'surprised', 'neutral'],
              options: ['Happy', 'Sad', 'Angry', 'Surprised', 'Neutral'] } },

  { n: 10, name: 'Object Recognition', type: 'object',
    prompt: 'What object is shown?',
    config: { pool: ['house', 'tree', 'car', 'boat', 'star'],
              options: ['House', 'Tree', 'Car', 'Boat', 'Star'] } },

  { n: 11, name: 'Depth Perception', type: 'depth',
    prompt: 'Which circle appears closer to you?',
    config: { options: ['Left', 'Right'] } },

  { n: 12, name: 'Text Tracking', type: 'tracking',
    prompt: 'Watch the highlighted word. Type it when it stops.',
    config: {} },

  { n: 13, name: 'Sign Reading', type: 'sign',
    prompt: 'Read the sign aloud, then type the text you see.',
    config: { pool: ['STOP', 'EXIT', 'PUSH', 'PULL', 'DANGER', 'OPEN', 'CLOSED', 'CAUTION'] } },

  { n: 14, name: 'Medication Label', type: 'label',
    prompt: 'What dosage is on the label?',
    config: { pool: [
      { drug: 'IBUPROFEN TABLETS', dose: '200 mg', directions: 'Take one tablet every 6–8 hours as needed.' },
      { drug: 'PARACETAMOL TABLETS', dose: '500 mg', directions: 'Take one or two tablets every 4–6 hours.' },
      { drug: 'ASPIRIN TABLETS', dose: '75 mg', directions: 'Take one tablet once daily with food.' },
      { drug: 'AMOXICILLIN CAPSULES', dose: '250 mg', directions: 'Take one capsule three times daily.' },
      { drug: 'METFORMIN TABLETS', dose: '500 mg', directions: 'Take one tablet twice daily with meals.' },
      { drug: 'ATORVASTATIN TABLETS', dose: '20 mg', directions: 'Take one tablet at bedtime.' },
    ] } },

  { n: 15, name: 'Obstacle Detection', type: 'obstacle',
    prompt: 'Is there an obstacle in the path?',
    config: { options: ['Yes', 'No'] } },

  { n: 16, name: 'Scene Recognition', type: 'scene',
    prompt: 'Describe what you see in one sentence.',
    config: {} },

  { n: 17, name: 'Peripheral Awareness', type: 'peripheral',
    prompt: 'Keep looking at the center dot. Which side did the shape appear on?',
    config: { rounds: 6 } },

  { n: 18, name: 'Daily Task Simulation', type: 'daily',
    prompt: "Find and tap the bottle labeled 'Aspirin 100 mg'.",
    config: {} },
];

const TOTAL_TASKS = TASKS.length;

function scoreTask(task, response, skipped, config) {
  if (skipped) return null;
  const cfg = config || task.config || {};
  const r = String(response ?? '').trim();
  switch (task.type) {
    case 'ishihara':  return r === cfg.number;
    case 'reading':   return r.toLowerCase() === String(cfg.text || '').toLowerCase();
    case 'sign':      return r.toUpperCase() === String(cfg.text || '').toUpperCase();
    case 'label':     return r.toLowerCase() === String(cfg.dose || '').toLowerCase();
    case 'obstacle':  return (r.toLowerCase() === 'yes') === Boolean(cfg.has_obstacle);
    default:          return null;
  }
}

module.exports = { TASKS, TOTAL_TASKS, scoreTask };