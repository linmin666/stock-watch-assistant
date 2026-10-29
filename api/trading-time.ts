/** A股交易时段判断（Asia/Shanghai） */

export type TradingPhase = "trading" | "lunch" | "closed";

interface TimeParts {
  day: number; // 0=周日
  minutes: number; // 当日分钟数
}

export function shanghaiNow(): TimeParts {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const weekdayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const day = weekdayMap[get("weekday")] ?? 0;
  const hour = parseInt(get("hour"), 10) % 24;
  const minute = parseInt(get("minute"), 10);
  return { day, minutes: hour * 60 + minute };
}

/** 交易时段：周一至周五 9:30-11:30, 13:00-15:00；午休返回 lunch */
export function tradingPhase(): TradingPhase {
  const { day, minutes } = shanghaiNow();
  if (day === 0 || day === 6) return "closed";
  if (minutes >= 570 && minutes < 690) return "trading"; // 9:30-11:30
  if (minutes >= 780 && minutes < 900) return "trading"; // 13:00-15:00
  if (minutes >= 690 && minutes < 780) return "lunch"; // 11:30-13:00
  return "closed";
}
