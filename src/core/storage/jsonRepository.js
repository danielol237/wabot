const fs = require("fs");
const path = require("path");

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function createJsonRepository(file, initialValue) {
  const absolute = path.resolve(file);
  const directory = path.dirname(absolute);

  function read() {
    try {
      const raw = fs.readFileSync(absolute, "utf8");
      return clone(JSON.parse(raw));
    } catch (_) {
      return clone(typeof initialValue === "function" ? initialValue() : initialValue);
    }
  }

  function write(value) {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const temporary = `${absolute}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
    fs.renameSync(temporary, absolute);
    try { fs.chmodSync(absolute, 0o600); } catch (_) {}
    return clone(value);
  }

  function mutate(mutator) {
    const current = read();
    const result = mutator(current);
    return write(result === undefined ? current : result);
  }

  function ensure() {
    if (!fs.existsSync(absolute)) write(typeof initialValue === "function" ? initialValue() : initialValue);
    return read();
  }

  return Object.freeze({
    file: absolute,
    read,
    write,
    mutate,
    ensure,
  });
}

module.exports = { createJsonRepository };
