// Node v22.19 `node --test test/` loads the directory as a single entry
// (CJS resolve → index.js). Import every suite so that command runs the
// same files as `node --test test/*.test.mjs`.
import "./agent-dir.test.mjs";
import "./character-setup-briefing.test.mjs";
import "./handout-projections.test.mjs";
import "./model-editor.test.mjs";
import "./model-thinking.test.mjs";
import "./ocr-secrets.test.mjs";
import "./pdf-from-path.test.mjs";
import "./pi-coc-rpc.test.mjs";
import "./pi-session-text.test.mjs";
import "./projections.test.mjs";
import "./roll-layout-firearms.test.mjs";
import "./roll-layout.test.mjs";
import "./session-handoff.test.mjs";
import "./static-files.test.mjs";
import "./turn-flow.test.mjs";
import "./turn-settle.test.mjs";
