// Friday Quiz - realtime server
// Serves the host and player pages and keeps one authoritative game state
// that is synced to every connected client over Socket.IO.

const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const HOST_PASSWORD = process.env.HOST_PASSWORD || 'friday';

app.use(express.static(path.join(__dirname, 'public')));

app.get('/host', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'host.html'));
});
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'player.html'));
});

/* ---------------- GAME STATE (single live quiz per server) ---------------- */

function generateCode() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

const state = {
  gameCode: generateCode(),
  questions: [],      // [{ question, options: [...], correctIndex, answeredBy: { playerId: bool } }]
  currentIndex: -1,   // -1 = lobby, nothing shown yet
  revealed: false,
  timer: {
    duration: 30,
    remaining: 30,
    running: false,
    startTs: null      // ms since epoch when the current run began, adjusted for prior remaining
  },
  participants: {}    // playerId -> { id, name, score }
};

let timerInterval = null;

function currentQuestion() {
  return state.questions[state.currentIndex] || null;
}

function sortedLeaderboard() {
  return Object.values(state.participants)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .map(p => ({ id: p.id, name: p.name, score: p.score }));
}

function broadcastLeaderboard() {
  io.to('all').emit('state:leaderboard', sortedLeaderboard());
}

function questionBase() {
  const q = currentQuestion();
  return {
    index: state.currentIndex,
    total: state.questions.length,
    question: q ? q.question : null,
    options: q ? q.options : [],
    revealed: state.revealed
  };
}
function playerQuestionPayload() {
  const q = currentQuestion();
  const payload = questionBase();
  if (state.revealed && q) payload.correctIndex = q.correctIndex;
  return payload;
}
function hostQuestionPayload() {
  const q = currentQuestion();
  const payload = questionBase();
  if (q) payload.correctIndex = q.correctIndex;
  return payload;
}
function broadcastQuestion() {
  io.to('players').emit('state:question', playerQuestionPayload());
  io.to('hosts').emit('state:question', hostQuestionPayload());
}

function broadcastTimer() {
  io.to('all').emit('state:timer', state.timer);
}

function stopTimerInterval() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

function startTimer() {
  if (state.timer.running || state.timer.remaining <= 0) return;
  state.timer.running = true;
  state.timer.startTs = Date.now() - (state.timer.duration - state.timer.remaining) * 1000;
  broadcastTimer();

  stopTimerInterval();
  timerInterval = setInterval(() => {
    const elapsed = (Date.now() - state.timer.startTs) / 1000;
    state.timer.remaining = Math.max(0, state.timer.duration - elapsed);
    if (state.timer.remaining <= 0) {
      state.timer.remaining = 0;
      state.timer.running = false;
      stopTimerInterval();
      broadcastTimer();
      io.to('all').emit('timer:end');
      return;
    }
    broadcastTimer();
  }, 500);
}

function pauseTimer() {
  if (!state.timer.running) return;
  state.timer.running = false;
  stopTimerInterval();
  broadcastTimer();
}

function resetTimer() {
  state.timer.running = false;
  stopTimerInterval();
  state.timer.remaining = state.timer.duration;
  broadcastTimer();
}

function setDuration(secs) {
  const d = Math.max(5, Math.min(600, Number(secs) || 30));
  state.timer.duration = d;
  state.timer.running = false;
  stopTimerInterval();
  state.timer.remaining = d;
  broadcastTimer();
}

/* ---------------- SOCKET.IO ---------------- */

