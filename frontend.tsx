import React, { useState, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import "./frontend.css";

// ── Types ────────────────────────────────────────────────────────────────────

type Model = { id: string; name: string };
type TaskInfo = {
  model: Model;
  startedAt: number;
  finishedAt?: number;
  result?: string;
  error?: string;
};
type VoteInfo = {
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
type RoundState = {
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
type GameState = {
  lastCompleted: RoundState | null;
  active: RoundState | null;
  scores: Record<string, number>;
  viewerScores: Record<string, number>;
  done: boolean;
  isPaused: boolean;
  generation: number;
  modelBalances: Record<string, number>;
  eliminatedModels: string[];
  viewerBalance?: number;
};
type StateMessage = {
  type: "state";
  data: GameState;
  totalRounds: number;
  viewerCount: number;
  version?: string;
};
type ViewerCountMessage = {
  type: "viewerCount";
  viewerCount: number;
};
type VoteAckMessage = {
  type: "vote_ack";
  side: "A" | "B";
};
type ServerMessage = StateMessage | ViewerCountMessage | VoteAckMessage;

// ── Model colors & logos ─────────────────────────────────────────────────────

const MODEL_COLORS: Record<string, string> = {
  "Gemini 3.1 Pro": "#4285F4",
  "Kimi K2": "#00E599",
  "DeepSeek 3.2": "#4D6BFE",
  "GLM-5": "#1F63EC",
  "GPT-5.2": "#10A37F",
  "Opus 4.6": "#D97757",
  "Sonnet 4.6": "#E8956A",
  "Grok 4.1": "#FFFFFF",
  "MiniMax 2.5": "#FF3B30",
  "Qwen 3": "#6F5EF9",
  "Gemma 3": "#8E75FF",
};

function getColor(name: string): string {
  return MODEL_COLORS[name] ?? "#A1A1A1";
}

function getLogo(name: string): string | null {
  if (name.includes("Gemini")) return "/assets/logos/gemini.svg";
  if (name.includes("Kimi")) return "/assets/logos/kimi.svg";
  if (name.includes("DeepSeek")) return "/assets/logos/deepseek.svg";
  if (name.includes("GLM")) return "/assets/logos/glm.svg";
  if (name.includes("GPT")) return "/assets/logos/openai.svg";
  if (name.includes("Opus") || name.includes("Sonnet"))
    return "/assets/logos/claude.svg";
  if (name.includes("Grok")) return "/assets/logos/grok.svg";
  if (name.includes("MiniMax")) return "/assets/logos/minimax.svg";
  if (name.includes("Qwen")) return "/assets/logos/qwen.svg";
  if (name.includes("Gemma")) return "/assets/logos/gemini.svg";
  return null;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function Dots() {
  return (
    <span className="dots">
      <span>.</span>
      <span>.</span>
      <span>.</span>
    </span>
  );
}

function ModelTag({ model, small }: { model: Model; small?: boolean }) {
  const logo = getLogo(model.name);
  const color = getColor(model.name);
  return (
    <span
      className={`model-tag ${small ? "model-tag--sm" : ""}`}
      style={{ color }}
    >
      {logo && <img src={logo} alt="" className="model-tag__logo" />}
      {model.name}
    </span>
  );
}

// ── Prompt ───────────────────────────────────────────────────────────────────

function PromptCard({ round }: { round: RoundState }) {
  if (round.phase === "prompting" && !round.prompt) {
    return (
      <div className="prompt">
        <div className="prompt__by">
          <ModelTag model={round.prompter} small /> is writing a prompt
          <Dots />
        </div>
        <div className="prompt__text prompt__text--loading">
          <Dots />
        </div>
      </div>
    );
  }

  if (round.promptTask.error) {
    return (
      <div className="prompt">
        <div className="prompt__text prompt__text--error">
          Prompt generation failed
        </div>
      </div>
    );
  }

  return (
    <div className="prompt">
      <div className="prompt__by">
        Prompted by <ModelTag model={round.prompter} small />
      </div>
      <div className="prompt__text">{round.prompt}</div>
    </div>
  );
}

// ── Contestant ───────────────────────────────────────────────────────────────

function ContestantCard({
  task,
  voteCount,
  totalVotes,
  isWinner,
  showVotes,
  voters,
  viewerVotes,
  totalViewerVotes,
  isMyVote,
}: {
  task: TaskInfo;
  voteCount: number;
  totalVotes: number;
  isWinner: boolean;
  showVotes: boolean;
  voters: VoteInfo[];
  viewerVotes?: number;
  totalViewerVotes?: number;
  isMyVote?: boolean;
}) {
  const color = getColor(task.model.name);
  const pct = totalVotes > 0 ? Math.round((voteCount / totalVotes) * 100) : 0;
  const showViewerVotes = showVotes && totalViewerVotes !== undefined && totalViewerVotes > 0;
  const viewerPct = showViewerVotes && totalViewerVotes > 0
    ? Math.round(((viewerVotes ?? 0) / totalViewerVotes) * 100)
    : 0;

  return (
    <div
      className={`contestant ${isWinner ? "contestant--winner" : ""} ${isMyVote ? "contestant--my-vote" : ""}`}
      style={{ "--accent": color } as React.CSSProperties}
    >
      <div className="contestant__head">
        <ModelTag model={task.model} />
        {isWinner && <span className="win-tag">WIN</span>}
        {isMyVote && <span className="my-vote-tag">YOUR VOTE</span>}
      </div>

      <div className="contestant__body">
        {!task.finishedAt ? (
          <p className="answer answer--loading">
            <Dots />
          </p>
        ) : task.error ? (
          <p className="answer answer--error">{task.error}</p>
        ) : (
          <p className="answer">&ldquo;{task.result}&rdquo;</p>
        )}
      </div>

      {showVotes && (
        <div className="contestant__foot">
          <div className="vote-bar">
            <div
              className="vote-bar__fill"
              style={{ width: `${pct}%`, background: color }}
            />
          </div>
          <div className="vote-meta">
            <span className="vote-meta__count" style={{ color }}>
              {voteCount}
            </span>
            <span className="vote-meta__label">
              vote{voteCount !== 1 ? "s" : ""}
            </span>
            <span className="vote-meta__dots">
              {voters.map((v, i) => {
                const logo = getLogo(v.voter.name);
                return (
                  <span key={i} className="voter-dot-wrap" title={v.voter.name}>
                    {logo ? (
                      <img
                        src={logo}
                        alt={v.voter.name}
                        className="voter-dot"
                      />
                    ) : (
                      <span
                        className="voter-dot voter-dot--letter"
                        style={{ color: getColor(v.voter.name) }}
                      >
                        {v.voter.name[0]}
                      </span>
                    )}
                  </span>
                );
              })}
            </span>
          </div>
          {voters.some((v) => v.gifUrl) && (
            <div className="vote-gifs">
              {voters
                .filter((v) => v.gifUrl)
                .map((v, i) => (
                  <div key={i} className="vote-gif" title={v.voter.name}>
                    <img src={v.gifUrl} alt="reaction" />
                    <span
                      className="vote-gif__label"
                      style={{ color: getColor(v.voter.name) }}
                    >
                      {v.voter.name}
                    </span>
                  </div>
                ))}
            </div>
          )}
          {showViewerVotes && (
            <>
              <div className="vote-bar viewer-vote-bar">
                <div
                  className="vote-bar__fill viewer-vote-bar__fill"
                  style={{ width: `${viewerPct}%` }}
                />
              </div>
              <div className="vote-meta viewer-vote-meta">
                <span className="vote-meta__count viewer-vote-meta__count">
                  {viewerVotes ?? 0}
                </span>
                <span className="vote-meta__label">
                  viewer vote{(viewerVotes ?? 0) !== 1 ? "s" : ""}
                </span>
                <span className="viewer-vote-meta__icon">👥</span>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── Arena ─────────────────────────────────────────────────────────────────────

function Arena({
  round,
  total,
  viewerVotingSecondsLeft,
  votingPhaseSecondsLeft,
  myVote,
  onVote,
}: {
  round: RoundState;
  total: number | null;
  viewerVotingSecondsLeft: number;
  votingPhaseSecondsLeft: number;
  myVote: "A" | "B" | null;
  onVote: (side: "A" | "B") => void;
}) {
  const [contA, contB] = round.contestants;
  const showVotes = round.phase === "voting" || round.phase === "done";
  const hasBets = round.votes.some((v) => v.betSide);
  const showBets = round.phase !== "prompting" && (round.phase === "betting" || hasBets);
  const isDone = round.phase === "done";

  let votesA = 0,
    votesB = 0;
  for (const v of round.votes) {
    if (v.votedFor?.name === contA.name) votesA++;
    else if (v.votedFor?.name === contB.name) votesB++;
  }
  const totalVotes = votesA + votesB;
  const votersA = round.votes.filter((v) => v.votedFor?.name === contA.name);
  const votersB = round.votes.filter((v) => v.votedFor?.name === contB.name);
  const totalViewerVotes = (round.viewerVotesA ?? 0) + (round.viewerVotesB ?? 0);

  const showCountdown = round.phase === "voting" && votingPhaseSecondsLeft > 0;
  const showVoteButtons = (round.phase === "betting" || round.phase === "answering" || round.phase === "voting") && viewerVotingSecondsLeft > 0;

  const phaseText =
    round.phase === "prompting"
      ? "Writing prompt"
      : round.phase === "betting"
        ? "Judges placing blind bets"
        : round.phase === "answering"
          ? "Answering"
          : round.phase === "voting"
            ? "Judges voting"
            : "Complete";

  return (
    <div className="arena">
      <div className="arena__meta">
        <span className="arena__round">
          Round {round.num}
          {total ? <span className="dim">/{total}</span> : null}
        </span>
        <span className="arena__phase">
          {phaseText}
          {showCountdown && (
            <span className="vote-countdown">{votingPhaseSecondsLeft}s</span>
          )}
        </span>
      </div>
      <PromptCard round={round} />

      {showBets && (() => {
        const betsOnA = round.votes.filter((v) => v.betSide === "A");
        const betsOnB = round.votes.filter((v) => v.betSide === "B");
        const poolA = betsOnA.reduce((s, v) => s + (v.betAmount ?? 0), 0);
        const poolB = betsOnB.reduce((s, v) => s + (v.betAmount ?? 0), 0);
        const totalPool = poolA + poolB;
        const isBetting = round.phase === "betting";

        return (
          <div className={`blind-bets ${isDone ? "blind-bets--settled" : ""}`}>
            <div className="blind-bets__header">
              <div className="blind-bets__label">
                {isBetting ? <>Blind bets<Dots /></> : "Blind bets"}
              </div>
              {totalPool > 0 && (
                <div className="blind-bets__pool">Pool: ${totalPool}</div>
              )}
            </div>
            {totalPool > 0 && (
              <div className="blind-bets__sides">
                <div className="blind-bets__side">
                  <span className="blind-bets__side-name" style={{ color: getColor(contA.name) }}>
                    {contA.name}
                  </span>
                  <span className="blind-bets__side-amount">${poolA}</span>
                </div>
                <div className="blind-bets__bar">
                  <div
                    className="blind-bets__bar-fill blind-bets__bar-fill--a"
                    style={{ width: `${totalPool > 0 ? (poolA / totalPool) * 100 : 50}%`, background: getColor(contA.name) }}
                  />
                  <div
                    className="blind-bets__bar-fill blind-bets__bar-fill--b"
                    style={{ width: `${totalPool > 0 ? (poolB / totalPool) * 100 : 50}%`, background: getColor(contB.name) }}
                  />
                </div>
                <div className="blind-bets__side">
                  <span className="blind-bets__side-name" style={{ color: getColor(contB.name) }}>
                    {contB.name}
                  </span>
                  <span className="blind-bets__side-amount">${poolB}</span>
                </div>
              </div>
            )}
            <div className="blind-bets__list">
              {round.votes.map((v, i) => (
                <span key={i} className={`blind-bet-chip ${v.betSide ? "blind-bet-chip--placed" : ""} ${isDone && v.betResult !== undefined ? (v.betResult > 0 ? "blind-bet-chip--won" : v.betResult < 0 ? "blind-bet-chip--lost" : "") : ""}`}>
                  <ModelTag model={v.voter} small />
                  {v.betSide && v.betAmount && (
                    <span className="blind-bet-chip__amount">
                      ${v.betAmount} on {v.betSide === "A" ? contA.name : contB.name}
                      {isDone && v.betResult !== undefined && (
                        <span className={`blind-bet-chip__result ${v.betResult > 0 ? "blind-bet-chip__result--won" : v.betResult < 0 ? "blind-bet-chip__result--lost" : ""}`}>
                          {v.betResult > 0 ? ` +$${v.betResult}` : v.betResult < 0 ? ` -$${Math.abs(v.betResult)}` : " push"}
                        </span>
                      )}
                    </span>
                  )}
                </span>
              ))}
            </div>
          </div>
        );
      })()}

      {showVoteButtons && (
        <div className="vote-buttons">
          <button
            className={`vote-btn ${myVote === "A" ? "vote-btn--selected" : ""}`}
            style={{ "--btn-color": getColor(contA.name) } as React.CSSProperties}
            onClick={() => onVote("A")}
            disabled={!!myVote}
          >
            {myVote === "A" && <span className="vote-btn__check">&#10003;</span>}
            {myVote === "A" ? `Locked: ${contA.name}` : `Vote ${contA.name}`}
          </button>
          <button
            className={`vote-btn ${myVote === "B" ? "vote-btn--selected" : ""}`}
            style={{ "--btn-color": getColor(contB.name) } as React.CSSProperties}
            onClick={() => onVote("B")}
            disabled={!!myVote}
          >
            {myVote === "B" && <span className="vote-btn__check">&#10003;</span>}
            {myVote === "B" ? `Locked: ${contB.name}` : `Vote ${contB.name}`}
          </button>
        </div>
      )}

      {round.phase !== "prompting" && (
        <div className="showdown">
          <ContestantCard
            task={round.answerTasks[0]}
            voteCount={votesA}
            totalVotes={totalVotes}
            isWinner={isDone && votesA > votesB}
            showVotes={showVotes}
            voters={votersA}
            viewerVotes={round.viewerVotesA}
            totalViewerVotes={totalViewerVotes}
            isMyVote={myVote === "A"}
          />
          <ContestantCard
            task={round.answerTasks[1]}
            voteCount={votesB}
            totalVotes={totalVotes}
            isWinner={isDone && votesB > votesA}
            showVotes={showVotes}
            voters={votersB}
            viewerVotes={round.viewerVotesB}
            totalViewerVotes={totalViewerVotes}
            isMyVote={myVote === "B"}
          />
        </div>
      )}

      {isDone && votesA === votesB && totalVotes > 0 && (
        <div className="tie-label">Tie</div>
      )}
    </div>
  );
}

// ── Game Over ────────────────────────────────────────────────────────────────

function GameOver({
  scores,
  viewerScores,
  modelBalances,
  eliminatedModels,
  viewerBalance,
}: {
  scores: Record<string, number>;
  viewerScores: Record<string, number>;
  modelBalances: Record<string, number>;
  eliminatedModels: string[];
  viewerBalance: number;
}) {
  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const champion = sorted[0];
  const runnerUp = sorted[1];
  const viewerFavorite = Object.entries(viewerScores).sort((a, b) => b[1] - a[1])[0];

  return (
    <div className="game-over">
      <div className="game-over__label">Game Over</div>

      {champion && champion[1] > 0 && (
        <div className="game-over__winner">
          <span className="game-over__crown">👑</span>
          <span
            className="game-over__name"
            style={{ color: getColor(champion[0]) }}
          >
            {getLogo(champion[0]) && <img src={getLogo(champion[0])!} alt="" />}
            {champion[0]}
          </span>
          <span className="game-over__sub">is the funniest AI</span>
        </div>
      )}

      {runnerUp && runnerUp[1] > 0 && (
        <div className="game-over__runner-up">
          <span className="game-over__runner-up-label">Runner-up</span>
          <span style={{ color: getColor(runnerUp[0]) }}>
            {getLogo(runnerUp[0]) && <img src={getLogo(runnerUp[0])!} alt="" className="game-over__inline-logo" />}
            {runnerUp[0]}
          </span>
          <span className="game-over__runner-up-score">{runnerUp[1]} wins</span>
        </div>
      )}

      <div className="game-over__standings">
        <div className="game-over__section-label">Final Standings</div>
        <div className="game-over__table">
          {sorted.map(([name, score], i) => {
            const balance = modelBalances[name];
            const eliminated = eliminatedModels.includes(name);
            return (
              <div key={name} className={`game-over__row ${eliminated ? "game-over__row--eliminated" : ""}`}>
                <span className="game-over__row-rank">
                  {i === 0 && score > 0 ? "👑" : `#${i + 1}`}
                </span>
                <span className="game-over__row-name" style={{ color: getColor(name) }}>
                  {getLogo(name) && <img src={getLogo(name)!} alt="" className="game-over__inline-logo" />}
                  {name}
                </span>
                <span className="game-over__row-score">{score} wins</span>
                {balance !== undefined && (
                  <span className={`game-over__row-balance ${eliminated ? "game-over__row-balance--zero" : ""}`}>
                    ${balance}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="game-over__viewer-summary">
        <div className="game-over__section-label">Viewer Stats</div>
        <div className="game-over__viewer-balance">
          Final balance: <strong>${viewerBalance}</strong>
        </div>
        {viewerFavorite && viewerFavorite[1] > 0 && (
          <div className="game-over__viewer-fav">
            Viewer favorite:{" "}
            <span style={{ color: getColor(viewerFavorite[0]) }}>{viewerFavorite[0]}</span>
            {" "}({viewerFavorite[1]} wins)
          </div>
        )}
      </div>

      {eliminatedModels.length > 0 && (
        <div className="game-over__eliminations">
          <div className="game-over__section-label">Elimination Order</div>
          <div className="game-over__elim-list">
            {eliminatedModels.map((name, i) => (
              <span key={name} className="game-over__elim-chip">
                <span className="game-over__elim-num">{i + 1}.</span>
                <span style={{ color: getColor(name) }}>{name}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      <a href="/history" className="game-over__history-link">View Full History</a>
    </div>
  );
}

// ── Standings ────────────────────────────────────────────────────────────────

function LeaderboardSection({
  label,
  scores,
  competing,
  modelBalances,
  eliminatedModels,
}: {
  label: string;
  scores: Record<string, number>;
  competing: Set<string>;
  modelBalances?: Record<string, number>;
  eliminatedModels?: string[];
}) {
  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const maxScore = sorted[0]?.[1] || 1;
  const eliminated = new Set(eliminatedModels ?? []);

  return (
    <div className="lb-section">
      <div className="lb-section__head">
        <span className="lb-section__label">{label}</span>
      </div>
      <div className="lb-section__list">
        {sorted.map(([name, score], i) => {
          const pct = maxScore > 0 ? Math.round((score / maxScore) * 100) : 0;
          const color = getColor(name);
          const active = competing.has(name);
          const isEliminated = eliminated.has(name);
          const balance = modelBalances?.[name];
          return (
            <div
              key={name}
              className={`lb-entry ${active ? "lb-entry--active" : ""} ${isEliminated ? "lb-entry--eliminated" : ""}`}
            >
              <div className="lb-entry__top">
                <span className="lb-entry__rank">
                  {i === 0 && score > 0 ? "👑" : i + 1}
                </span>
                <ModelTag model={{ id: name, name }} small />
                {isEliminated && <span className="eliminated-badge">ELIMINATED</span>}
                <span className="lb-entry__score">{score}</span>
              </div>
              {balance !== undefined && (
                <div className="lb-entry__balance">${balance}</div>
              )}
              <div className="lb-entry__bar">
                <div
                  className="lb-entry__fill"
                  style={{ width: `${pct}%`, background: color }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Standings({
  scores,
  viewerScores,
  activeRound,
  modelBalances,
  eliminatedModels,
  viewerBalance,
}: {
  scores: Record<string, number>;
  viewerScores: Record<string, number>;
  activeRound: RoundState | null;
  modelBalances: Record<string, number>;
  eliminatedModels: string[];
  viewerBalance: number;
}) {
  const competing = activeRound
    ? new Set([
        activeRound.contestants[0].name,
        activeRound.contestants[1].name,
      ])
    : new Set<string>();

  return (
    <aside className="standings">
      <div className="standings__head">
        <span className="standings__title">Standings</span>
        <div className="standings__links">
          <a href="/history" className="standings__link">
            History
          </a>
          {/* <a href="https://twitch.tv/quipslop" target="_blank" rel="noopener noreferrer" className="standings__link">
            Twitch
          </a> */}
          <a href="https://github.com/buddhsen-tripathi/genz-quipslop" target="_blank" rel="noopener noreferrer" className="standings__link">
            GitHub
          </a>
        </div>
      </div>
      <LeaderboardSection
        label="AI Judges"
        scores={scores}
        competing={competing}
        modelBalances={modelBalances}
        eliminatedModels={eliminatedModels}
      />
      <div className="viewer-balance">
        <span className="viewer-balance__label">Viewers</span>
        <span className="viewer-balance__amount">${viewerBalance}</span>
      </div>
      <LeaderboardSection
        label="Viewer Picks"
        scores={viewerScores}
        competing={competing}
      />
    </aside>
  );
}

// ── Connecting ───────────────────────────────────────────────────────────────

function ConnectingScreen() {
  return (
    <div className="connecting">
      <div className="connecting__logo">
        <img src="/assets/logo.svg" alt="quipslop" />
      </div>
      <div className="connecting__sub">
        Connecting
        <Dots />
      </div>
    </div>
  );
}

// ── App ──────────────────────────────────────────────────────────────────────

function App() {
  const [state, setState] = useState<GameState | null>(null);
  const [totalRounds, setTotalRounds] = useState<number | null>(null);
  const [viewerCount, setViewerCount] = useState(0);
  const [connected, setConnected] = useState(false);
  const [viewerVotingSecondsLeft, setViewerVotingSecondsLeft] = useState(0);
  const [votingPhaseSecondsLeft, setVotingPhaseSecondsLeft] = useState(0);
  const [myVote, setMyVote] = useState<"A" | "B" | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  // Countdown timer for viewer voting
  useEffect(() => {
    const endsAt = state?.active?.viewerVotingEndsAt;
    const phase = state?.active?.phase;
    if (!endsAt || (phase !== "betting" && phase !== "answering" && phase !== "voting")) {
      setViewerVotingSecondsLeft(0);
      setMyVote(null);
      return;
    }

    function tick() {
      const remaining = Math.max(0, Math.ceil((endsAt! - Date.now()) / 1000));
      setViewerVotingSecondsLeft(remaining);
    }
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [state?.active?.viewerVotingEndsAt, state?.active?.phase]);

  // Countdown for voting phase display (30s from when voting starts)
  useEffect(() => {
    const endsAt = state?.active?.votingPhaseEndsAt;
    if (!endsAt || state?.active?.phase !== "voting") {
      setVotingPhaseSecondsLeft(0);
      return;
    }
    function tick() {
      setVotingPhaseSecondsLeft(Math.max(0, Math.ceil((endsAt! - Date.now()) / 1000)));
    }
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [state?.active?.votingPhaseEndsAt, state?.active?.phase]);

  useEffect(() => {
    const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${wsProtocol}//${window.location.host}/ws`;
    let ws: WebSocket;
    let reconnectTimer: ReturnType<typeof setTimeout>;

    let knownVersion: string | null = null;
    function connect() {
      ws = new WebSocket(wsUrl);
      wsRef.current = ws;
      ws.onopen = () => setConnected(true);
      ws.onclose = () => {
        setConnected(false);
        reconnectTimer = setTimeout(connect, 2000);
      };
      ws.onmessage = (e) => {
        const msg: ServerMessage = JSON.parse(e.data);
        if (msg.type === "state") {
          if (msg.version) {
            if (!knownVersion) knownVersion = msg.version;
            else if (knownVersion !== msg.version) return location.reload();
          }
          setState(msg.data);
          setTotalRounds(msg.totalRounds);
          setViewerCount(msg.viewerCount);
        } else if (msg.type === "viewerCount") {
          setViewerCount(msg.viewerCount);
        } else if (msg.type === "vote_ack") {
          setMyVote(msg.side);
        }
      };
    }

    connect();
    return () => {
      clearTimeout(reconnectTimer);
      ws?.close();
    };
  }, []);

  function sendVote(side: "A" | "B") {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "vote", side }));
    }
  }

  if (!connected || !state) return <ConnectingScreen />;

  const isNextPrompting =
    state.active?.phase === "prompting" && !state.active.prompt;
  const displayRound =
    isNextPrompting && state.lastCompleted ? state.lastCompleted : state.active;

  return (
    <div className="app">
      <div className="layout">
        <main className="main">
          <header className="header">
            <a href="/" className="logo">
              <img src="/assets/logo.svg" alt="quipslop" />
            </a>
            <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
              {state.isPaused && (
                <div
                  className="viewer-pill"
                  style={{ color: "var(--text-muted)", borderColor: "var(--border)" }}
                >
                  Paused
                </div>
              )}
              <div className="viewer-pill" aria-live="polite">
                <span className="viewer-pill__dot" />
                {viewerCount} viewer{viewerCount === 1 ? "" : "s"} watching
              </div>
            </div>
          </header>

          {state.done ? (
            <GameOver
              scores={state.scores}
              viewerScores={state.viewerScores ?? {}}
              modelBalances={state.modelBalances ?? {}}
              eliminatedModels={state.eliminatedModels ?? []}
              viewerBalance={state.viewerBalance ?? 1000}
            />
          ) : displayRound ? (
            <Arena
              round={displayRound}
              total={totalRounds}
              viewerVotingSecondsLeft={viewerVotingSecondsLeft}
              votingPhaseSecondsLeft={votingPhaseSecondsLeft}
              myVote={myVote}
              onVote={sendVote}
            />
          ) : (
            <div className="waiting">
              Starting
              <Dots />
            </div>
          )}

          {isNextPrompting && state.lastCompleted && (
            <div className="next-toast">
              <ModelTag model={state.active!.prompter} small /> is writing the
              next prompt
              <Dots />
            </div>
          )}
        </main>

        <Standings
          scores={state.scores}
          viewerScores={state.viewerScores ?? {}}
          activeRound={state.active}
          modelBalances={state.modelBalances ?? {}}
          eliminatedModels={state.eliminatedModels ?? []}
          viewerBalance={state.viewerBalance ?? 1000}
        />
      </div>
    </div>
  );
}

// ── Mount ────────────────────────────────────────────────────────────────────

const root = createRoot(document.getElementById("root")!);
root.render(<App />);
