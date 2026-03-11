import { escapeXml } from "../../src/core/services/xml/escapeXml";

function assertEqual(actual: string, expected: string): void {
  if (actual !== expected) {
    throw new Error(`Assertion failed. Expected: ${expected}. Actual: ${actual}`);
  }
}

export function testEscapeXmlEscapesReservedCharacters(): void {
  const input = `5 < 7 & "quoted" and 'single'`;
  const output = escapeXml(input);

  assertEqual(output, "5 &lt; 7 &amp; &quot;quoted&quot; and &apos;single&apos;");
}

