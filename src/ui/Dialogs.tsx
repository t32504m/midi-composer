// 確認画面など
import { findTrack } from "../model/edit";
import { beatsPerBar, tsLabel } from "../model/time";
import { AppState, setState } from "./store";
import { confirmTimeSig } from "./actions";

export function Dialogs({ s }: { s: AppState }) {
  const d = s.dialog;
  if (!d) return null;
  const close = () => setState({ dialog: null });
  if (d.kind === "message")
    return (
      <Modal title={d.title} onClose={close}>
        {d.lines.map((l, i) => (
          <p key={i}>{l}</p>
        ))}
        <div class="buttons">
          <button class="primary" onClick={close} autoFocus>
            閉じる
          </button>
        </div>
      </Modal>
    );
  if (d.kind === "confirm")
    return (
      <Modal title={d.title} onClose={close}>
        {d.lines.map((l, i) => (
          <p key={i}>{l}</p>
        ))}
        <div class="buttons">
          <button class="primary" onClick={d.onOk} autoFocus>
            {d.okLabel}
          </button>
          <button onClick={close}>やめる</button>
        </div>
      </Modal>
    );
  if (d.kind === "unsaved")
    return (
      <Modal title="保存していない変更があります" onClose={close}>
        <p>「{d.action}」の前に、今の曲を保存しますか？</p>
        <div class="buttons">
          <button class="primary" onClick={d.onSave} autoFocus>
            保存してから{d.action}
          </button>
          <button onClick={d.onDiscard}>保存せずに{d.action}</button>
          <button onClick={close}>キャンセル</button>
        </div>
      </Modal>
    );
  if (d.kind === "timesig") {
    const from = s.song.timeSig;
    const count = d.results.lastBeat.overflowIds.length;
    const byTrack = [...d.results.lastBeat.overflowByTrack].map(([id, n]) => `${findTrack(s.song, id)?.name ?? "?"} ${n}`).join("、");
    const lastBeatNo = beatsPerBar(d.to);
    const compound = d.to.denominator === 8 || from.denominator === 8;
    return (
      <Modal title={`拍子を ${tsLabel(from)} から ${tsLabel(d.to)} に変えます`} onClose={close}>
        <p>音符は小節と拍の位置を保って並べ直されます（長さ・音の高さ・強さは変わりません）。</p>
        {count > 0 ? (
          <>
            <p class="warn">
              ⚠ {tsLabel(d.to)} の小節に入らない音符が {count}個あります（{byTrack}）。
            </p>
            <fieldset class="radio">
              <legend>移し先</legend>
              <label>
                <input type="radio" name="ov" checked={d.mode === "lastBeat"} onChange={() => setState({ dialog: { ...d, mode: "lastBeat" } })} />
                {lastBeatNo}拍目（同じ小節の最後の拍）
              </label>
              <label>
                <input type="radio" name="ov" checked={d.mode === "nextBar"} onChange={() => setState({ dialog: { ...d, mode: "nextBar" } })} />
                次の小節の1拍目
              </label>
            </fieldset>
            <p class="small">
              拍の中の位置（拍の頭・裏など）は保ちます。1拍より多くはみ出す場合、「最後の拍」では最後の拍に集まり、「次の小節」では次の小節の頭から順に並びます。
            </p>
            <p>移した後に同じ高さで重なる音: {d.overlaps[d.mode]}</p>
            <p class="small">画面には変更後の配置をプレビューしています（オレンジの枠が移す音符）。</p>
          </>
        ) : (
          <p>小節に入らない音符はありません。</p>
        )}
        {compound && <p class="small">6/8 は付点四分音符を1拍と数えることが多いため、拍の番号は一致しないことがあります。小節の頭からの距離を保ちます。</p>}
        <p class="small">後で元の拍子に戻しても、移した音符は元の拍には戻りません。元に戻すには取り消し（Ctrl+Z）を使います。</p>
        <div class="buttons">
          <button class="primary" onClick={confirmTimeSig} autoFocus>
            変更する
          </button>
          <button onClick={close}>キャンセル</button>
        </div>
      </Modal>
    );
  }
  if (d.kind === "help") return <HelpDialog onClose={close} />;
  return null;
}

