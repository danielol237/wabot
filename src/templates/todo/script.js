(() => {
  const STORAGE_KEY = "daymark.todos.v2";
  const form = document.getElementById("todoForm");
  const input = document.getElementById("todoInput");
  const list = document.getElementById("todoList");
  const emptyState = document.getElementById("emptyState");
  const emptyTitle = document.getElementById("emptyTitle");
  const emptyCopy = document.getElementById("emptyCopy");
  const formError = document.getElementById("formError");
  const todoCount = document.getElementById("todoCount");
  const totalCount = document.getElementById("totalCount");
  const progressValue = document.getElementById("progressValue");
  const clearCompleted = document.getElementById("clearCompleted");
  const resetAll = document.getElementById("resetAll");
  const filterButtons = [...document.querySelectorAll("[data-filter]")];
  let currentFilter = "all";
  let todos = loadTodos();

  function loadTodos() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      return Array.isArray(parsed) ? parsed.filter((todo) => todo && typeof todo.text === "string").slice(0, 500) : [];
    } catch (_) { return []; }
  }
  function saveTodos() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(todos)); return true; }
    catch (_) { showError("This browser could not save the list. Check storage permissions."); return false; }
  }
  function showError(message) { formError.textContent = message; formError.hidden = !message; }
  function makeId() { return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`; }
  function visibleTodos() {
    if (currentFilter === "active") return todos.filter((todo) => !todo.completed);
    if (currentFilter === "completed") return todos.filter((todo) => todo.completed);
    return todos;
  }
  function createTodoElement(todo) {
    const item = document.createElement("li");
    item.className = todo.completed ? "todo-item completed" : "todo-item";
    item.dataset.id = todo.id;

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = Boolean(todo.completed);
    checkbox.id = `todo-${todo.id}`;
    checkbox.setAttribute("aria-label", `Mark ${todo.text} as ${todo.completed ? "open" : "done"}`);
    checkbox.addEventListener("change", () => {
      todo.completed = checkbox.checked;
      saveTodos();
      render();
    });

    const label = document.createElement("label");
    label.className = "todo-label";
    label.htmlFor = checkbox.id;
    label.textContent = todo.text;

    const deleteButton = document.createElement("button");
    deleteButton.className = "delete-button";
    deleteButton.type = "button";
    deleteButton.setAttribute("aria-label", `Delete ${todo.text}`);
    deleteButton.textContent = "×";
    deleteButton.addEventListener("click", () => {
      todos = todos.filter((item) => item.id !== todo.id);
      saveTodos();
      render();
    });

    item.append(checkbox, label, deleteButton);
    return item;
  }
  function render() {
    list.replaceChildren(...visibleTodos().map(createTodoElement));
    const openCount = todos.filter((todo) => !todo.completed).length;
    const doneCount = todos.length - openCount;
    todoCount.textContent = String(openCount);
    totalCount.textContent = String(todos.length);
    progressValue.textContent = `${todos.length ? Math.round((doneCount / todos.length) * 100) : 0}%`;
    progressValue.parentElement.style.setProperty("--progress", `${todos.length ? (doneCount / todos.length) * 360 : 0}deg`);
    const shown = visibleTodos().length;
    emptyState.hidden = shown > 0;
    if (!shown) {
      emptyTitle.textContent = todos.length ? `No ${currentFilter} tasks.` : "Nothing here yet.";
      emptyCopy.textContent = todos.length ? "Try another filter or add a new task." : "Add one small task and give it a clear place to land.";
    }
    for (const button of filterButtons) {
      const active = button.dataset.filter === currentFilter;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    }
    clearCompleted.disabled = doneCount === 0;
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const text = input.value.trim();
    if (!text) { showError("Write a task before adding it."); input.focus(); return; }
    showError("");
    todos.unshift({ id: makeId(), text, completed: false, createdAt: new Date().toISOString() });
    input.value = "";
    saveTodos();
    render();
    input.focus();
  });
  for (const button of filterButtons) button.addEventListener("click", () => { currentFilter = button.dataset.filter; render(); });
  clearCompleted.addEventListener("click", () => { todos = todos.filter((todo) => !todo.completed); saveTodos(); render(); });
  resetAll.addEventListener("click", () => { if (!todos.length || window.confirm("Reset the entire list?")) { todos = []; saveTodos(); render(); } });
  render();
})();