io.on('connection', (socket) => {
  const role = socket.handshake.query.role === 'host' ? 'host' : 'player';
  socket.join('all');
  socket.data.isHost = false;

  if (role === 'player') {
    socket.join('players');
    socket.emit('state:question', playerQuestionPayload());
    socket.emit('state:leaderboard', sortedLeaderboard());
    socket.emit('state:timer', state.timer);
  }

  // --- Host authentication ---
  socket.on('host:auth', (password) => {
    if (String(password) === String(HOST_PASSWORD)) {
      socket.data.isHost = true;
      socket.join('hosts');
      socket.emit('host:authOk', {
        gameCode: state.gameCode,
        questions: state.questions.map(q => ({
          question: q.question,
          options: q.options,
          correctIndex: q.correctIndex
        })),
        currentIndex: state.currentIndex,
        revealed: state.revealed,
        timer: state.timer,
        leaderboard: sortedLeaderboard()
      });
    } else {
      socket.emit('host:authFail');
    }
  });

  function requireHost() {
    return socket.data.isHost === true;
  }

  socket.on('host:uploadQuestions', (questions) => {
    if (!requireHost() || !Array.isArray(questions)) return;
    state.questions = questions
      .filter(q => q && q.question && Array.isArray(q.options) && q.options.length >= 2)
      .map(q => ({
        question: String(q.question),
        options: q.options.map(String),
        correctIndex: Number.isInteger(q.correctIndex) ? q.correctIndex : -1,
        answeredBy: {},
        firstCorrectId: null
      }));
    state.currentIndex = state.questions.length ? 0 : -1;
    state.revealed = false;
    resetTimer();
    broadcastQuestion();
  });

  socket.on('host:next', () => {
    if (!requireHost()) return;
    if (state.currentIndex < state.questions.length - 1) {
      state.currentIndex += 1;
      state.revealed = false;
      resetTimer();
      broadcastQuestion();
    }
  });

  socket.on('host:prev', () => {
    if (!requireHost()) return;
    if (state.currentIndex > 0) {
      state.currentIndex -= 1;
      state.revealed = false;
      resetTimer();
      broadcastQuestion();
    }
  });

  socket.on('host:reveal', () => {
    if (!requireHost()) return;
    state.revealed = !state.revealed;
    broadcastQuestion();
  });

  socket.on('host:timerStart', () => { if (requireHost()) startTimer(); });
  socket.on('host:timerPause', () => { if (requireHost()) pauseTimer(); });
  socket.on('host:timerReset', () => { if (requireHost()) resetTimer(); });
  socket.on('host:setDuration', (secs) => { if (requireHost()) setDuration(secs); });

  socket.on('host:adjustScore', ({ id, delta }) => {
    if (!requireHost()) return;
    const p = state.participants[id];
    if (p) {
      p.score = Math.max(0, p.score + Number(delta));
      broadcastLeaderboard();
    }
  });

  socket.on('host:renameParticipant', ({ id, name }) => {
    if (!requireHost()) return;
    const p = state.participants[id];
    if (p && name && name.trim()) {
      p.name = name.trim().slice(0, 24);
      broadcastLeaderboard();
    }
  });

  socket.on('host:removeParticipant', ({ id }) => {
    if (!requireHost()) return;
    delete state.participants[id];
    broadcastLeaderboard();
  });

  socket.on('host:resetScores', () => {
    if (!requireHost()) return;
    Object.values(state.participants).forEach(p => { p.score = 0; });
    state.questions.forEach(q => { q.answeredBy = {}; q.firstCorrectId = null; });
    broadcastLeaderboard();
  });

  socket.on('host:regenerateCode', () => {
    if (!requireHost()) return;
    state.gameCode = generateCode();
    socket.emit('host:codeUpdated', state.gameCode);
  });

  // --- Player events ---
  socket.on('player:join', ({ name, code, existingId }) => {
    name = (name || '').trim().slice(0, 24);
    code = (code || '').trim();

    if (code !== state.gameCode) {
      socket.emit('player:error', 'That game code is not correct.');
      return;
    }
    if (!name) {
      socket.emit('player:error', 'Please enter a name.');
      return;
    }

    let participant;
    if (existingId && state.participants[existingId]) {
      participant = state.participants[existingId];
      participant.name = name; // allow name refresh on rejoin
    } else {
      const id = 'p-' + Math.random().toString(36).slice(2, 10);
      participant = { id, name, score: 0 };
      state.participants[id] = participant;
    }

    socket.data.playerId = participant.id;
    socket.emit('player:joined', { id: participant.id, name: participant.name, score: participant.score });
    broadcastLeaderboard();
  });

  socket.on('player:answer', ({ id, optionIdx }) => {
    const participant = state.participants[id];
    const q = currentQuestion();
    if (!participant || !q) return;
    if (q.answeredBy[id]) {
      socket.emit('player:answerAck', { locked: true, alreadyAnswered: true });
      return;
    }

    const isCorrect = optionIdx === q.correctIndex;
    let awarded = false;

    // Only the first correct responder on each question earns the point.
    // Wrong answers never subtract points.
    if (isCorrect && !q.firstCorrectId) {
      q.firstCorrectId = participant.id;
      participant.score += 1;
      awarded = true;
      io.to('hosts').emit('host:info', `${participant.name} was first with the right answer! (+1)`);
    }
    q.answeredBy[id] = { optionIdx, isCorrect, awarded };

    socket.emit('player:answerAck', { locked: true, optionIdx, correct: isCorrect, awarded });
    broadcastLeaderboard();
  });

  socket.on('disconnect', () => {
    // Participants persist server-side; players simply rejoin with their stored id.
  });
});

server.listen(PORT, () => {
  console.log(`Friday Quiz server running on port ${PORT}`);
  console.log(`Host password: ${HOST_PASSWORD}`);
});
