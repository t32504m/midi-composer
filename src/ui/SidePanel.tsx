// ⑧作曲補助パネルと⑨情報・説明パネル。04_DESIGN.md §3.7。
// 補助機能は「挿入するときだけ」作用する。プレビューや試聴では曲データを変えない（INV-02）。
import { useState } from "preact/hooks";
import { PITCH_CLASS_NAMES, pitchLabel, pitchName } from "../model/pitch";
import { lengthLabel, positionLabel, rangeLabel } from "../model/time";
import { findTrack, setVelocity } from "../model/edit";
import { drumName, instrumentName } from "../model/instruments";
import {
  CHORD_TYPES,
  ChordType,
  PATTERNS,
  PROGRESSIONS,
  PatternKind,
  chordDef,
  chordName,
  diatonicChords,
  diatonicDegree,
  functionHint,
  functionTag,
  intervalName,
  inversionLabel,
  keyLabel,
  maxInversion,
  modeLabel,
  progressionChords,
  scalePitchClasses,
  voiceChord,
} from "../theory/theory";
import { AppState, getState, setState } from "./store";
import { FunctionGroups } from "./ChordChips";
import { BlockInfo } from "./ChordLane";
import { Splitter } from "./layout";
import { saveSideOpen } from "./layoutPrefs";
import {
  activeTrack,
  assistPlan,
  auditionPlan,
  commit,
  copyAction,
  currentProgression,
  duplicateAction,
  insertPlan,
  previewPitches,
  rangeDuplicateOverlaps,
  setAssist,
  stopPlayback,
  updateSettings,
} from "./actions";

function setSideOpen(open: boolean) {
  setAssist({ open });
  saveSideOpen(open);
}

export function SidePanel({ s }: { s: AppState }) {
  if (!s.assist.open) {
    // 最小化: 細い帯だけを残す。クリックで元の幅に戻す
    return (
      <aside class="side minimized" onClick={() => setSideOpen(true)} title="作曲補助パネルを開く">
        <button class="side-open">◀</button>
        <span class="side-vlabel">作曲補助・情報</span>
      </aside>
    );
  }
  const tabs: { key: AppState["assist"]["tab"]; label: string }[] = [
    { key: "scale", label: "スケール" },
    { key: "chord", label: "コード" },
    { key: "prog", label: "進行と弾き方" },
  ];
  return (
    <aside class="side" style={{ width: `${s.layout.sideW}px` }}>
      <Splitter dir="x" target="sideW" invert title="ドラッグで幅を変える（ダブルクリックで元の幅）" />
      <div class="side-tabs">
        {tabs.map((t) => (
          <button key={t.key} class={s.assist.tab === t.key ? "on" : ""} onClick={() => setAssist({ tab: t.key })}>
            {t.label}
          </button>
        ))}
        <button class="close" onClick={() => setSideOpen(false)} title="パネルを最小化する（右端の帯をクリックで戻す）">
          ▶
        </button>
      </div>
      <div class="side-body">
        {s.assist.tab === "scale" && <ScaleTab s={s} />}
        {s.assist.tab === "chord" && <ChordTab s={s} />}
        {s.assist.tab === "prog" && <ProgTab s={s} />}
      </div>
      <Splitter dir="y" target="infoH" invert title="ドラッグで「情報」の高さを変える（ダブルクリックで元の高さ）" />
      <InfoPanel s={s} />
    </aside>
  );
}

function Details({ summary, children }: { summary: string; children: preact.ComponentChildren }) {
  return (
    <details class="more">
      <summary>{summary}</summary>
      <div class="more-body">{children}</div>
    </details>
  );
}

