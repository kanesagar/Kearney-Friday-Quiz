# Friday Quiz — Live

A real-time team trivia app. You (the host) run the questions and timer from
`/host`; players join from the plain root URL on their own phones, answer
live, and everyone sees one shared leaderboard update instantly.

## How it works

- **Host page** (`/host`): upload a CSV/JSON question file, control the
  timer, step through questions, reveal answers, and manage the leaderboard.
- **Player page** (`/`): players enter the game code you give them + their
  name, then answer each question on their own device.
- Scoring is automatic — a correct answer is worth 1 point, added the
  instant they submit.
- Everything is kept in the server's memory and pushed to every connected
  device over WebSockets (Socket.IO), so there's nothing to refresh.

## Run it locally first (recommended before deploying)

You'll need [Node.js](https://nodejs.org) 18 or newer installed.

```bash
cd friday-quiz-live
npm install
npm start
```

Then open `http://localhost:3000/host` yourself, and
`http://localhost:3000` on another device on the same WiFi to test as a
player.

The host password defaults to **friday**. Change it by setting the
`HOST_PASSWORD` environment variable (see deployment steps below).

## Deploying so anyone can join from anywhere

The easiest free option that supports real-time WebSockets with no credit
card is **Render**. Steps:

1. **Put this folder in a GitHub repo.**
   - Create a free GitHub account if you don't have one, then create a new
     repository and upload/push these files (`server.js`, `package.json`,
     the `public/` folder, etc.) to it.
2. **Create a Render account** at [render.com](https://render.com) (no card
   required for the free tier).
3. Click **New → Web Service**, connect your GitHub repo.
4. Set:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type:** Free
5. Add an environment variable so only you can control the quiz:
   - Key: `HOST_PASSWORD`
   - Value: any password you choose
6. Click **Create Web Service**. Render will build and deploy it, giving you
   a public URL like `https://friday-quiz-xxxx.onrender.com`.
7. Share `https://friday-quiz-xxxx.onrender.com` with your players, and go
   to `https://friday-quiz-xxxx.onrender.com/host` yourself, entering the
   password you set.

**Good to know about the free tier:** the service goes to sleep after 15
minutes with no traffic, and takes 30–60 seconds to wake back up on the
next visit. That's fine for a weekly quiz — just open `/host` a minute or
two before you want to start so it's already awake, and it'll stay awake
for the whole session since active connections count as traffic. Because
game state lives in memory, a restart (e.g. a fresh deploy, or the service
sleeping across days) clears questions and scores — which is expected for
a one-off "Friday Quiz" night; just re-upload your questions each time you
play.

## Question file format

**CSV** — one question per row, correct answer as a letter, number, or the
exact option text; the first row may optionally be a header:
```
question,option1,option2,option3,option4,correct
What is the capital of Japan?,Seoul,Tokyo,Beijing,Bangkok,B
```

**JSON**:
```json
[
  {
    "question": "What is the capital of Japan?",
    "options": ["Seoul", "Tokyo", "Beijing", "Bangkok"],
    "correct": "B"
  }
]
```

There's also a "Load sample questions" button on the host page so you can
try the whole flow before your own file is ready.

## Customizing

- Colors, fonts, and layout live in `public/style.css` plus small
  page-specific `<style>` blocks in `host.html` / `player.html`.
- Game logic (scoring, timer, question flow) lives in `server.js` — it's a
  single file, plain Express + Socket.IO, no build step.
