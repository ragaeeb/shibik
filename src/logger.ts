import type { LogLevel } from "@/types.js";

export const log = (level: LogLevel, message: string) => {
  const timestamp = new Date().toISOString().replace("T", " ").replace("Z", "");
  const line = `[${timestamp}] [${level}] ${message}\n`;
  if (level === "INFO") {
    process.stdout.write(line);
    return;
  }

  process.stderr.write(line);
};