function KeySelect({ s }: { s: AppState }) {
  const key = s.settings.key;
  return (
    <div class="row">
      <label>
        主音
        <select
          value={key.tonic}
          onChange={(e) => {
            if (getState().playing === "audition") stopPlayback();
            updateSettings({ key: { ...key, tonic: Number((e.currentTarget as HTMLSelectElement).value) } });
          }}
        >
          {PITCH_CLASS_NAMES.map((n, i) => (
            <option key={n} value={i}>
              {n}
            </option>
          ))}
        </select>
      </label>
      <label>
        種類
        <select
          value={key.mode}
          onChange={(e) => {
            if (getState().playing === "audition") stopPlayback();
            updateSettings({ key: { ...key, mode: (e.currentTarget as HTMLSelectElement).value as "major" | "minor" } });
          }}
        >
          <option value="major">{modeLabel("major")}</option>
          <option value="minor">{modeLabel("minor")}</option>
        </select>
      </label>
    </div>
  );
}

function ScaleTab({ s }: { s: AppState }) {
  const key = s.settings.key;
  const pcs = scalePitchClasses(key);
  return (
    <div class="tab">
      <KeySelect s={s} />
      <label class="check">
        <input type="checkbox" checked={s.settings.showScale} onChange={(e) => updateSettings({ showScale: (e.currentTarget as HTMLInputElement).checked })} />
        目安を表示する
      </label>
      <p class="note-only">表示のみ。音符は変わりません。スケール外の音も自由に置けます。</p>
      <p>
        <b>{keyLabel(key)}</b> の音: {pcs.map((p) => PITCH_CLASS_NAMES[p]).join("・")}
      </p>
      <p class="small">
        ピアノロールの背景で、<span class="swatch sw-scale">水色</span>がスケールの音、<span class="swatch sw-tonic">オレンジ</span>が主音（その調の中心の音）、
        <span class="swatch sw-out">灰色</span>がスケール外の音です。鍵盤の点と「主」の文字でも示します。
      </p>
      <label class="check">
        <input
          type="checkbox"
          checked={s.settings.scaleLock}
          onChange={(e) => {
            const on = (e.currentTarget as HTMLInputElement).checked;
            updateSettings({ scaleLock: on, showScale: on ? true : s.settings.showScale });
          }}
        />
        スケール音のみモード
      </label>
      <p class="small">オンにすると、新しく置く音と上下に動かす音をスケールの音に限ります（灰色の行には置けません）。すでに置いてある音符は変わりません。いつでもオフにできます。</p>
      <Details summary="詳しく: スケールとは">
        <p>スケール（音階）は、曲で使う音の「材料」の目安です。スケール外の音も、経過音や飾りとしてよく使われます。間違いではありません。</p>
        <p>メジャー（長調）は明るく、ナチュラルマイナー（短調）は暗めに聞こえることが多いですが、印象は使い方で変わります。</p>
        <p>短調の曲では、第7音を半音上げた音（和声的短音階）もよく使われます。この音は目安の表示には含まれませんが、自由に使えます。</p>
        <p>メジャーとマイナーの切り替えは、単純に全体を移調することとは違います。主音が同じでも使う音が変わります。</p>
      </Details>
    </div>
  );
}

function CommonVoicing({ s, type }: { s: AppState; type: ChordType }) {
  const a = s.assist;
  return (
    <div class="row wrap">
      <label>
        転回形
        <select value={Math.min(a.inversion, maxInversion(type))} onChange={(e) => setAssist({ inversion: Number((e.currentTarget as HTMLSelectElement).value) })}>
          {Array.from({ length: maxInversion(type) + 1 }, (_, i) => (
            <option key={i} value={i}>
              {inversionLabel(i)}
            </option>
          ))}
        </select>
      </label>
      <label title="根音を置くオクターブ">
        音域
        <select value={a.octave} onChange={(e) => setAssist({ octave: Number((e.currentTarget as HTMLSelectElement).value) })}>
          {[1, 2, 3, 4, 5].map((o) => (
            <option key={o} value={o}>
              C{o}〜B{o}
            </option>
          ))}
        </select>
      </label>
      <label title="挿入する音符の打鍵の強さ">
        強さ
        <input
          type="number"
          min={1}
          max={127}
          value={a.velocity}
          onKeyDown={(e) => e.stopPropagation()}
          onChange={(e) => setAssist({ velocity: Math.max(1, Math.min(127, Number((e.currentTarget as HTMLInputElement).value) || 80)) })}
        />
      </label>
    </div>
  );
}

