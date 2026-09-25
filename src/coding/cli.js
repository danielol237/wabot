#!/usr/bin/env node
// ARIA Coding Subsystem Terminal CLI Inspector
const path = require("path");
const TaskStore = require("./state/TaskStore");

const store = new TaskStore();

function printTaskStatus(taskId) {
  const task = store.getTask(taskId);
  if (!task) {
    console.error(`❌ Task '${taskId}' not found in TaskStore.`);
    process.exit(1);
  }

  console.log(`\n================ ARIA TASK STATUS ================`);
  console.log(`Task ID:       ${task.id}`);
  console.log(`Request:       "${task.request}"`);
  console.log(`State:         ${task.status}`);
  console.log(`Stage/Phase:   ${task.phase || task.status}`);
  console.log(`Current Step:  ${task.currentStep || "N/A"}`);
  console.log(`Provider:      ${task.provider}`);
  console.log(`Workspace:     ${task.workspacePath || "Host / Default"}`);
  console.log(`Created At:    ${task.createdAt}`);
  console.log(`Updated At:    ${task.updatedAt}`);
  if (task.completedAt) console.log(`Completed At:  ${task.completedAt}`);
  if (task.blockedReason) console.log(`Blocked Reason:${task.blockedReason}`);

  if (task.filesChanged && task.filesChanged.length > 0) {
    console.log(`\nFiles Changed:`);
    task.filesChanged.forEach((f) => console.log(`  • ${f}`));
  }

  if (task.verification && task.verification.length > 0) {
    console.log(`\nVerification Evidence:`);
    task.verification.forEach((v) => console.log(`  ✓ ${v}`));
  }

  if (task.errors && task.errors.length > 0) {
    console.log(`\nErrors:`);
    task.errors.forEach((e) => console.log(`  ❌ ${e}`));
  }

  if (task.events && task.events.length > 0) {
    console.log(`\nRecent Events (${task.events.length} total):`);
    task.events.slice(-5).forEach((evt) => {
      console.log(`  [${evt.timestamp}] ${evt.state || "EVENT"}: ${evt.message || JSON.stringify(evt)}`);
    });
  }
  console.log(`==================================================\n`);
}

function listTasks() {
  const tasks = store.getAllTasks();
  console.log(`\n================ ARIA TASKS LIST (${tasks.length}) ================`);
  if (tasks.length === 0) {
    console.log("No tasks found in TaskStore.");
  } else {
    tasks.forEach((t) => {
      console.log(`${t.id} | [${t.status}] | ${t.provider} | "${t.request.slice(0, 50)}"`);
    });
  }
  console.log(`==================================================\n`);
}

const args = process.argv.slice(2);
const cmd = args[0] || "list";

if (cmd === "status" || cmd === "inspect") {
  if (!args[1]) {
    console.error("Usage: node src/coding/cli.js status <taskId>");
    process.exit(1);
  }
  printTaskStatus(args[1]);
} else if (cmd === "list") {
  listTasks();
} else {
  console.log("Usage: node src/coding/cli.js [list|status <taskId>]");
}
