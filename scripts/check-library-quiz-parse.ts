function parseLibraryQuizMarkdown(md: string) {
  const text = String(md || "").trim();
  if (!text || !/\bcorrect answer\b/i.test(text)) return null;
  const blocks = text.split(/###\s*Question\s*\d+/i).slice(1);
  if (blocks.length < 2) return null;
  const items: any[] = [];
  for (const block of blocks) {
    const lines = block
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    const optionLines = lines.filter((l) => /^[A-D][\)\.\:]\s+/i.test(l));
    if (optionLines.length < 2) continue;
    const correctLine = lines.find((l) => /correct\s*answer/i.test(l));
    const correctMatch = correctLine
      ?.replace(/\*/g, "")
      .match(/correct\s*answer\s*:\s*([A-D])/i);
    const correct = (correctMatch?.[1] || "").toUpperCase();
    if (!correct) continue;
    const firstOptIdx = lines.findIndex((l) => /^[A-D][\)\.\:]\s+/i.test(l));
    const question = lines
      .slice(0, firstOptIdx > 0 ? firstOptIdx : 1)
      .join(" ")
      .trim();
    const options = optionLines
      .map((l) => {
        const m = l.match(/^([A-D])[\)\.\:]\s+(.+)$/i);
        return {
          key: (m?.[1] || "").toUpperCase(),
          text: (m?.[2] || l).trim(),
        };
      })
      .filter((o) => o.key && o.text);
    items.push({ question, options, correct });
  }
  return items.length >= 2 ? items : null;
}

const md = `## Quiz — ISO 9001:2026
### Question 1
What evidence demonstrates context understanding?
A) Marketing slogans
B) Documented internal and external issues
C) Only customer complaints
D) Informal hallway talk
**Correct answer:** B
**Explanation:** Context requires determining issues.
### Question 2
Which leadership responsibility is explicit?
A) Ignoring risks
B) Ensuring QMS integration into business processes
C) Avoiding documented information
D) Outsourcing accountability
**Correct answer:** B
**Explanation:** Leadership requires promoting and integrating the QMS.
`;

const r = parseLibraryQuizMarkdown(md);
if (!r || r.length !== 2 || r[0].correct !== "B" || r[1].correct !== "B") {
  console.error("FAIL", r);
  process.exit(1);
}
console.log("quiz parser OK", r.length);