function Modal({ title, children, onClose }: { title: string; children: preact.ComponentChildren; onClose: () => void }) {
  return (
    <div class="modal-back" onClick={onClose}>
      <div class="modal" role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}

function HelpDialog({ onClose }: { onClose: () => void }) {
  const rows: [string, string][] = [
    ["空白をクリック", "音符を置く（ドラムでは楽器の音）"],
    ["空白をドラッグ", "四角で囲んだ音符を選ぶ"],
    ["音符をドラッグ", "移動（時間と音の高さ）"],
    ["Ctrl を押しながら音符をドラッグ", "コピー（元の音符は残る）"],
    ["コードブロック: コードを帯へドラッグ", "コードを置く（ブロックに重ねると置き換え）"],
    ["コードブロック: ブロックをドラッグ／右端", "移動／長さを変える（右クリックで削除）"],
    ["音符の右端をドラッグ", "長さを変える"],
    ["右クリック", "音符を消す"],
    ["Shift+クリック", "選択に加える・外す"],
    ["Alt を押しながら", "吸着を一時的に解除"],
    ["全体表示の行を横にドラッグ", "時間範囲を選ぶ（Shift で複数トラック）"],
    ["⟲ループ", "選んだ範囲を繰り返し再生（再生中でも切り替え可）"],
    ["Space", "再生／停止"],
    ["Home / End", "曲頭へ／曲の終わりへ"],
    ["1〜6", "音の長さ（全〜32分）"],
    [". / T", "付点／三連"],
    ["Ctrl+Z / Ctrl+Y", "取り消し／やり直し"],
    ["Ctrl+C / Ctrl+V / Ctrl+D", "コピー／貼り付け（再生位置へ）／複製"],
    ["Ctrl+A", "編集中のトラックの全音符を選ぶ"],
    ["Delete", "選択中の音符（なければ範囲内の音符）を消す"],
    ["↑↓ / Shift+↑↓", "選んだ音符を半音／1オクターブ上下（スケール音のみモードでは次のスケールの音へ）"],
    ["←→", "吸着の間隔ぶん移動"],
    ["Shift+←→", "選んだ音符の長さを、吸着の間隔ぶん伸ばす・縮める（1マス以下の音符は半分・倍）"],
    ["Q", "クオンタイズ: 選んだ音符の開始位置を吸着の間隔に合わせる"],
    ["Ctrl+L", "ループを設定（範囲、または選んだ音符を含む小節）／なければループのオン・オフ"],
    ["コードブロックを選んで ↑↓ / Shift+↑↓", "高く・低く（転回形）／1オクターブ上下"],
    ["コードブロックを選んで ←→ / Shift+←→", "1拍ずつ移動／長さを1拍ずつ変える"],
    ["Esc", "ドラッグを取り消す／選択を解除"],
    ["Ctrl+S / Ctrl+Shift+S / Ctrl+O", "上書き保存／名前を付けて保存／開く"],
    ["Ctrl+ホイール / Shift+ホイール", "横方向のズーム／横スクロール"],
    ["区切り線をドラッグ / ダブルクリック", "画面の各部分の大きさを変える／元の大きさに戻す"],
    ["作曲補助パネルの ▶", "パネルを細い帯に最小化（帯をクリックで戻す）"],
  ];
  return (
    <Modal title="操作の一覧" onClose={onClose}>
      <table class="help">
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k}>
              <th>{k}</th>
              <td>{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div class="buttons">
        <button class="primary" onClick={onClose} autoFocus>
          閉じる
        </button>
      </div>
    </Modal>
  );
}
