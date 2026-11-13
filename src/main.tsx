import { render } from "preact";
import { App } from "./ui/App";
import { getState } from "./ui/store";
import { engine } from "./audio/engine";
import "./styles.css";

render(<App />, document.getElementById("app")!);

// 開発時の動作確認用（本番ビルドには含めない）
if (import.meta.env.DEV) (window as unknown as { __app: unknown }).__app = { getState, engine };
