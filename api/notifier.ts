import type { NotifyChannel, Settings, Signal } from "../shared/types.js";

export interface NotifyResult {
  ok: boolean;
  message: string;
}

function formatSignalBody(signals: Signal[]): string {
  const lines = signals.map((s) => {
    let typeText: string;
    let detail: string;
    if (s.type === "day_surge" || s.type === "day_plunge") {
      const up = s.type === "day_surge";
      typeText = up ? "🔥 当日涨幅超7%" : "⚠️ 当日跌幅超6%";
      detail = `当前涨跌：<b style="color:#e5484d;">${(s.changePct ?? 0) >= 0 ? "+" : ""}${(s.changePct ?? 0).toFixed(2)}%</b> ｜ 现价：<b style="color:#e5484d;">${s.price.toFixed(3)}</b>`;
    } else {
      typeText = s.type === "golden_cross" ? "⭐ 均线金叉" : "🚀 突破60均线";
      detail =
        `触发价：<b style="color:#e5484d;">${s.price.toFixed(3)}</b> ｜ ` +
        `MA30：${s.ma30.toFixed(3)} ｜ MA60：${s.ma60.toFixed(3)}`;
    }
    return (
      `<div style="margin:8px 0;padding:10px 12px;background:#f7f8fa;border-left:3px solid #F5B94A;border-radius:4px;">` +
      `<b>${s.stockName}</b>（${s.stockCode}）${s.type === "day_surge" ? "" : ` ${s.period}分钟K线`} ${typeText}<br/>` +
      `<span style="color:#888;font-size:13px;">` +
      `${detail}<br/>` +
      `K线时间：${s.klineTime}</span></div>`
    );
  });
  return lines.join("");
}

function buildContent(signals: Signal[]): { title: string; body: string } {
  const names = [...new Set(signals.map((s) => s.stockName))].join("、");
  const hasSurge = signals.some((s) => s.type === "day_surge" || s.type === "day_plunge");
  const hasGC = signals.some((s) => s.type === "golden_cross");
  const tags = [
    signals.some((s) => s.type === "day_surge") ? "涨幅超7%" : null,
    signals.some((s) => s.type === "day_plunge") ? "跌幅超6%" : null,
    hasGC ? "金叉" : null,
    signals.some((s) => s.type === "breakout") ? "突破" : null,
  ]
    .filter(Boolean)
    .join("+");
  const title = `${hasSurge ? (signals.some((s) => s.type === "day_plunge") ? "⚠️" : "🔥") : hasGC ? "⭐" : "🚀"} ${names} ${tags}信号`;
  const body = formatSignalBody(signals);
  return { title, body };
}

async function sendServerChan(key: string, title: string, body: string): Promise<NotifyResult> {
  const resp = await fetch(`https://sctapi.ftqq.com/${encodeURIComponent(key)}.send`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, desp: body }),
    signal: AbortSignal.timeout(10_000),
  });
  const json = (await resp.json().catch(() => ({}))) as { code?: number; message?: string };
  if (resp.ok && json.code === 0) return { ok: true, message: "Server酱推送成功" };
  return { ok: false, message: `Server酱推送失败：${json.message ?? `HTTP ${resp.status}`}` };
}

async function sendPushPlus(key: string, title: string, body: string): Promise<NotifyResult> {
  const resp = await fetch("https://www.pushplus.plus/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: key, title, content: body, template: "html" }),
    signal: AbortSignal.timeout(10_000),
  });
  const json = (await resp.json().catch(() => ({}))) as { code?: number; msg?: string };
  if (resp.ok && json.code === 200) return { ok: true, message: "PushPlus推送成功" };
  return { ok: false, message: `PushPlus推送失败：${json.msg ?? `HTTP ${resp.status}`}` };
}

async function sendWith(channel: NotifyChannel, key: string, title: string, body: string): Promise<NotifyResult> {
  if (!key) return { ok: false, message: "未配置推送 Key，请先在设置页填写" };
  try {
    return channel === "serverchan" ? await sendServerChan(key, title, body) : await sendPushPlus(key, title, body);
  } catch (err) {
    return { ok: false, message: `推送异常：${err instanceof Error ? err.message : String(err)}` };
  }
}

/** 发送测试推送 */
export function sendTest(settings: Settings): Promise<NotifyResult> {
  return sendWith(
    settings.channel,
    settings.key,
    "📈 股票盯盘助手 · 测试消息",
    "<div>配置成功！当监控的股票触发<b>均线金叉</b>或<b>突破60均线</b>信号时，将推送到此微信。</div>"
  );
}

/** 推送信号（一批信号合并为一条消息），返回是否全部成功 */
export async function sendSignals(settings: Settings, signals: Signal[]): Promise<boolean> {
  if (signals.length === 0) return true;
  const { title, body } = buildContent(signals);
  const result = await sendWith(settings.channel, settings.key, title, body);
  if (!result.ok) console.error(`[notifier] ${result.message}`);
  return result.ok;
}
