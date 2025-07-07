export interface SrtSegment {
  index: number;
  start: number; // seconds
  end: number;   // seconds
  text: string;
}

function timeToSeconds(time: string): number {
  const [hms, ms] = time.split(",");
  const [hh, mm, ss] = hms.split(":").map(Number);
  return hh * 3600 + mm * 60 + ss + Number(ms) / 1000;
}

export function parseSrt(content: string): SrtSegment[] {
  const lines = content.replace(/\r/g, "").split("\n");
  const segments: SrtSegment[] = [];
  let i = 0;
  while (i < lines.length) {
    const indexLine = lines[i++].trim();
    if (!indexLine) continue; // skip blank lines
    const index = Number(indexLine);
    const timingLine = lines[i++];
    if (!timingLine) break;
    const [startStr, endStr] = timingLine.split(" --> ");
    const start = timeToSeconds(startStr.trim());
    const end = timeToSeconds(endStr.trim());
    const textLines: string[] = [];
    while (i < lines.length && lines[i].trim() !== "") {
      textLines.push(lines[i++]);
    }
    // skip blank line
    while (i < lines.length && lines[i].trim() === "") i++;
    segments.push({ index, start, end, text: textLines.join(" ") });
  }
  return segments;
} 