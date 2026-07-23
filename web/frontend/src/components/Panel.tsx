import type { Actor, GameState } from "../types";

interface Props {
  state: GameState | null;
  investigatorId: string | null;
}

const RESOURCE_META: { key: string; label: string; cls: string; derived: string }[] = [
  { key: "hp", label: "HP 生命", cls: "bar--hp", derived: "HP" },
  { key: "san", label: "SAN 理智", cls: "bar--san", derived: "SAN" },
  { key: "mp", label: "MP 魔法", cls: "bar--mp", derived: "MP" },
  { key: "luck", label: "幸运", cls: "bar--luck", derived: "LUCK" },
];

function resourceBar(actor: Actor | null, key: string, max: number | null) {
  const current = actor?.resources?.[key];
  if (typeof current !== "number") return null;
  const cap = typeof max === "number" && max > 0 ? max : current;
  const pct = Math.max(0, Math.min(100, (current / cap) * 100));
  return { current, cap, pct };
}

export function Panel({ state, investigatorId }: Props) {
  if (!state) {
    return (
      <aside className="panel">
        <p className="panel__empty">进入战役后，这里显示角色、物品与时间。</p>
      </aside>
    );
  }
  const actor =
    state.actors?.find((a) => a.id === investigatorId) ?? state.actors?.[0] ?? null;
  const sheet = state.character ?? null;
  const derived = sheet?.derived ?? {};
  const derivedNum = (k: string): number | null => {
    const v = derived[k];
    return typeof v === "number" ? v : null;
  };
  const chars = sheet?.characteristics ?? [];
  const skills = [...(sheet?.skills ?? [])].sort(
    (a, b) => Number(b.value) - Number(a.value),
  );
  const weapons = sheet?.weapons ?? [];
  const equipment = sheet?.equipment ?? [];
  const time = state.time ?? null;
  const discoveredClues =
    state.discovered_clues ??
    (state.discovered_clue_ids ?? []).map((id) => ({
      clue_id: id,
      summary: id,
    }));

  return (
    <aside className="panel">
      <section className="panel-card panel-card--time">
        <h3>时间</h3>
        <div className="time-display">
          <div className="time-display__primary">{time?.display ?? "—"}</div>
          {time?.display_sub ? (
            <div className="time-display__sub">{time.display_sub}</div>
          ) : null}
        </div>
        <div className="panel__meta">
          {time?.location_id && <span>地点 {time.location_id}</span>}
          <span>第 {state.turn_number ?? 0} 回合</span>
          {(state.active_scene_label || state.active_scene_id) && (
            <span>场景 {state.active_scene_label || state.active_scene_id}</span>
          )}
          {state.tension_level && (
            <span className={`tension tension--${state.tension_level}`}>
              张力 {state.tension_label || state.tension_level}
            </span>
          )}
        </div>
      </section>

      <section className="panel-card">
        <h3>调查员</h3>
        <div className="pc-name">{sheet?.name ?? actor?.id ?? "—"}</div>
        <div className="panel__meta">
          {sheet?.occupation && <span>{sheet.occupation}</span>}
          {sheet?.era && <span>{sheet.era}</span>}
          {typeof sheet?.age === "number" && <span>{sheet.age} 岁</span>}
        </div>

        <div className="bars">
          {RESOURCE_META.map((meta) => {
            const bar = resourceBar(actor, meta.key, derivedNum(meta.derived));
            if (!bar) return null;
            return (
              <div key={meta.key} className="bar-row">
                <span className="bar-label">{meta.label}</span>
                <div className="bar-track">
                  <div
                    className={`bar-fill ${meta.cls}`}
                    style={{ width: `${bar.pct}%` }}
                  />
                </div>
                <span className="bar-value">
                  {bar.current}
                  {bar.cap ? `/${bar.cap}` : ""}
                </span>
              </div>
            );
          })}
        </div>

        {actor && actor.conditions.length > 0 && (
          <div className="conditions">
            {actor.conditions.map((c) => (
              <span key={c} className="condition-tag">
                {c}
              </span>
            ))}
          </div>
        )}

        {chars.length > 0 && (
          <div className="chars-grid">
            {chars.map((c) => (
              <div key={c.key} className="char-cell" title={c.key}>
                <span className="char-key">{c.label}</span>
                <span className="char-val">{c.value}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      {skills.length > 0 && (
        <section className="panel-card">
          <h3>技能</h3>
          <div className="skills-list">
            {skills.map((s) => (
              <div key={s.key} className="skill-row" title={s.key}>
                <span>{s.label}</span>
                <span className="skill-val">{s.value}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {weapons.length > 0 && (
        <section className="panel-card">
          <h3>武器</h3>
          {weapons.map((w, i) => (
            <div key={i} className="weapon-row">
              <span className="weapon-name">{w.label ?? "武器"}</span>
              <span className="panel__meta">
                {w.damage ?? ""}
                {w.skill_label ? ` · ${w.skill_label}` : ""}
                {w.ammo !== undefined && w.ammo !== null ? ` · 弹药 ${w.ammo}` : ""}
              </span>
            </div>
          ))}
        </section>
      )}

      <section className="panel-card">
        <h3>物品</h3>
        {equipment.length ? (
          <ul className="equipment-list">
            {equipment.map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ul>
        ) : (
          <p className="panel__empty">身无长物。</p>
        )}
      </section>

      <section className="panel-card panel-card--clues">
        <h3>线索</h3>
        {discoveredClues.length ? (
          <>
            <div className="panel__meta">已发现 {discoveredClues.length} 条</div>
            <ul className="clue-list">
              {discoveredClues.map((clue) => (
                <li key={clue.clue_id} title={clue.clue_id}>
                  {clue.summary}
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="panel__empty">尚未发现线索。</p>
        )}
      </section>
    </aside>
  );
}
