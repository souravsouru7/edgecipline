// The five parts of the Mind Score, shared by the /progress breakdown and the
// "How it works" sheet. Weights mirror backend/utils/mindProgress.js WEIGHTS
// (keep them in sync); they renormalise when a part has no data yet.
export const MIND_COMPONENTS = [
  { key: "emotional", label: "Emotional control", emoji: "😤", weight: 25, what: "Revenge, FOMO and impulsive trades", explain: "Calm, patient trades vs revenge, FOMO and fear-driven ones." },
  { key: "discipline", label: "Discipline", emoji: "📋", weight: 25, what: "Rules and plan followed", explain: "Following your checklist rules and your daily plan." },
  { key: "recovery", label: "Recovery", emoji: "💪", weight: 20, what: "How you act after a loss", explain: "After a loss: do you stay calm, or jump back in within minutes?" },
  { key: "selfAwareness", label: "Self-awareness", emoji: "🪞", weight: 15, what: "Your grades vs how trades really went", explain: "How well your own trade grades match how trades really went." },
  { key: "journaling", label: "Honest journaling", emoji: "📓", weight: 15, what: "Emotions and reflections logged", explain: "Logging trades, emotions and reflections honestly." },
];

export const MIND_LEVELS = [
  { level: 1, min: 0, name: "Rookie Mind", emoji: "🌱" },
  { level: 2, min: 30, name: "Aware Trader", emoji: "👀" },
  { level: 3, min: 50, name: "Focused Trader", emoji: "🧊" },
  { level: 4, min: 70, name: "Disciplined", emoji: "🔥" },
  { level: 5, min: 85, name: "Calm Pro", emoji: "🧘" },
  { level: 6, min: 95, name: "Mind Master", emoji: "👑" },
];