function InsertBox({ s }: { s: AppState }) {
  const track = activeTrack(s);
  const plan = assistPlan(s);
  if (!track) return null;
  if (track.kind === "drum")
    return <p class="warn">編集中のトラックがドラムのため、コードは挿入できません。旋律トラックを選んでください。</p>;
  if (!plan) return null;
  const auditioning = s.playing === "audition";
  return (
    <div class="insert-box">
      <p>
        挿入先: <b>{track.name}</b>／{rangeLabel(plan.start, plan.end, s.song.timeSig)}／{plan.notes.length}音
        {plan.overlaps > 0 && <span class="warn-inline">／同じ高さで重なる音: {plan.overlaps}</span>}
      </p>
      <p class="small">
        {s.range ? "選んだ範囲の始まりから挿入します。" : "再生位置から挿入します（範囲を選ぶとその始まりから）。"}
        挿入予定の音符はピアノロールに点線で表示しています（まだ曲には入っていません）。
      </p>
      <div class="row">
        {auditioning ? (
          <button onClick={stopPlayback}>■ 試聴を止める</button>
        ) : (
          <button onClick={() => void auditionPlan()} title="挿入予定の範囲を、プレビューの音符を加えて再生します">
            ▶ 試聴
          </button>
        )}
        <label class="check" title="既存のメロディーなどと重ねて聞きます">
          <input type="checkbox" checked={s.assist.includeOthers} onChange={(e) => setAssist({ includeOthers: (e.currentTarget as HTMLInputElement).checked })} />
          他のトラックも鳴らす
        </label>
        <button class="primary" onClick={insertPlan} disabled={plan.notes.length === 0}>
          挿入
        </button>
      </div>
      <p class="small">挿入した音符は通常の音符です。後で設定を変えても変わりません。取り消し1回で挿入した音符だけが消えます。</p>
    </div>
  );
}

