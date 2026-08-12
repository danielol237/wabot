// One-time builder: add stable lesson IDs to the curriculum and inject a
// handful of quiz + exercise lessons so the assessment engine has content.
// Run: node scripts/buildStudyCurriculum.js  (regenerates src/data/studyCurriculum.js)
const fs = require("fs");
const path = require("path");
const { LANGUAGES } = require("../src/data/studyCurriculum");

function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
}

// Add id to every lesson
for (const [lang, langObj] of Object.entries(LANGUAGES)) {
  for (const [level, lessons] of Object.entries(langObj.levels)) {
    lessons.forEach((l, i) => {
      if (!l.id) l.id = `${lang}-${level}-${slug(l.title)}-${i + 1}`;
    });
  }
}

// Inject quizzes + exercises into select lessons by matching title substrings.
function addQuiz(lessons, titleMatch, quiz) {
  const l = lessons.find((x) => x.title.includes(titleMatch));
  if (l) l.quiz = quiz;
}
function addExercise(lessons, titleMatch, ex) {
  const l = lessons.find((x) => x.title.includes(titleMatch));
  if (l) l.exercise = ex;
}

// JS beginner: loops quiz
addQuiz(LANGUAGES.js.levels.beginner, "Loops", {
  question: "Which loop runs its body at least once even if the condition is false?",
  options: ["for loop", "while loop", "do...while loop", "for...of loop"],
  answer: "C",
  explain: "do...while checks the condition AFTER running the body, so it always runs at least once.",
  retryExplain: "Remember: do...while runs the body first, then checks the condition.",
});
addExercise(LANGUAGES.js.levels.beginner, "Loops", {
  lang: "js",
  prompt: "Write a for loop that prints the numbers 1 to 5, one per line.",
  expected: "1\n2\n3\n4\n5",
});
addExercise(LANGUAGES.js.levels.beginner, "Functions", {
  lang: "js",
  prompt: "Write a function named add that returns a + b, then call add(2,3) and print the result.",
  expected: "5",
});

// JS intermediate: async/arrays quiz
addQuiz(LANGUAGES.js.levels.intermediate, "Asynchronous", {
  question: "Which keyword pauses a function until a Promise resolves?",
  options: ["await", "yield", "return", "catch"],
  answer: "A",
  explain: "await pauses execution until the awaited Promise settles, inside an async function.",
  retryExplain: "Think of pausing execution until the promise finishes — that's await.",
});

// Python beginner: loops exercise
addExercise(LANGUAGES.python.levels.beginner, "Loops", {
  lang: "py",
  prompt: "Write a for loop that prints the numbers 1 to 5, one per line.",
  expected: "1\n2\n3\n4\n5",
});
addQuiz(LANGUAGES.python.levels.beginner, "Lists", {
  question: "What does len([1, 2, 3]) return?",
  options: ["2", "3", "4", "An error"],
  answer: "B",
  explain: "len() returns the number of items in the list — three items here.",
  retryExplain: "len() counts how many items are in the collection.",
});

// CSS beginner: flexbox quiz
addQuiz(LANGUAGES.css.levels.beginner, "Flexbox", {
  question: "Which property controls horizontal distribution in a flex container?",
  options: ["align-items", "justify-content", "flex-direction", "position"],
  answer: "B",
  explain: "justify-content controls alignment along the main axis (horizontal by default).",
  retryExplain: "It's the one that spreads items across the row — justify-content.",
});

// HTML beginner: forms quiz
addQuiz(LANGUAGES.html.levels.beginner, "Forms", {
  question: "Which element is used to group a label with an input for accessibility?",
  options: ["<span>", "<div>", "<label>", "<input>"],
  answer: "C",
  explain: "The <label> element associates text with an input, improving accessibility.",
  retryExplain: "It's the element that labels the input field — <label>.",
});

fs.writeFileSync(path.join(__dirname, "../src/data/studyCurriculum.js"),
  `// ── ARIA Study Curriculum ─────────────────────────────────────────\n// Auto-built with stable lesson IDs. Do not edit IDs by hand; re-run\n// scripts/buildStudyCurriculum.js to regenerate.\n\nconst LANGUAGES = ${JSON.stringify(LANGUAGES, null, 2)};\n\nmodule.exports = { LANGUAGES };\n`);
console.log("Curriculum rebuilt with IDs + quizzes/exercises.");
console.log("Quizzes:", Object.values(LANGUAGES).reduce((s, l) => s + Object.values(l.levels).reduce((s2, arr) => s2 + arr.filter((x) => x.quiz).length, 0), 0));
console.log("Exercises:", Object.values(LANGUAGES).reduce((s, l) => s + Object.values(l.levels).reduce((s2, arr) => s2 + arr.filter((x) => x.exercise).length, 0), 0));
