// ── ARIA Academy — Curriculum Engine ─────────────────────────────
// Tracks → Levels → Modules → Lessons.
// Every lesson has the full structure:
//   { id, title, theory, example, exercise, quiz, challenge, project }
// This is an ENGINE, not a static dump: content is organized so new lessons
// are cheap to add and progress survives edits (stable IDs + versioning).

const TRACKS = [
  { id: "html", name: "HTML", tagline: "The skeleton of every web page", levels: ["beginner", "intermediate", "advanced", "pro"], emoji: "📄" },
  { id: "css", name: "CSS", tagline: "Make it beautiful", levels: ["beginner", "intermediate", "advanced", "pro"], emoji: "🎨" },
  { id: "js", name: "JavaScript", tagline: "Make it interactive", levels: ["beginner", "intermediate", "advanced", "pro"], emoji: "⚡" },
  { id: "ts", name: "TypeScript", tagline: "JS with types and safety", levels: ["beginner", "intermediate", "advanced", "pro"], emoji: "🟦" },
  { id: "react", name: "React", tagline: "Build component UIs", levels: ["beginner", "intermediate", "advanced", "pro"], emoji: "⚛️" },
  { id: "node", name: "Node.js", tagline: "JavaScript on the server", levels: ["beginner", "intermediate", "advanced", "pro"], emoji: "🟢" },
  { id: "backend", name: "Backend Engineering", tagline: "APIs, auth, and services", levels: ["beginner", "intermediate", "advanced", "pro"], emoji: "🔌" },
  { id: "sql", name: "SQL & Databases", tagline: "Model and query data", levels: ["beginner", "intermediate", "advanced", "pro"], emoji: "🗄️" },
  { id: "python", name: "Python", tagline: "Readable, powerful, everywhere", levels: ["beginner", "intermediate", "advanced", "pro"], emoji: "🐍" },
  { id: "cpp", name: "C++", tagline: "Fast, low-level, powerful", levels: ["beginner", "intermediate", "advanced", "pro"], emoji: "⚙️" },
  { id: "linux", name: "Linux & CLI", tagline: "Own your operating system", levels: ["beginner", "intermediate", "advanced", "pro"], emoji: "🐧" },
  { id: "git", name: "Git & GitHub", tagline: "Version control every dev needs", levels: ["beginner", "intermediate", "advanced", "pro"], emoji: "🔀" },
  { id: "algo", name: "Algorithms & Data Structures", tagline: "The core of CS", levels: ["beginner", "intermediate", "advanced", "pro"], emoji: "🧮" },
  { id: "security", name: "Cybersecurity", tagline: "Engineering secure systems", levels: ["beginner", "intermediate", "advanced", "pro"], emoji: "🛡️" },
  { id: "devops", name: "DevOps & Cloud", tagline: "Ship and operate systems", levels: ["beginner", "intermediate", "advanced", "pro"], emoji: "☁️" },
  { id: "sysdesign", name: "System Design", tagline: "Architect at scale", levels: ["beginner", "intermediate", "advanced", "pro"], emoji: "🏗️" },
  { id: "testing", name: "Software Testing", tagline: "Prove your code works", levels: ["beginner", "intermediate", "advanced", "pro"], emoji: "🧪" },
  { id: "aieng", name: "AI Engineering", tagline: "Build LLM-powered systems", levels: ["beginner", "intermediate", "advanced", "pro"], emoji: "🤖" },
  { id: "mobile", name: "Mobile Development", tagline: "Android, React Native, Flutter", levels: ["beginner", "intermediate", "advanced", "pro"], emoji: "📱" },
  { id: "networking", name: "Networking", tagline: "How systems talk", levels: ["beginner", "intermediate", "advanced", "pro"], emoji: "🌐" },
];

const LEVEL_DEFS = {
  beginner: "🌱",
  intermediate: "🌿",
  advanced: "🔥",
  pro: "👑",
};

module.exports = { TRACKS, LEVEL_DEFS };
