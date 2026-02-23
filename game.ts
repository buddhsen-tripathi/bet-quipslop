import { generateText } from "ai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { mkdirSync, appendFileSync } from "node:fs";
import { join } from "node:path";

// ── Models ──────────────────────────────────────────────────────────────────

export const MODELS = [
  { id: "google/gemini-3.1-pro-preview", name: "Gemini 3.1 Pro" },
  { id: "moonshotai/kimi-k2", name: "Kimi K2" },
  // { id: "moonshotai/kimi-k2.5", name: "Kimi K2.5" },
  { id: "deepseek/deepseek-v3.2", name: "DeepSeek 3.2" },
  // { id: "z-ai/glm-5", name: "GLM-5" },
  { id: "openai/gpt-5.2", name: "GPT-5.2" },
  { id: "anthropic/claude-opus-4.6", name: "Opus 4.6" },
  { id: "anthropic/claude-sonnet-4.6", name: "Sonnet 4.6" },
  { id: "x-ai/grok-4.1-fast", name: "Grok 4.1" },
  { id: "minimax/minimax-m2.5", name: "MiniMax 2.5" },
  { id: "qwen/qwen3-235b-a22b", name: "Qwen 3" },
  { id: "google/gemma-3-27b-it", name: "Gemma 3" },
] as const;

export type Model = (typeof MODELS)[number];

export const MODEL_COLORS: Record<string, string> = {
  "Gemini 3.1 Pro": "cyan",
  "Kimi K2": "green",
  "Kimi K2.5": "magenta",
  "DeepSeek 3.2": "greenBright",
  "GLM-5": "cyanBright",
  "GPT-5.2": "yellow",
  "Opus 4.6": "blue",
  "Sonnet 4.6": "red",
  "Grok 4.1": "white",
  "MiniMax 2.5": "magentaBright",
  "Qwen 3": "blueBright",
  "Gemma 3": "magenta",
};

export const NAME_PAD = 16;

// ── Types ───────────────────────────────────────────────────────────────────

export type TaskInfo = {
  model: Model;
  startedAt: number;
  finishedAt?: number;
  result?: string;
  error?: string;
};

export type VoteInfo = {
  voter: Model;
  startedAt: number;
  finishedAt?: number;
  votedFor?: Model;
  gifUrl?: string;
  error?: boolean;
  betSide?: "A" | "B";
  betAmount?: number;
  betResult?: number;
};

export type RoundState = {
  num: number;
  phase: "prompting" | "betting" | "answering" | "voting" | "done";
  prompter: Model;
  promptTask: TaskInfo;
  prompt?: string;
  contestants: [Model, Model];
  answerTasks: [TaskInfo, TaskInfo];
  votes: VoteInfo[];
  scoreA?: number;
  scoreB?: number;
  viewerVotesA?: number;
  viewerVotesB?: number;
  viewerVotingEndsAt?: number;
  votingPhaseEndsAt?: number;
};

export type GameState = {
  completed: RoundState[];
  active: RoundState | null;
  scores: Record<string, number>;
  viewerScores: Record<string, number>;
  done: boolean;
  isPaused: boolean;
  generation: number;
  modelBalances: Record<string, number>;
  eliminatedModels: string[];
  viewerBalance: number;
};

// ── OpenRouter ──────────────────────────────────────────────────────────────

const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
  extraBody: {
    reasoning: {
      effort: "medium",
    },
  },
});

// ── Logger ──────────────────────────────────────────────────────────────────

const LOGS_DIR = join(import.meta.dir, "logs");
mkdirSync(LOGS_DIR, { recursive: true });
const LOG_FILE = join(
  LOGS_DIR,
  `game-${new Date().toISOString().replace(/[:.]/g, "-")}.log`,
);

export { LOG_FILE };

