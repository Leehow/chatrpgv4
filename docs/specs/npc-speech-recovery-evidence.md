# NPC speech recovery — integration evidence

## Outcome first

**Scoped implementation and regressions are complete. Live outcome is mixed, and literary quality is not accepted.** This report records only what the supplied evidence establishes; it is not a release, App, speed, stable-quality, perfection, or complete-ending claim.

Current package versions are NarrationCraft **2.1.18**, Chinese optimization **1.3.9**, voice-review **2**, and roles **2a.4**. The pre-main-merge full regression at source **f9244b7557d9e68c25953dee6a4a497872045a76** passed **4390/4390**. The post-merge focused run covered **35** cases; it is focused evidence, not an exact-current full-suite result. Kernel typecheck passed. Earlier focused/build counts in the evidence are retained but are not a current full result.

This establishes implementation/source-regression status, not dialogue quality. Generated prose is provider-bound output; published cards are reviewed artifacts; observed words are only what appeared in live tables. Existing provider telemetry or request traces is not server acknowledgement. No App acceptance, deployment acceptance, or final exact post-main-merge full live test was observed.

## Verified live records

```json
[
  {
    "run": "npc-speech-recovery-live-20261003",
    "campaign": "npc-speech-recovery-20261003",
    "versions": {
      "narration-craft": "2.1.17",
      "zh-optimize": "1.3.8"
    },
    "turns": 6,
    "status": "active",
    "successful_item_receipts": [
      {
        "turn": 2,
        "items": [
          {
            "id": "item:corbitt-house-key-t2-c1",
            "kind": "item",
            "call_id": "t2-c1",
            "name": "Corbitt House key",
            "label": "Corbitt House key",
            "subject": "thomas-hayes",
            "subject_label": "托马斯·海斯",
            "from": "Steven Knott",
            "weapon": null,
            "quantity": 1,
            "before": 0,
            "after": 1,
            "why": null,
            "at": "2026-10-03T17:11:47Z"
          }
        ]
      },
      {
        "turn": 5,
        "items": [
          {
            "id": "item:t5-c3",
            "kind": "item",
            "name": "科比特住宅钥匙",
            "label": "科比特住宅钥匙",
            "subject": "steven-knott",
            "subject_label": "Steven Knott",
            "quantity": 1,
            "instance": "object-item-1",
            "from": "托马斯·海斯",
            "weapon": null,
            "call_id": "t5-c3",
            "why": "托马斯·海斯结束委托，把科比特住宅钥匙放回诺特桌上。",
            "state": {
              "ammo": null,
              "charges": null,
              "condition": "intact"
            },
            "handover": "given"
          }
        ]
      }
    ],
    "tool_failures": [
      {
        "turn": 1,
        "tool": "apply",
        "message": "needs: The action review has not answered within its 13 s cap; it is still running, so this action is not settled yet\nretryable: false\nnext: change_input\nfix: Nothing of this batch has happened yet: do not narrate its effects. Resend this identical call once, unchanged, as your next tool call: the host keeps this review and answers the resend with its verdict, waiting at most 13 s more. A reworded call is a new review, not the resend. details.typed is the typed reviewer's early reading, not a verdict. If the resend is refused, close the turn with narrate taking up what the player actually said; whatever this turn already settled with a receipt did happen and is narrated as usual.\ntyped: {\"verdict\":\"not_player_action\",\"confidence\":0.7676,\"line_verdicts\":[\"not_player_action\"],\"grounds\":\"Decided by the player's words this turn: \\\"您找我是有什么事？\\\"; typed review judged line 1 not_player_action (apply clue: clue=\\\"knott-commission\\\"; how=\\\"诺特在你询问来意后再次说明这桩委托。\\\"; from=\\\"Steven Knott\\\")\"}"
      },
      {
        "turn": 6,
        "tool": "apply",
        "message": "needs: settle the chapter's rewards and investigator development before ending the campaign\nretryable: false\nnext: change_input\nfix: read the source conclusion/rewards with lookup kind=secret scope=module, whose endings say what this book awards and what it asks for first; resolve development:end-session with the source-authored scenario_san_reward_expr when the source declares one, and without it when the source declares none -- an omitted reward settles the ending with no scenario award, a figure you chose does not exist; or development:settle-ending if a settlement is pending; then retry apply ending"
      },
      {
        "turn": 6,
        "tool": "apply",
        "message": "needs: settle the chapter's rewards and investigator development before ending the campaign\nretryable: false\nnext: change_input\nfix: read the source conclusion/rewards with lookup kind=secret scope=module, whose endings say what this book awards and what it asks for first; resolve development:end-session with the source-authored scenario_san_reward_expr when the source declares one, and without it when the source declares none -- an omitted reward settles the ending with no scenario award, a figure you chose does not exist; or development:settle-ending if a settlement is pending; then retry apply ending"
      },
      {
        "turn": 6,
        "tool": "apply",
        "message": "The kernel has refused these parameters 2 times (needs: settle the chapter's rewards and investigator development before ending the campaign). Resending them unchanged will not give a different answer: change the parameters as the fix says, or take another approach."
      },
      {
        "turn": 6,
        "tool": "apply",
        "message": "The kernel has refused these parameters 2 times (needs: settle the chapter's rewards and investigator development before ending the campaign). Resending them unchanged will not give a different answer: change the parameters as the fix says, or take another approach."
      },
      {
        "turn": 6,
        "tool": "apply",
        "message": "The kernel has refused these parameters 2 times (needs: settle the chapter's rewards and investigator development before ending the campaign). Resending them unchanged will not give a different answer: change the parameters as the fix says, or take another approach."
      },
      {
        "turn": 6,
        "tool": "apply",
        "message": "The kernel has refused these parameters 2 times (needs: settle the chapter's rewards and investigator development before ending the campaign). Resending them unchanged will not give a different answer: change the parameters as the fix says, or take another approach."
      }
    ]
  },
  {
    "run": "npc-speech-recovery-v218-live-20261003",
    "campaign": "npc-speech-recovery-v218-20261003",
    "versions": {
      "narration-craft": "2.1.18",
      "zh-optimize": "1.3.9"
    },
    "turns": 6,
    "status": "active",
    "successful_item_receipts": [
      {
        "turn": 3,
        "items": [
          {
            "id": "item:corbitt-house-key-t3-c1",
            "kind": "item",
            "call_id": "t3-c1",
            "name": "Corbitt House key",
            "label": "Corbitt House key",
            "subject": "thomas-hayes",
            "subject_label": "托马斯·海斯",
            "from": "Steven Knott",
            "weapon": null,
            "quantity": 1,
            "before": 0,
            "after": 1,
            "why": null,
            "at": "2026-10-03T18:05:34Z"
          }
        ]
      }
    ],
    "tool_failures": [
      {
        "turn": 3,
        "tool": "apply",
        "message": "invalid_params: 'arty-wilmot' is a handle, not what the table calls anyone\nretryable: false\nnext: change_input\nfix: name is the word the prose calls them, in the play language: for someone untold, an epithet built from the one visible thing only they have here"
      },
      {
        "turn": 6,
        "tool": "apply",
        "message": "needs: The action review has not answered within its 13 s cap; it is still running, so this action is not settled yet\nretryable: false\nnext: change_input\nfix: Nothing of this batch has happened yet: do not narrate its effects. Resend this identical call once, unchanged, as your next tool call: the host keeps this review and answers the resend with its verdict, waiting at most 13 s more. A reworded call is a new review, not the resend. details.typed is the typed reviewer's early reading, not a verdict. If the resend is refused, close the turn with narrate taking up what the player actually said; whatever this turn already settled with a receipt did happen and is narrated as usual.\ntyped: {\"verdict\":\"authorized\",\"confidence\":0.86,\"line_verdicts\":[\"authorized\"],\"grounds\":\"Decided by the player's words this turn: \\\"随后回到诺特办公室，把钥匙放回桌上。\\\"; typed review judged line 2 authorized (apply object: name=\\\"Corbitt House key\\\"; from=\\\"托马斯·海斯\\\"; to=\\\"信封旁的敲指者\\\"; handover=\\\"given\\\"; why=\\\"托马斯·海斯结束)\"}"
      },
      {
        "turn": 6,
        "tool": "apply",
        "message": "needs: The proposed arguments do not represent the action the player already chose\nretryable: false\nnext: change_input\nfix: Nothing of this batch has happened. Preserve the player's declared act; do not ask them to choose it again. Correct the proposed arguments once to represent that same act, without adding a target, method, cost or commitment. The corrected batch must pass fresh admission. Do not resend the unchanged rejected proposal."
      }
    ]
  }
]
```

