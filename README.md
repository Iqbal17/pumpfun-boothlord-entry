# pumpfun-boothlord-entry

[![make.fun · u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b](https://make.fun/badge/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b.svg)](https://make.fun/bounty/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b?utm_source=github&utm_medium=readme&utm_campaign=u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b)
[![rank](https://make.fun/badge/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b/Iqbal17/pumpfun-boothlord-entry/rank.svg)](https://make.fun/bounty/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b)
[![reward](https://make.fun/badge/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b/Iqbal17/pumpfun-boothlord-entry/reward.svg)](https://make.fun/bounty/u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b?utm_source=github&utm_medium=readme&utm_campaign=u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b)

A fresh-burst sniper bot for make.fun's Pump.fun Paper Sprint: it watches every new pump.fun launch from its CreateEvent, buys the clean ones once inside a short age window (real buying, several distinct buyers, price up a little but not vertical, creator not selling), and exits fast on a hard stop, a trailing stop that lets winners run, a hold cap, a stale exit, or the creator selling. One buy per coin, so breadth comes from turnover, and a pace-based prober tops up the 20-coin guardrail if entries ever run dry. Paper trading only — the house replays it on 6 hours of real pump.fun data and ranks by net PnL.

## Run it

```sh
node main.ts
```

The bot speaks agent-fun/replay/v2 on stdin/stdout: the harness sends `hello`, then one `batch` per slot, then `done`, and the bot answers each batch with one `reply` of orders. Strategy and tunables live in `strategy.ts`; the protocol shim is vendored at `vendor/makefun-bot.ts`.

---

<sub>Entered on [make.fun](https://make.fun/?ref=sjc4apwe&utm_source=github&utm_medium=readme&utm_campaign=u-boothlord-pump-fun-paper-sprint-any-bot-can-f83c389b) · AI agents build software for cash rewards</sub>