function ChordTab({ s }: { s: AppState }) {
  const a = s.assist;
  const key = s.settings.key;
  const dia = diatonicChords(key);
  const chord = { root: a.chordRoot, type: a.chordType };
  const tones = voiceChord(chord, a.octave, a.inversion);
  const deg = diatonicDegree(key, chord);
  const tag = functionTag(key, chord);
  const def = chordDef(a.chordType);
  const track = activeTrack(s);
  const pick = (root: number, type: ChordType) => {
    setAssist({ chordRoot: root, chordType: type, inversion: Math.min(a.inversion, maxInversion(type)) });
    const st = getState();
    if (track && track.kind !== "drum") previewPitches(track.id, voiceChord({ root, type }, st.assist.octave, Math.min(st.assist.inversion, maxInversion(type))), st.assist.velocity, 1.0);
  };
  return (
    <div class="tab">
      <KeySelect s={s} />
      <FunctionGroups s={s} onPick={(c) => pick(c.root, c.type)} selected={{ root: a.chordRoot, type: a.chordType }} />
      <div class="row">
        <label>
          根音
          <select value={a.chordRoot} onChange={(e) => pick(Number((e.currentTarget as HTMLSelectElement).value), a.chordType)}>
            {PITCH_CLASS_NAMES.map((n, i) => (
              <option key={n} value={i}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <label>
          種類
          <select value={a.chordType} onChange={(e) => pick(a.chordRoot, (e.currentTarget as HTMLSelectElement).value as ChordType)}>
            {CHORD_TYPES.map((c) => (
              <option key={c.type} value={c.type}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <CommonVoicing s={s} type={a.chordType} />
      <div class="chord-info">
        <p>
          <b>{chordName(chord)}</b>（{def.label}）
          {inversionLabel(Math.min(a.inversion, maxInversion(a.chordType)))}
        </p>
        <p>
          構成音: {def.intervals.map((iv) => `${PITCH_CLASS_NAMES[(a.chordRoot + iv) % 12]}（${intervalName(iv)}）`).join("・")}
        </p>
        <p>
          並べた音: {tones.map(pitchName).join("・")}（最低音 {tones[0] !== undefined ? pitchName(tones[0]) : "-"}）
        </p>
        <p class="small">
          {tag && (
            <span class={`fn fn-${tag.short}`}>
              {tag.short} {tag.label}
            </span>
          )}{" "}
          {deg >= 0
            ? `${keyLabel(key)} では ${dia[deg].roman}。${functionHint(key, deg)}`
            : tag
              ? `${keyLabel(key)} では ${tag.label}として使われることが多いコードです。`
              : `${keyLabel(key)} のダイアトニックコードではありません。曲の中で使えないという意味ではありません。`}
        </p>
        <Details summary="詳しく: コードの働きと転回形">
          <p>ダイアトニックコードは「スケールの音だけでできるコード」という分類です。トニック・ドミナント・サブドミナントといった「働き」は、それとは別の説明で、キーと前後のコードによって変わります。</p>
          <p>トニックは落ち着き、ドミナントはトニックへ戻りたくなる響き、サブドミナントはその間で広がる響き、と説明されることが多いですが、必ずそう進むわけではありません。</p>
          <p>転回形は、同じ構成音のうちどの音を一番下にするかの違いです。基本形は根音が一番下、第1転回形は3度の音が一番下になります。音域・音の並べ方・リズムでも響きは変わります。</p>
          <p>コード外の音（経過音など）もメロディーではよく使われます。構成音以外が不正解というわけではありません。</p>
        </Details>
      </div>
      <InsertBox s={s} />
    </div>
  );
}

function ProgTab({ s }: { s: AppState }) {
  const a = s.assist;
  const key = s.settings.key;
  const list = PROGRESSIONS.filter((p) => p.mode === key.mode);
  const prog = currentProgression(s);
  const chords = progressionChords(prog, key);
  return (
    <div class="tab">
      <KeySelect s={s} />
      <div class="row wrap">
        <label>
          進行
          <select value={prog.id} onChange={(e) => setAssist({ progressionId: (e.currentTarget as HTMLSelectElement).value })}>
            {list.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <span class="chips">
          {chords.map((c, i) => (
            <span key={i} class="chip">
              {prog.steps[i].roman} {chordName(c)}
              {(() => {
                const t = functionTag(key, c);
                return t ? <span class={`fn fn-${t.short}`} title={t.label}>{t.short}</span> : null;
              })()}
            </span>
          ))}
        </span>
      </div>
      {prog.note && <p class="small">{prog.note}</p>}
      <div class="row wrap">
        <label>
          切り替え
          <select value={a.changeEvery} onChange={(e) => setAssist({ changeEvery: (e.currentTarget as HTMLSelectElement).value as "bar" | "halfBar" | "twoBars" })}>
            <option value="bar">1小節ごと</option>
            <option value="halfBar">半小節ごと</option>
            <option value="twoBars">2小節ごと</option>
          </select>
        </label>
        <label>
          弾き方
          <select value={a.pattern} onChange={(e) => setAssist({ pattern: (e.currentTarget as HTMLSelectElement).value as PatternKind })}>
            {PATTERNS.map((p) => (
              <option key={p.kind} value={p.kind}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <label title="伴奏の音の細かさ（コードの切り替え間隔とは別の設定）">
          細かさ
          <select value={a.step} disabled={a.pattern === "sustain"} onChange={(e) => setAssist({ step: Number((e.currentTarget as HTMLSelectElement).value) })}>
            <option value={960}>四分</option>
            <option value={480}>八分</option>
            <option value={240}>十六分</option>
          </select>
        </label>
      </div>
      <CommonVoicing s={s} type="7" />
      <InsertBox s={s} />
      <Details summary="詳しく: 進行と弾き方">
        <p>ローマ数字はキーの中での位置（度数）です。I はそのキーの主音から作るコードです。キーを変えると、同じ進行が別の高さで提示されます。</p>
        <p>弾き方は、同じコードをどんなリズムや順番で鳴らすかの違いです。「切り替え」はコードを変える間隔、「細かさ」は1つ1つの音の長さです。</p>
        <p>挿入した後は、ふつうの音符として1音ずつ自由に直せます。</p>
      </Details>
    </div>
  );
}

function InfoPanel({ s }: { s: AppState }) {
  const track = findTrack(s.song, s.activeTrackId);
  const [velDraft, setVelDraft] = useState<string | null>(null);
  const style = { height: `${s.layout.infoH}px` };
  if (!track) return <div class="info" style={style} />;
  const sel = track.notes.filter((n) => s.selection.has(n.id));
  const ts = s.song.timeSig;
  const isDrum = track.kind === "drum";
  const commitVel = () => {
    if (velDraft === null) return;
    const v = Number(velDraft);
    if (Number.isFinite(v)) commit(setVelocity(getState().song, getState().selection, v));
    setVelDraft(null);
  };
  return (
    <div class="info" style={style}>
      <div class="info-title">情報</div>
      {s.editorMode !== "chord" && <BlockInfo s={s} />}
      <p class="small">
        編集中: <b>{track.name}</b>（{isDrum ? "ドラム" : instrumentName(track.program)}）
      </p>
      {sel.length === 1 && (
        <div>
          <p>
            <b>{isDrum ? drumName(sel[0].pitch) : pitchLabel(sel[0].pitch)}</b>
          </p>
          <p>位置: {positionLabel(sel[0].start, ts)}</p>
          {!isDrum && <p>長さ: {lengthLabel(sel[0].length)}</p>}
        </div>
      )}
      {sel.length > 1 && <p>{sel.length}音を選択中</p>}
      {sel.length > 0 && (
        <label class="vel-edit" title="打鍵の強さ（音符ごと）。トラックの音量とは別です。">
          打鍵の強さ
          <input
            type="number"
            min={1}
            max={127}
            value={velDraft ?? (sel.every((n) => n.velocity === sel[0].velocity) ? String(sel[0].velocity) : "")}
            placeholder="いろいろ"
            onInput={(e) => setVelDraft((e.currentTarget as HTMLInputElement).value)}
            onBlur={commitVel}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitVel();
              e.stopPropagation();
            }}
          />
        </label>
      )}
      {isDrum && <p class="small">ドラムの音の長さは、音源のサンプルの響きで決まります。MIDI上の長さ（十六分音符で固定）とは別です。</p>}
      {s.range && (
        <div class="range-info">
          <p>
            範囲: {s.range.trackIds.map((id) => findTrack(s.song, id)?.name).join("・")}／{rangeLabel(s.range.start, s.range.end, ts)}
          </p>
          {rangeDuplicateOverlaps(s) > 0 && <p class="warn-inline">複製すると同じ高さで重なる音: {rangeDuplicateOverlaps(s)}</p>}
          <div class="row wrap">
            <button onClick={duplicateAction} title="範囲の直後に複製（Ctrl+D）">
              複製
            </button>
            <button onClick={copyAction} title="コピー（Ctrl+C）">
              コピー
            </button>
            <button
              onClick={() => {
                const r = getState().range;
                if (r) updateSettings({ loop: { start: r.start, end: r.end }, loopEnabled: true });
              }}
            >
              ループに設定
            </button>
            <button onClick={() => setState({ range: null })}>範囲を解除</button>
          </div>
          <p class="small">開始位置が範囲内の音符が対象です。斜線の音符（範囲より前から始まる音）は含まれません。</p>
        </div>
      )}
      {sel.length === 0 && !s.range && s.selectedBlockId === null && <p class="small">音符やコードブロックをクリックすると情報を表示します。</p>}
    </div>
  );
}
