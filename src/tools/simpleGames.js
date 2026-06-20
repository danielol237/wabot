// In-memory game state for simple turn-based games. Keyed by chat ID since
// only one game of each type should run per chat at a time.

const activeGames = new Map(); // chatId -> { type, board, players, turn }

function startTicTacToe(chatId, player1, player2) {
  activeGames.set(chatId, {
    type: "ttt",
    board: Array(9).fill(null),
    players: [player1, player2],
    turn: 0,
  });
  return renderTicTacToe(chatId);
}

function renderTicTacToe(chatId) {
  const game = activeGames.get(chatId);
  if (!game) return null;
  const symbols = game.board.map((cell) => cell || "⬜");
  const board = `${symbols[0]}${symbols[1]}${symbols[2]}\n${symbols[3]}${symbols[4]}${symbols[5]}\n${symbols[6]}${symbols[7]}${symbols[8]}`;
  return `*Tic Tac Toe*\n${board}\n\n${game.players[game.turn]}'s turn (${game.turn === 0 ? "❌" : "⭕"})\nReply with a number 1-9 to play.`;
}

function playTicTacToe(chatId, playerName, position) {
  const game = activeGames.get(chatId);
  if (!game || game.type !== "ttt") return { success: false, error: "No active game." };
  if (game.players[game.turn] !== playerName) return { success: false, error: "Not your turn." };

  const idx = position - 1;
  if (idx < 0 || idx > 8 || game.board[idx]) return { success: false, error: "Invalid move." };

  game.board[idx] = game.turn === 0 ? "❌" : "⭕";

  const winner = checkTicTacToeWinner(game.board);
  if (winner) {
    activeGames.delete(chatId);
    return { success: true, finished: true, message: `🎉 ${game.players[game.turn]} wins!\n\n${renderBoardOnly(game.board)}` };
  }
  if (game.board.every((c) => c)) {
    activeGames.delete(chatId);
    return { success: true, finished: true, message: `🤝 It's a draw!\n\n${renderBoardOnly(game.board)}` };
  }

  game.turn = 1 - game.turn;
  return { success: true, finished: false, message: renderTicTacToe(chatId) };
}

function renderBoardOnly(board) {
  const symbols = board.map((cell) => cell || "⬜");
  return `${symbols[0]}${symbols[1]}${symbols[2]}\n${symbols[3]}${symbols[4]}${symbols[5]}\n${symbols[6]}${symbols[7]}${symbols[8]}`;
}

function checkTicTacToeWinner(board) {
  const lines = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8],
    [0, 3, 6], [1, 4, 7], [2, 5, 8],
    [0, 4, 8], [2, 4, 6],
  ];
  for (const [a, b, c] of lines) {
    if (board[a] && board[a] === board[b] && board[b] === board[c]) return board[a];
  }
  return null;
}

function hasActiveGame(chatId) {
  return activeGames.has(chatId);
}

function endGame(chatId) {
  activeGames.delete(chatId);
}

// Simple instant games — no state needed
function rollDice() {
  return Math.floor(Math.random() * 6) + 1;
}

function flipCoin() {
  return Math.random() < 0.5 ? "Heads" : "Tails";
}

module.exports = {
  startTicTacToe,
  playTicTacToe,
  hasActiveGame,
  endGame,
  rollDice,
  flipCoin,
};
