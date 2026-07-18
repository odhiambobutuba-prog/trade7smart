# Trade7Smart Pro

A responsive, browser-only dashboard for inspecting recent digit samples, recording rule matches, and configuring manual review workflows.

## Start

Open `index.html` in a modern browser. No installation or account connection is required.

## Included

- Responsive desktop and mobile layouts
- Demo market tick stream for offline review, plus optional Deriv WebSocket login
- Last-digit frequency, parity, and recent-tick summaries
- Local one-minute timing helper with a 57-second review marker
- Multi-market pattern scanner interface with configurable patterns
- Two configurable recovery workflow cards
- Local session-only event log
- Manual Deriv proposal, buy, and open-contract status controls

## Important

The project deliberately provides historical statistics and user-configured alerts only. It does not predict market outcomes or guarantee profits. Live orders are always manual: a connected user must request a proposal and press `Buy contract` to submit it. API tokens are kept only in browser memory for the current page session.
