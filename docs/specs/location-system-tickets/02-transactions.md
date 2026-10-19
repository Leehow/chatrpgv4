# EL-02: Integrate atomic location creation, travel and local position

Status: approved, awaiting implementation.

Stage typed place effects in the existing apply transaction. Reuse canonical movement receipts, travel timing and arrival consumers. Persist feature state.

Acceptance: Create-and-enter is atomic; failure rolls back all domains; replay creates no duplicate IDs. Containment is not a free road; local movement and reads differ; a known barrier produces a concrete cause.

Contract: docs/kernel-rpc.md section 242. Ledger: docs/specs/location-system-tickets/README.md.

Scope: versioned Enhanced Locations Mod with necessary TS kernel and host support. No Python, new transaction protocol, generic world patch, template bank, unrelated cleanup, push or deployment. Preserve evidence.

Parent: https://github.com/Leehow/chatrpgv4/issues/115
