/**
 * Run-length encoding for chunk data, then base64: voxel chunks are mostly long runs
 * of air and stone, so a 32 KB chunk usually saves as a few hundred bytes.
 */
export function encodeRuns(data: Uint8Array): string {
  const out: number[] = [];
  for (let i = 0; i < data.length; ) {
    const value = data[i];
    let run = 1;
    while (i + run < data.length && data[i + run] === value && run < 255) run++;
    out.push(run, value);
    i += run;
  }
  let binary = '';
  for (const byte of out) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function decodeRuns(text: string, length: number): Uint8Array {
  const binary = atob(text);
  const data = new Uint8Array(length);
  let at = 0;
  for (let i = 0; i + 1 < binary.length; i += 2) {
    const run = binary.charCodeAt(i);
    data.fill(binary.charCodeAt(i + 1), at, at + run);
    at += run;
  }
  return data;
}