export function log(
  level: "INFO" | "WARN" | "ERROR",
  category: string,
  message: string,
  data?: Record<string, unknown>,
) {
  const ts = new Date().toISOString();
  let line = `[${ts}] ${level} [${category}] ${message}`;
  if (data) {
    line += " " + JSON.stringify(data);
  }
  appendFileSync(LOG_FILE, line + "\n");
  if (level === "ERROR") {
    console.error(line);
  } else if (level === "WARN") {
    console.warn(line);
  } else {
    console.log(line);
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

export function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  validate: (result: T) => boolean,
  retries = 3,
  label = "unknown",
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const result = await fn();
      if (validate(result)) {
        log("INFO", label, `Success on attempt ${attempt}`, {
          result: typeof result === "string" ? result : String(result),
        });
        return result;
      }
      const msg = `Validation failed (attempt ${attempt}/${retries})`;
      log("WARN", label, msg, {
        result: typeof result === "string" ? result : String(result),
      });
      lastErr = new Error(`${msg}: ${JSON.stringify(result).slice(0, 100)}`);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      log("WARN", label, `Error on attempt ${attempt}/${retries}: ${errMsg}`, {
        error: errMsg,
        stack: err instanceof Error ? err.stack : undefined,
      });
      lastErr = err;
    }
    if (attempt < retries) {
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
  log("ERROR", label, `All ${retries} attempts failed`, {
    lastError: lastErr instanceof Error ? lastErr.message : String(lastErr),
  });
  throw lastErr;
}

export function isRealString(s: string, minLength = 5): boolean {
  return s.length >= minLength;
}

export function cleanResponse(text: string): string {
  const trimmed = text.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

// ── AI functions ────────────────────────────────────────────────────────────

import { ALL_PROMPTS } from "./prompts";

function buildPromptSystem(): string {
  const examples = shuffle([...ALL_PROMPTS]).slice(0, 80);
  return `You are a comedy writer for the game Quiplash. Generate a single funny fill-in-the-blank prompt that players will try to answer. The prompt should be surprising and designed to elicit hilarious responses. Return ONLY the prompt text, nothing else. Keep it short (under 15 words).

Use a wide VARIETY of prompt formats. Do NOT always use "The worst thing to..." — mix it up! Here are examples of the range of styles:

${examples.map((p) => `- ${p}`).join("\n")}

Come up with something ORIGINAL — don't copy these examples.`;
}

export async function callGeneratePrompt(model: Model): Promise<string> {
  log("INFO", `prompt:${model.name}`, "Calling API", { modelId: model.id });
  const system = buildPromptSystem();
  const { text, usage, reasoning } = await generateText({
    model: openrouter.chat(model.id),
    system,
    prompt:
      "Generate a single original Quiplash prompt. Be creative and don't repeat common patterns.",
  });

  log("INFO", `prompt:${model.name}`, "Raw response", {
    rawText: text,
    usage,
  });
  return cleanResponse(text);
}

export async function callGenerateAnswer(
  model: Model,
  prompt: string,
): Promise<string> {
  log("INFO", `answer:${model.name}`, "Calling API", {
    modelId: model.id,
    prompt,
  });
  const { text, usage, reasoning } = await generateText({
    model: openrouter.chat(model.id),
    system: `You are playing Quiplash! You'll be given a fill-in-the-blank prompt. Give the FUNNIEST possible answer. Be creative, edgy, unexpected, and concise. Reply with ONLY your answer — no quotes, no explanation, no preamble. Keep it short (under 12 words). Keep it concise and witty.`,
    prompt: `Fill in the blank: ${prompt}`,
  });

  log("INFO", `answer:${model.name}`, "Raw response", {
    rawText: text,
    usage,
  });
  return cleanResponse(text);
}

export async function callBlindBet(
  voter: Model,
  prompt: string,
  contestantA: Model,
  contestantB: Model,
): Promise<{ side: "A" | "B"; confidence: 15 | 25 | 45 }> {
  log("INFO", `blindbet:${voter.name}`, "Calling API", {
    modelId: voter.id,
    prompt,
    contestantA: contestantA.name,
    contestantB: contestantB.name,
  });
  const { text, usage } = await generateText({
    model: openrouter.chat(voter.id),
    system: `You are a judge in a comedy game called Quiplash. Two AI models are about to answer a fill-in-the-blank prompt. You must place a BLIND BET on which model you think will give the funnier answer — you have NOT seen their answers yet.

You only know:
- The prompt they'll be answering
- The names of the two contestants

Think about each model's comedy style, strengths, and how they might approach this specific prompt.

Respond in EXACTLY this format (two lines):
Line 1: A or B (which contestant you're betting on)
Line 2: 15, 25, or 45 (your confidence — how much you're willing to wager)

Example response:
A
25`,
    prompt: `Prompt: "${prompt}"\n\nContestant A: ${contestantA.name}\nContestant B: ${contestantB.name}\n\nWho do you think will be funnier? Place your blind bet!`,
  });

  log("INFO", `blindbet:${voter.name}`, "Raw response", { rawText: text, usage });
  const lines = text.trim().split("\n").map((l) => l.trim()).filter(Boolean);
  const sideLine = (lines[0] ?? "").toUpperCase();
  const confLine = parseInt(lines[1] ?? "25", 10);

  if (!sideLine.startsWith("A") && !sideLine.startsWith("B")) {
    throw new Error(`Invalid blind bet: "${text.trim()}"`);
  }

  const confidence: 15 | 25 | 45 =
    confLine === 15 ? 15 : confLine === 45 ? 45 : 25;

  return {
    side: sideLine.startsWith("A") ? "A" : "B",
    confidence,
  };
}

export async function callVote(
  voter: Model,
  prompt: string,
  a: { answer: string },
  b: { answer: string },
): Promise<{ vote: "A" | "B"; gifQuery: string }> {
  log("INFO", `vote:${voter.name}`, "Calling API", {
    modelId: voter.id,
    prompt,
    answerA: a.answer,
    answerB: b.answer,
  });
  const { text, usage, reasoning } = await generateText({
    model: openrouter.chat(voter.id),
    system: `You are a judge in a comedy game. You'll see a fill-in-the-blank prompt and two answers. Pick which answer is FUNNIER.

Respond in EXACTLY this format (two lines):
Line 1: A or B (your vote)
Line 2: A 2-3 word reaction describing your reaction as a GIF (e.g. "mind blown", "crying laughing", "spit take", "dead inside", "rolling on floor")

Example response:
A
crying laughing`,
    prompt: `Prompt: "${prompt}"\n\nAnswer A: "${a.answer}"\nAnswer B: "${b.answer}"\n\nWhich is funnier?`,
  });

  log("INFO", `vote:${voter.name}`, "Raw response", { rawText: text, usage });
  const lines = text.trim().split("\n").map((l) => l.trim()).filter(Boolean);
  const voteLine = (lines[0] ?? "").toUpperCase();
  const gifLine = lines[1] ?? "funny reaction";

  if (!voteLine.startsWith("A") && !voteLine.startsWith("B")) {
    throw new Error(`Invalid vote: "${text.trim()}"`);
  }

  return {
    vote: voteLine.startsWith("A") ? "A" : "B",
    gifQuery: gifLine.replace(/^(gif|reaction):\s*/i, "").trim() || "funny reaction",
  };
}

// ── GIF Cache ──────────────────────────────────────────────────────────────

const GIF_CACHE_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours
const GIF_MAX_MISSES_PER_ROUND = 3;
const gifCache = new Map<string, { url: string; fetchedAt: number }>();
let gifMissesThisRound = 0;

export function resetGifFetchBudget() {
  gifMissesThisRound = 0;
}

function normalizeGifQuery(query: string): string {
  return query.toLowerCase().trim().replace(/\s+/g, " ");
}

async function fetchReactionGifRaw(query: string): Promise<string | null> {
  const apiKey = process.env.GIPHY_API_KEY;
  if (!apiKey) return null;

  try {
    const url = `https://api.giphy.com/v1/gifs/search?api_key=${apiKey}&q=${encodeURIComponent(query)}&limit=8&rating=pg-13&lang=en`;
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      data?: { images?: { fixed_height_small?: { url?: string } } }[];
    };
    const results = data.data ?? [];
    if (results.length === 0) return null;
    // Pick a random result from top 8 for variety
    const pick = results[Math.floor(Math.random() * results.length)];
    return pick?.images?.fixed_height_small?.url ?? null;
  } catch {
    return null;
  }
}

export async function fetchReactionGif(query: string): Promise<string | null> {
  const key = normalizeGifQuery(query);
  const now = Date.now();

  // Check cache first
  const cached = gifCache.get(key);
  if (cached && now - cached.fetchedAt < GIF_CACHE_TTL_MS) {
    log("INFO", "gif:cache", "Cache hit", { query: key });
    return cached.url;
  }

  // Budget check — skip API call if we've hit the miss limit this round
  if (gifMissesThisRound >= GIF_MAX_MISSES_PER_ROUND) {
    log("WARN", "gif:cache", "Round budget exhausted, skipping fetch", {
      query: key,
      misses: gifMissesThisRound,
    });
    return null;
  }

  gifMissesThisRound++;
  const url = await fetchReactionGifRaw(query);
  if (url) {
    gifCache.set(key, { url, fetchedAt: now });
    log("INFO", "gif:cache", "Cache miss → fetched", { query: key });
  }
  return url;
}

const PRESEED_QUERIES = [
  "mind blown", "crying laughing", "spit take", "dead inside",
  "rolling on floor", "slow clap", "face palm", "shocked",
  "disappointed", "laughing hard", "funny reaction", "oh no",
  "cringe", "genius", "bruh moment", "chef kiss",
  "standing ovation", "awkward", "savage", "mic drop",
];

export function preseedGifCache() {
  const apiKey = process.env.GIPHY_API_KEY;
  if (!apiKey) return;

  log("INFO", "gif:cache", "Pre-seeding GIF cache", {
    queries: PRESEED_QUERIES.length,
  });

  PRESEED_QUERIES.forEach((query, i) => {
    setTimeout(async () => {
      const key = normalizeGifQuery(query);
      if (gifCache.has(key)) return;
      const url = await fetchReactionGifRaw(query);
      if (url) {
        gifCache.set(key, { url, fetchedAt: Date.now() });
      }
    }, i * 100);
  });
}

import { saveRound } from "./db.ts";

// ── Game loop ───────────────────────────────────────────────────────────────

export async function runGame(
  runs: number,
  state: GameState,
  rerender: () => void,
  onViewerVotingStart?: (round: RoundState) => void,
) {
  let startRound = 1;
  const lastCompletedRound = state.completed.at(-1);
  if (lastCompletedRound) {
    startRound = lastCompletedRound.num + 1;
  }

  let endRound = startRound + runs - 1;

  for (let r = startRound; r <= endRound; r++) {
    while (state.isPaused) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    resetGifFetchBudget();
    const roundGeneration = state.generation;

    // Reset round counter if generation changed (e.g. admin reset)
    const latest = state.completed.at(-1);
    const expectedR = latest ? latest.num + 1 : 1;
    if (r !== expectedR) {
      r = expectedR;
      endRound = r + runs - 1;
    }

    // Filter to only active (non-eliminated) models
    const activeModels = MODELS.filter(
      (m) => !state.eliminatedModels.includes(m.name),
    );

    if (activeModels.length < 3) {
      log("WARN", "round", "Not enough active models to continue", {
        active: activeModels.length,
        eliminated: state.eliminatedModels,
      });
      break;
    }

    const shuffled = shuffle([...activeModels]);
    const prompter = shuffled[0]!;
    const contA = shuffled[1]!;
    const contB = shuffled[2]!;
    const voters = [prompter, ...shuffled.slice(3)];
    const now = Date.now();

    const round: RoundState = {
      num: r,
      phase: "prompting",
      prompter,
      promptTask: { model: prompter, startedAt: now },
      contestants: [contA, contB],
      answerTasks: [
        { model: contA, startedAt: 0 },
        { model: contB, startedAt: 0 },
      ],
      votes: [],
    };
    state.active = round;
    log("INFO", "round", `=== Round ${r}/${runs} ===`, {
      prompter: prompter.name,
      contestants: [contA.name, contB.name],
      voters: voters.map((v) => v.name),
      activeModels: activeModels.map((m) => m.name),
    });
    rerender();

    // ── Prompt phase ──
    try {
      const prompt = await withRetry(
        () => callGeneratePrompt(prompter),
        (s) => isRealString(s, 10),
        3,
        `R${r}:prompt:${prompter.name}`,
      );
      if (state.generation !== roundGeneration) {
        continue;
      }
      round.promptTask.finishedAt = Date.now();
      round.promptTask.result = prompt;
      round.prompt = prompt;
      rerender();
    } catch {
      if (state.generation !== roundGeneration) {
        continue;
      }
      round.promptTask.finishedAt = Date.now();
      round.promptTask.error = "Failed after 3 attempts";
      round.phase = "done";
      state.completed = [...state.completed, round];
      state.active = null;
      rerender();
      continue;
    }

    // ── Blind betting phase ── (before answers, models bet on who they think will be funnier)
    round.phase = "betting";
    round.votes = voters.map((v) => ({ voter: v, startedAt: Date.now() }));

    // Initialize viewer voting at the start of betting (viewers can vote alongside judges)
    round.viewerVotesA = 0;
    round.viewerVotesB = 0;
    round.viewerVotingEndsAt = Date.now() + 180_000; // generous window covering betting + answering + voting
    onViewerVotingStart?.(round);
    rerender();

    await Promise.all(
      round.votes.map(async (vote) => {
        if (state.generation !== roundGeneration) return;
        try {
          const result = await withRetry(
            () => callBlindBet(vote.voter, round.prompt!, contA, contB),
            (v) => v.side === "A" || v.side === "B",
            3,
            `R${r}:blindbet:${vote.voter.name}`,
          );
          if (state.generation !== roundGeneration) return;
          vote.betSide = result.side;
          vote.betAmount = result.confidence;
          log("INFO", "blindbet", `${vote.voter.name} blind bet ${result.confidence} on ${result.side} (${result.side === "A" ? contA.name : contB.name})`, {
            model: vote.voter.name,
            side: result.side,
            amount: result.confidence,
          });
        } catch {
          if (state.generation !== roundGeneration) return;
          // Default bet if API fails
          vote.betSide = Math.random() > 0.5 ? "A" : "B";
          vote.betAmount = 15;
        }
        rerender();
      }),
    );
    if (state.generation !== roundGeneration) continue;

    // ── Answer phase ──
    round.phase = "answering";
    const answerStart = Date.now();
    round.answerTasks[0].startedAt = answerStart;
    round.answerTasks[1].startedAt = answerStart;

    rerender();

    await Promise.all(
      round.answerTasks.map(async (task) => {
        if (state.generation !== roundGeneration) {
          return;
        }
        try {
          const answer = await withRetry(
            () => callGenerateAnswer(task.model, round.prompt!),
            (s) => isRealString(s, 3),
            3,
            `R${r}:answer:${task.model.name}`,
          );
          if (state.generation !== roundGeneration) {
            return;
          }
          task.result = answer;
        } catch {
          if (state.generation !== roundGeneration) {
            return;
          }
          task.error = "Failed to answer";
          task.result = "[no answer]";
        }
        if (state.generation !== roundGeneration) {
          return;
        }
        task.finishedAt = Date.now();
        rerender();
      }),
    );
    if (state.generation !== roundGeneration) {
      continue;
    }

    // ── Vote phase ── (models now vote after seeing answers, bets were already locked in)
    round.phase = "voting";
    round.votingPhaseEndsAt = Date.now() + 30_000;
    const answerA = round.answerTasks[0].result!;
    const answerB = round.answerTasks[1].result!;
    const voteStart = Date.now();
    // Reset startedAt for vote phase (bets were placed earlier)
    for (const v of round.votes) {
      v.startedAt = voteStart;
    }

    rerender();

    await Promise.all([
      // Model votes
      Promise.all(
      round.votes.map(async (vote) => {
        if (state.generation !== roundGeneration) {
          return;
        }
        try {
          const showAFirst = Math.random() > 0.5;
          const first = showAFirst ? { answer: answerA } : { answer: answerB };
          const second = showAFirst ? { answer: answerB } : { answer: answerA };

          const result = await withRetry(
            () => callVote(vote.voter, round.prompt!, first, second),
            (v) => v.vote === "A" || v.vote === "B",
            3,
            `R${r}:vote:${vote.voter.name}`,
          );
          if (state.generation !== roundGeneration) {
            return;
          }
          const votedFor = showAFirst
            ? result.vote === "A"
              ? contA
              : contB
            : result.vote === "A"
              ? contB
              : contA;

          vote.finishedAt = Date.now();
          vote.votedFor = votedFor;

          // Fetch a reaction GIF in the background
          const gifUrl = await fetchReactionGif(result.gifQuery);
          if (gifUrl) {
            vote.gifUrl = gifUrl;
            rerender();
          }
        } catch {
          if (state.generation !== roundGeneration) {
            return;
          }
          vote.finishedAt = Date.now();
          vote.error = true;
        }
        if (state.generation !== roundGeneration) {
          return;
        }
        rerender();
      }),
    ),
      // 30-second viewer voting window
      new Promise((resolve) => setTimeout(resolve, 30_000)),
    ]);
    if (state.generation !== roundGeneration) {
      continue;
    }

    // ── Score ──
    let votesA = 0;
    let votesB = 0;
    for (const v of round.votes) {
      if (v.votedFor === contA) votesA++;
      else if (v.votedFor === contB) votesB++;
    }
    round.scoreA = votesA * 100;
    round.scoreB = votesB * 100;
    round.phase = "done";
    if (votesA > votesB) {
      state.scores[contA.name] = (state.scores[contA.name] || 0) + 1;
    } else if (votesB > votesA) {
      state.scores[contB.name] = (state.scores[contB.name] || 0) + 1;
    }

    // ── Settle bets (pool-based, viewers included) ──
    const winner: "A" | "B" | "tie" =
      votesA > votesB ? "A" : votesB > votesA ? "B" : "tie";

    // Viewer vote scoring
    const vvA = round.viewerVotesA ?? 0;
    const vvB = round.viewerVotesB ?? 0;
    if (vvA > vvB) {
      state.viewerScores[contA.name] = (state.viewerScores[contA.name] || 0) + 1;
    } else if (vvB > vvA) {
      state.viewerScores[contB.name] = (state.viewerScores[contB.name] || 0) + 1;
    }

    // Determine viewer bet side ($25 into the pool)
    const VIEWER_BET = 25;
    const viewerPick: "A" | "B" | null = vvA > vvB ? "A" : vvB > vvA ? "B" : null;
    const viewerInPool = viewerPick !== null && state.viewerBalance >= VIEWER_BET;

    // Calculate pool including viewer bet
    const validBets = round.votes.filter((v) => v.betSide && v.betAmount);
    const modelPool = validBets.reduce((s, v) => s + (v.betAmount ?? 0), 0);
    const totalPool = modelPool + (viewerInPool ? VIEWER_BET : 0);

    const modelWinnerPool = validBets
      .filter((v) => v.betSide === winner)
      .reduce((s, v) => s + (v.betAmount ?? 0), 0);
    const viewerOnWinningSide = viewerInPool && viewerPick === winner;
    const winnerPool = modelWinnerPool + (viewerOnWinningSide ? VIEWER_BET : 0);

    // Settle model bets
    for (const v of round.votes) {
      if (!v.betSide || !v.betAmount) continue;
      const voterName = v.voter.name;

      if (winner === "tie") {
        v.betResult = 0;
      } else if (v.betSide === winner) {
        const payout = winnerPool > 0
          ? Math.round((v.betAmount / winnerPool) * totalPool)
          : v.betAmount;
        const profit = payout - v.betAmount;
        v.betResult = profit;
        state.modelBalances[voterName] =
          (state.modelBalances[voterName] ?? 0) + profit;
      } else {
        v.betResult = -v.betAmount;
        state.modelBalances[voterName] =
          (state.modelBalances[voterName] ?? 0) - v.betAmount;

        if ((state.modelBalances[voterName] ?? 0) <= 0) {
          state.modelBalances[voterName] = 0;
          if (!state.eliminatedModels.includes(voterName)) {
            state.eliminatedModels = [...state.eliminatedModels, voterName];
            log("WARN", "elimination", `${voterName} has been ELIMINATED!`, {
              model: voterName,
              balance: 0,
            });
          }
        }
      }

      log("INFO", "bet:settle", `${voterName} bet $${v.betAmount} on ${v.betSide} → ${v.betResult > 0 ? "+" : ""}${v.betResult} (pool: $${totalPool}, winner pool: $${winnerPool})`, {
        model: voterName,
        bet: v.betAmount,
        side: v.betSide,
        result: v.betResult,
        pool: totalPool,
        winnerPool,
        balance: state.modelBalances[voterName],
      });
    }

    // Settle viewer bet (same pool logic)
    if (viewerInPool && winner !== "tie") {
      if (viewerOnWinningSide) {
        const payout = winnerPool > 0
          ? Math.round((VIEWER_BET / winnerPool) * totalPool)
          : VIEWER_BET;
        const profit = payout - VIEWER_BET;
        state.viewerBalance += profit;
        log("INFO", "bet:settle", `Viewers bet $${VIEWER_BET} on ${viewerPick} → +${profit} (pool: $${totalPool})`, {
          viewerBet: VIEWER_BET,
          side: viewerPick,
          profit,
          balance: state.viewerBalance,
        });
      } else {
        state.viewerBalance = Math.max(0, state.viewerBalance - VIEWER_BET);
        log("INFO", "bet:settle", `Viewers bet $${VIEWER_BET} on ${viewerPick} → -${VIEWER_BET} (pool: $${totalPool})`, {
          viewerBet: VIEWER_BET,
          side: viewerPick,
          loss: -VIEWER_BET,
          balance: state.viewerBalance,
        });
      }
    }

    rerender();

    await new Promise((resolve) => setTimeout(resolve, 5000));
    if (state.generation !== roundGeneration) {
      continue;
    }

    // Archive round
    saveRound(round);
    state.completed = [...state.completed, round];
    state.active = null;
    rerender();
  }

  state.done = true;
  rerender();
}
