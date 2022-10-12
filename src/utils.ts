export const sleep = (ms: number): Promise<void> => {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export const toFilename = (s: string): string => {
  return s.replace(/[/\\?%*:|"<>]/g, '-');
}
