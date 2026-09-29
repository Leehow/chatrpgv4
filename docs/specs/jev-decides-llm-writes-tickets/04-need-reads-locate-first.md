Status: ready-for-agent
Spec: docs/specs/jev-decides-llm-writes.md D-B B5 · Contract §150.4
Load the `typesafe-jev` skill first.

# 04 — Need reads locate first

Measured waste (Blood05): need-driven detail reads outnumbered fragments 8:5, re-located identical page sets, ran twice for one person under different wording, and spent full author+review on speculative deferred questions.

Scope: `source-need-answered` v1 before any reader; unlocated retention when located pages add nothing new; carrying a need on unread source units; deferred needs after frontier units; disposition recorded (`answered | unlocated | carried | read`); inventory entry.

Tests (kernel module tests + source driver with a fake adapter): an answered need resolves with no reader job; a need whose leads are only already-read pages retains `unlocated` and queues nothing, then becomes eligible after a new unit publishes; a need located inside an unread unit rides on that unit's task; a need with new located pages reads as today; a Jev outage reads as today.

## Comments