Preserve unresolved evidence: unsupported past/negative claims about whether the NPC entered the house; procedural repetition; mask agenda and missing exchange arrows; ending blockers; and the uninvestigated `You` prefix. Ruth’s source-based mask remains quiet, practical, helpful, and cautious, but fresh examples omit stranger-arrow contexts. Knott’s mask remains shorter, offer/deadline-oriented, and agenda-bearing. The three older cards were diagnostic uncertain evidence, not quality proof.

## Authority and gates

Source correctness is distinct from generated prose, publication, provider binding, and observed words. Host admission and receipts remain authoritative. A generated proposal is not a receipt; a source price, offer, rationale, or NPC demand is not player consent. A published card is not proof that later words were good. Tool-Pi authors prose, Jev makes bounded card judgments, and uncertain/incomplete review falls back to the configured Luna path; none creates server acknowledgement. Existing provider telemetry records delivery plumbing only.

Structural and source-regression gates are complete at the versions and source stated above. The quality gate is not accepted: the tables show a successful key return alongside unreliable correction/ending behavior, repetition, bookishness, and factual uncertainty. The ending gate is not complete: both drivers stopped safely, but one retained repeated reward/development refusals and the other lacked an ending effect. No new runtime/state feature is proposed.

## Integration slot

**FINAL_INTEGRATION_RESULT: PENDING_FINAL_INTEGRATION**

The host fills this finite slot exactly once after integration. The active plan links this report; remaining work is recorded as findings and validation limits, not approved new features.
