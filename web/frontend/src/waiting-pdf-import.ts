/** Waiting-screen PDF gate: MIME or .pdf suffix; non-PDF must not open the flow. */
export function isWaitingPdfFile(file: { name: string; type: string }): boolean {
  const name = file.name.toLowerCase();
  return file.type === "application/pdf" || name.endsWith(".pdf");
}
