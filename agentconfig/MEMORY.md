# MEMORY.md

## Per-User Style Adaptation Memory

Diary Companion uses a **per-user style memory** to learn which comment style each user prefers over time. The agent itself remains stateless — it receives an explicit style name per request. The adaptation algorithm runs on the frontend and persists state in Supabase.

### Isolation Constraint

Each user has an **independent** memory record keyed by `user_id`. A feedback signal from one user MUST NEVER influence another user's style weights.

---

## Style Memory Schema (per user)

```json
{
  "user_id": "<unique_user_id>",
  "style_preference": "Auto" | "Poetic" | "Passionate" | "Neutral",
  "Q_scores": { "Poetic": 0.0, "Passionate": 0.0, "Neutral": 0.0 },
  "w_weights": { "Poetic": 0.333, "Passionate": 0.333, "Neutral": 0.334 },
  "cooldown_counter": 0,
  "last_used_style": null,
  "consecutive_unused": { "Poetic": 0, "Passionate": 0, "Neutral": 0 },
  "feedback_log": []
}
```

---

## Adaptation Algorithm

### Step 1 — Per-Style Score via EMA (Exponential Moving Average)

For the active style `s_t`, update its score Q:

    Q(s_t) <- alpha * r_t + (1 - alpha) * Q(s_t)

For all inactive styles `s != s_t`:

    Q(s) <- (1 - alpha) * Q(s)    # passive decay

Hyperparameter: **alpha = 0.25** (learning rate; range 0.1-0.4 recommended)

Initialization: Q(s) = 0 for all s

Feedback signal `r_t`:
- Good  -> r_t = +1
- So-so -> r_t = 0
- Bad   -> r_t = -1

### Step 2 — Convert Scores to Style Weights via Softmax

    w(s) = exp(beta * Q(s)) / SUM_s'( exp(beta * Q(s')) )

Hyperparameter: **beta = 2.0** (temperature; higher = sharper preference shifts)

### Step 3 — Style Selection

- **Explicit preference** (Poetic / Passionate / Neutral): always use that style. Still update Q(s) for future reference.
- **Auto mode**: sample from the distribution {w(Poetic), w(Passionate), w(Neutral)}.

### Step 4 — Cooldown After Negative Feedback

If `r_t = -1` (Bad): set `cooldown_counter = 2`.

While `cooldown_counter > 0`:
- Do not resample style; hold the current style.
- Decrement counter by 1 after each new entry.
- Resume sampling once counter reaches 0.

### Step 5 — Style Exploration Bonus (Anti-Stagnation)

If a style has not been used for N >= 5 consecutive entries:

    Q(s) <- Q(s) + epsilon,  epsilon = 0.1

This prevents permanent convergence to a single style.

### Feedback Log

- Append each feedback event: `{style, feedback, timestamp}`
- Trim to the **last 50 entries** to prevent unbounded growth.

---

## In-Session Temporary Memory

Within a single session (multi-turn chat), the agent retains:

| Content | Duration | Purpose |
|---------|----------|---------|
| Current diary entry | Single response cycle | Generate the emotional comment |
| Previous emotional comment | Within session | Reference for follow-up questions |
| User style adjustments in-session | Within session | Adjust tone if user asks |

---

## Future Extensions (Roadmap)

### User Profile Memory
- Store names, places, recurring phrases for personalized touches.

### Emotional History Memory
- Track emotional arc across last N entries for sustained-presence responses.

### Memory Management Principles
- Users may clear all memory at any time.
- Memory data is never used for commercial purposes.
- Memory content is transparent to the user.