// ============================================================
// 📝 轻量文件日志
// 服务端原本只 console.log 到启动终端，无法回溯排查（尤其是手机端
// 上传的录音格式/大小/转码/识别结果）。这里把关键日志同时追加到
// server/logs/app-YYYYMMDD.log，便于事后定位"识别不出语音"等问题。
// ============================================================

import fs from 'fs';
import path from 'path';

const logDir = path.join(__dirname, '..', '..', 'logs');
if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

function todayLogFile(): string {
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  return path.join(logDir, `app-${stamp}.log`);
}

/** 写一行日志（同时输出到终端和文件） */
export function logLine(scope: string, message: string): void {
  const line = `${new Date().toISOString()} [${scope}] ${message}`;
  console.log(line);
  try {
    fs.appendFileSync(todayLogFile(), line + '\n');
  } catch {
    /* 写日志失败不能影响主流程 */
  }
}
