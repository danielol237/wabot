let todos = JSON.parse(localStorage.getItem('todos')) || [];
let currentFilter = 'all';

function save() { localStorage.setItem('todos', JSON.stringify(todos)); render(); }

function addTodo() {
  const input = document.getElementById('todoInput');
  const text = input.value.trim();
  if (!text) return;
  todos.push({ id: Date.now(), text, completed: false });
  input.value = '';
  save();
}

function toggleTodo(id) {
  const todo = todos.find(t => t.id === id);
  if (todo) { todo.completed = !todo.completed; save(); }
}

function deleteTodo(id) {
  todos = todos.filter(t => t.id !== id);
  save();
}

function setFilter(filter) {
  currentFilter = filter;
  document.querySelectorAll('.filter').forEach(b => b.classList.remove('active'));
  document.querySelector('.filter[onclick*="' + filter + '"]')?.classList.add('active');
  render();
}

function render() {
  const list = document.getElementById('todoList');
  const filtered = todos.filter(t => {
    if (currentFilter === 'active') return !t.completed;
    if (currentFilter === 'completed') return t.completed;
    return true;
  });
  list.innerHTML = filtered.map(t => '<li class="' + (t.completed ? 'completed' : '') + '">' +
    '<input type="checkbox" ' + (t.completed ? 'checked' : '') + ' onchange="toggleTodo(' + t.id + ')" />' +
    '<span ondblclick="deleteTodo(' + t.id + ')">' + t.text + '</span>' +
    '<button onclick="deleteTodo(' + t.id + ')">\u2715</button>' +
  '</li>').join('');
  document.getElementById('todoCount').textContent = todos.filter(t => !t.completed).length;
}
render();